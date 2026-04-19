// HTML/text → EmailBlock[] mapping. Allowlist-only: we parse the input
// into a DOM-shaped tree, walk it, and emit a fresh block tree. Anything
// not on the allowlist simply does not appear in the output — no "strip
// bad parts in place" (the historical home of every XSS bypass).
//
// Server parser: parse5 (zero runtime deps — picked over jsdom/linkedom
// /htmlparser2/sanitize-html, all of which carry multi-package trees).
// Client parser: native DOMParser (zero deps).

import { type DefaultTreeAdapterTypes, parse as parseHtml } from 'parse5'

import type {
	BreakSpan,
	EmailBlock,
	ImageBlock,
	LinkSpan,
	ParagraphBlock,
	Span,
	TextSpan,
} from './schema'

type P5Element = DefaultTreeAdapterTypes.Element
type P5ChildNode = DefaultTreeAdapterTypes.ChildNode
type P5ParentNode = DefaultTreeAdapterTypes.ParentNode
type P5TextNode = DefaultTreeAdapterTypes.TextNode

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

export interface SanitizeOptions {
	// If true, the sanitizer is running in the browser and should use
	// native DOMParser. Defaults to environment sniffing.
	readonly client?: boolean | undefined
}

export const sanitizeHtmlToBlocks = (
	html: string,
	options: SanitizeOptions = {},
): ReadonlyArray<EmailBlock> => {
	if (html.length === 0) return []
	const useClient = options.client ?? typeof document !== 'undefined'
	const doc = useClient ? parseClient(html) : parseServer(html)
	const blocks: EmailBlock[] = []
	walkChildren(doc.body, blocks, { marks: {} })
	return flushTrailingEmpty(blocks)
}

export const sanitizeTextToBlocks = (
	text: string,
): ReadonlyArray<EmailBlock> => {
	// Normalize CRLF + strip BOM. Multiple blank lines collapse to a
	// single paragraph boundary so the output tree stays dense.
	const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')

	// Detect uniform "> " prefix depth across the whole block. Every
	// line-start "> " pair increases depth by one; we peel layers off
	// and recurse — preserves nested reply quoting without a cap.
	const depth = detectQuoteDepth(normalized)
	if (depth > 0) {
		const peeled = peelQuotePrefix(normalized, depth)
		const inner = sanitizeTextToBlocks(peeled)
		return [wrapInQuotes(inner, depth)]
	}

	const paragraphs = normalized
		.split(/\n{2,}/)
		.map(p => p.replace(/\n/g, ' ').trim())
		.filter(p => p.length > 0)
	return paragraphs.map(
		(value): ParagraphBlock => ({
			type: 'paragraph',
			spans: [{ kind: 'text', value }],
		}),
	)
}

// ────────────────────────────────────────────────────────────────────
// DOM abstraction — parse5 on the server, DOMParser in the browser.
// ────────────────────────────────────────────────────────────────────

interface DomDoc {
	readonly body: DomNode
}

type DomNode =
	| {
			readonly kind: 'element'
			readonly tag: string
			readonly attrs: Record<string, string>
			readonly children: ReadonlyArray<DomNode>
	  }
	| { readonly kind: 'text'; readonly value: string }

const parseServer = (html: string): DomDoc => {
	const doc = parseHtml(html)
	// parse5 returns a Document whose childNodes contain <html>. We walk
	// down to find <body>; if not found (fragment input), we synthesize one.
	const htmlNode = findElement(doc as unknown as P5ParentNode, 'html')
	const bodyNode = htmlNode ? findElement(htmlNode, 'body') : null
	const root: P5ParentNode | null =
		bodyNode ?? htmlNode ?? (doc as unknown as P5ParentNode)
	return { body: fromParse5Node(root) }
}

const parseClient = (html: string): DomDoc => {
	const parser = new DOMParser()
	const doc = parser.parseFromString(html, 'text/html')
	return { body: fromDomNode(doc.body) }
}

const fromParse5Node = (node: P5ParentNode | P5ChildNode): DomNode => {
	if (
		'value' in node &&
		typeof node.value === 'string' &&
		node.nodeName === '#text'
	) {
		return { kind: 'text', value: (node as P5TextNode).value }
	}
	const el = node as P5Element
	const tag =
		typeof el.tagName === 'string' ? el.tagName.toLowerCase() : el.nodeName
	const attrs: Record<string, string> = {}
	if (Array.isArray(el.attrs)) {
		for (const a of el.attrs) attrs[a.name.toLowerCase()] = a.value
	}
	const children: DomNode[] = []
	if (Array.isArray((el as P5ParentNode).childNodes)) {
		for (const c of (el as P5ParentNode).childNodes) {
			// Drop comments, doctype, and all non-element/text nodes.
			if (c.nodeName === '#comment' || c.nodeName === '#documentType') continue
			children.push(fromParse5Node(c))
		}
	}
	return { kind: 'element', tag, attrs, children }
}

const fromDomNode = (node: Node): DomNode => {
	if (node.nodeType === 3 /* Node.TEXT_NODE */) {
		return { kind: 'text', value: node.nodeValue ?? '' }
	}
	const el = node as Element
	const attrs: Record<string, string> = {}
	for (const a of Array.from(el.attributes ?? [])) {
		attrs[a.name.toLowerCase()] = a.value
	}
	const children: DomNode[] = []
	for (const c of Array.from(el.childNodes)) {
		// nodeType 1 = element, 3 = text. Everything else (comments,
		// CDATA, processing instructions) is dropped.
		if (c.nodeType !== 1 && c.nodeType !== 3) continue
		children.push(fromDomNode(c))
	}
	return { kind: 'element', tag: el.tagName.toLowerCase(), attrs, children }
}

const findElement = (
	parent: P5ParentNode,
	tag: string,
): P5ParentNode | null => {
	const kids = (parent as P5ParentNode).childNodes ?? []
	for (const c of kids) {
		if (c.nodeName === tag) return c as unknown as P5ParentNode
		if ('childNodes' in c) {
			const hit = findElement(c as P5ParentNode, tag)
			if (hit) return hit
		}
	}
	return null
}

// ────────────────────────────────────────────────────────────────────
// Walker — DomNode → EmailBlock[]
// ────────────────────────────────────────────────────────────────────

interface MarkState {
	readonly bold?: boolean | undefined
	readonly italic?: boolean | undefined
	readonly strike?: boolean | undefined
	readonly code?: boolean | undefined
}

interface WalkCtx {
	readonly marks: MarkState
	// When set, spans are accumulated into this buffer instead of being
	// emitted as standalone paragraphs (e.g. inside <li>).
	readonly spanBuffer?: Span[] | undefined
}

// Tags we ignore entirely — Outlook-only markup, unsupported blocks,
// metadata. Their subtrees are skipped too.
const DROPPED_TAGS = new Set([
	'script',
	'style',
	'meta',
	'link',
	'noscript',
	'head',
	'title',
	'iframe',
	'object',
	'embed',
	'form',
	'input',
	'button',
	'select',
	'textarea',
	'svg',
	'canvas',
	'video',
	'audio',
	'applet',
	// Outlook VML / MSO
	'o:p',
	'v:shape',
	'v:imagedata',
	'v:rect',
	'v:roundrect',
	'v:line',
	'v:oval',
	'v:group',
	'v:textbox',
	'w:wordart',
])

// Unsupported block tags that leave a placeholder paragraph behind.
const PLACEHOLDER_TAGS: Record<string, string> = {
	table: '[table]',
	thead: '',
	tbody: '',
	tr: '',
	td: '',
	th: '',
}

const walkChildren = (node: DomNode, out: EmailBlock[], ctx: WalkCtx): void => {
	if (node.kind !== 'element') return
	for (const child of node.children) visit(child, out, ctx)
}

const visit = (node: DomNode, out: EmailBlock[], ctx: WalkCtx): void => {
	if (node.kind === 'text') {
		const value = decodeEntities(node.value)
		if (value.length === 0) return
		pushSpan(out, ctx, { kind: 'text', value, ...ctx.marks } satisfies TextSpan)
		return
	}

	const tag = node.tag
	if (DROPPED_TAGS.has(tag)) return

	if (tag in PLACEHOLDER_TAGS) {
		const label = PLACEHOLDER_TAGS[tag]
		if (label) {
			out.push({
				type: 'paragraph',
				spans: [{ kind: 'text', value: label, italic: true }],
			})
		}
		return
	}

	switch (tag) {
		case 'p':
		case 'div':
		case 'section':
		case 'article':
		case 'main':
		case 'header':
		case 'footer':
		case 'aside': {
			const spans: Span[] = []
			for (const c of node.children)
				visit(c, out, { ...ctx, spanBuffer: spans })
			if (spans.length > 0) {
				out.push({ type: 'paragraph', spans: collapseSpans(spans) })
			} else if (tag === 'p') {
				out.push({ type: 'paragraph', spans: [] })
			}
			return
		}
		case 'h1':
		case 'h2':
		case 'h3': {
			const level = Number(tag.slice(1)) as 1 | 2 | 3
			const spans: Span[] = []
			for (const c of node.children)
				visit(c, out, { ...ctx, spanBuffer: spans })
			out.push({ type: 'heading', level, spans: collapseSpans(spans) })
			return
		}
		case 'h4':
		case 'h5':
		case 'h6': {
			const spans: Span[] = []
			for (const c of node.children)
				visit(c, out, { ...ctx, spanBuffer: spans })
			out.push({ type: 'paragraph', spans: collapseSpans(spans) })
			return
		}
		case 'ul':
		case 'ol': {
			const items: Span[][] = []
			for (const c of node.children) {
				if (c.kind !== 'element' || c.tag !== 'li') continue
				const itemSpans: Span[] = []
				for (const cc of c.children)
					visit(cc, out, { ...ctx, spanBuffer: itemSpans })
				items.push(collapseSpans(itemSpans))
			}
			out.push({ type: 'list', ordered: tag === 'ol', items })
			return
		}
		case 'blockquote': {
			const inner: EmailBlock[] = []
			for (const c of node.children) visit(c, inner, { marks: {} })
			out.push({ type: 'quote', children: inner })
			return
		}
		case 'hr':
			out.push({ type: 'divider' })
			return
		case 'br':
			pushSpan(out, ctx, { kind: 'break' } satisfies BreakSpan)
			return
		case 'img': {
			const img = mapImage(node)
			if (img) out.push(img)
			return
		}
		case 'a': {
			const href = normalizeHref(node.attrs['href'] ?? '')
			const text = plainText(node)
			if (href && text.length > 0) {
				pushSpan(out, ctx, {
					kind: 'link',
					href,
					text,
					...(ctx.marks.bold ? { bold: true } : {}),
					...(ctx.marks.italic ? { italic: true } : {}),
				} satisfies LinkSpan)
			} else if (text.length > 0) {
				pushSpan(out, ctx, {
					kind: 'text',
					value: text,
					...ctx.marks,
				} satisfies TextSpan)
			}
			return
		}
		case 'strong':
		case 'b':
			for (const c of node.children)
				visit(c, out, { ...ctx, marks: { ...ctx.marks, bold: true } })
			return
		case 'em':
		case 'i':
			for (const c of node.children)
				visit(c, out, { ...ctx, marks: { ...ctx.marks, italic: true } })
			return
		case 's':
		case 'del':
		case 'strike':
			for (const c of node.children)
				visit(c, out, { ...ctx, marks: { ...ctx.marks, strike: true } })
			return
		case 'code':
		case 'tt':
		case 'kbd':
		case 'samp':
			for (const c of node.children)
				visit(c, out, { ...ctx, marks: { ...ctx.marks, code: true } })
			return
		case 'pre': {
			// Preformatted text collapses to a single code-marked paragraph;
			// <pre> is not part of the email block palette.
			const spans: Span[] = []
			for (const c of node.children)
				visit(c, out, {
					...ctx,
					spanBuffer: spans,
					marks: { ...ctx.marks, code: true },
				})
			if (spans.length > 0)
				out.push({ type: 'paragraph', spans: collapseSpans(spans) })
			return
		}
		case 'html':
		case 'body':
		case 'span':
		case 'font':
		case 'small':
		case 'mark':
		case 'u':
		case 'sub':
		case 'sup':
		case 'label':
			// Pass-through wrappers.
			for (const c of node.children) visit(c, out, ctx)
			return
		default:
			// Unknown/unmapped tags — flatten children. Attributes are dropped;
			// their styling never reaches the output.
			for (const c of node.children) visit(c, out, ctx)
			return
	}
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

const pushSpan = (out: EmailBlock[], ctx: WalkCtx, span: Span): void => {
	if (ctx.spanBuffer) {
		ctx.spanBuffer.push(span)
		return
	}
	// No enclosing span container — wrap this span in its own paragraph so
	// untagged text in the body doesn't get lost.
	const last = out[out.length - 1]
	if (last && last.type === 'paragraph') {
		out[out.length - 1] = {
			type: 'paragraph',
			spans: collapseSpans([...last.spans, span]),
		}
		return
	}
	out.push({ type: 'paragraph', spans: [span] })
}

// Merge adjacent text spans that share the same mark flags. Keeps the
// tree compact and deterministic across equivalent HTML shapes.
const collapseSpans = (spans: ReadonlyArray<Span>): Span[] => {
	const result: Span[] = []
	for (const s of spans) {
		const prev = result[result.length - 1]
		if (
			prev &&
			prev.kind === 'text' &&
			s.kind === 'text' &&
			prev.bold === s.bold &&
			prev.italic === s.italic &&
			prev.strike === s.strike &&
			prev.code === s.code
		) {
			result[result.length - 1] = { ...prev, value: prev.value + s.value }
			continue
		}
		result.push(s)
	}
	return result
}

const plainText = (node: DomNode): string => {
	if (node.kind === 'text') return decodeEntities(node.value)
	let acc = ''
	for (const c of node.children) acc += plainText(c)
	return acc
}

const mapImage = (node: DomNode & { kind: 'element' }): ImageBlock | null => {
	const src = (node.attrs['src'] ?? '').trim()
	const alt = node.attrs['alt'] ?? ''
	const widthAttr = node.attrs['width']
	const heightAttr = node.attrs['height']
	const width = widthAttr ? parsePositiveInt(widthAttr) : undefined
	const height = heightAttr ? parsePositiveInt(heightAttr) : undefined

	if (src.length === 0) return null
	if (/^cid:/i.test(src)) {
		// Normalize "<abc@host>" or "cid:<abc>" → bare "abc". Angle brackets
		// appear when parents encode the Message-ID shape into Content-ID.
		const cid = src.replace(/^cid:/i, '').replace(/^<|>$/g, '')
		if (cid.length === 0) return null
		return {
			type: 'image',
			source: { kind: 'cid', cid },
			alt,
			...(width !== undefined ? { width } : {}),
			...(height !== undefined ? { height } : {}),
		}
	}
	if (/^https?:\/\//i.test(src)) {
		return {
			type: 'image',
			source: { kind: 'url', href: src },
			alt,
			...(width !== undefined ? { width } : {}),
			...(height !== undefined ? { height } : {}),
		}
	}
	// data:, vbscript:, javascript:, file: — dropped.
	return null
}

const parsePositiveInt = (s: string): number | undefined => {
	const n = Number.parseInt(s, 10)
	return Number.isFinite(n) && n > 0 ? n : undefined
}

const normalizeHref = (raw: string): string | null => {
	const href = raw.trim()
	if (href.length === 0) return null
	if (/^(https?:\/\/|mailto:)/i.test(href)) return href
	return null
}

// Minimal entity decoder — covers the entities that actually appear in
// real outbound mail. parse5 already decodes most; DOMParser decodes all.
// This catches the residual cases where raw text slips through.
const ENTITY_MAP: Record<string, string> = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&apos;': "'",
	'&nbsp;': '\u00A0',
}
const decodeEntities = (s: string): string =>
	s
		.replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) =>
			String.fromCodePoint(Number.parseInt(h, 16)),
		)
		.replace(/&[a-zA-Z]+;/g, m => ENTITY_MAP[m] ?? m)

// ────────────────────────────────────────────────────────────────────
// Text-only quote handling
// ────────────────────────────────────────────────────────────────────

const QUOTE_LINE = /^(> )+/

const detectQuoteDepth = (text: string): number => {
	const lines = text.split('\n').filter(l => l.length > 0)
	if (lines.length === 0) return 0
	let min = Infinity
	for (const line of lines) {
		const match = line.match(QUOTE_LINE)
		if (!match) return 0
		const depth = match[0].length / 2
		if (depth < min) min = depth
	}
	return Number.isFinite(min) ? min : 0
}

const peelQuotePrefix = (text: string, depth: number): string => {
	const pattern = new RegExp(`^(> ){${depth}}`, 'gm')
	return text.replace(pattern, '')
}

const wrapInQuotes = (
	inner: ReadonlyArray<EmailBlock>,
	depth: number,
): EmailBlock => {
	let current: EmailBlock = { type: 'quote', children: inner }
	for (let i = 1; i < depth; i++) {
		current = { type: 'quote', children: [current] }
	}
	return current
}

// Drop a single trailing empty paragraph; <div>-soup parents routinely
// end in one and it shows up as an extra blank line in the editor.
const flushTrailingEmpty = (
	blocks: ReadonlyArray<EmailBlock>,
): ReadonlyArray<EmailBlock> => {
	const last = blocks[blocks.length - 1]
	if (last && last.type === 'paragraph' && last.spans.length === 0) {
		return blocks.slice(0, -1)
	}
	return blocks
}
