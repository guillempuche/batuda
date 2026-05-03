// EmailBlocks ↔ ProseMirror/Tiptap JSON converters. Both trees are
// flat block-of-spans shapes, so the mapping is mechanical. Living in
// its own module keeps the editor wrapper free of adapter code and
// lets us unit-test the two directions independently.

import type {
	EmailBlock,
	EmailBlocks,
	ImageBlock,
	LinkSpan,
	Span,
	TextSpan,
} from '../schema'

export interface TiptapDoc {
	readonly type: 'doc'
	readonly content: ReadonlyArray<TiptapNode>
}
export interface TiptapNode {
	readonly type: string
	readonly attrs?: Record<string, unknown> | undefined
	readonly content?: ReadonlyArray<TiptapNode> | undefined
	readonly marks?: ReadonlyArray<TiptapMark> | undefined
	readonly text?: string | undefined
}
export interface TiptapMark {
	readonly type: string
	readonly attrs?: Record<string, unknown> | undefined
}

// ────────────────────────────────────────────────────────────────────
// EmailBlocks → Tiptap doc
// ────────────────────────────────────────────────────────────────────

export const emailBlocksToTiptap = (blocks: EmailBlocks): TiptapDoc => ({
	type: 'doc',
	content: blocks.map(blockToNode),
})

const blockToNode = (block: EmailBlock): TiptapNode => {
	switch (block.type) {
		case 'paragraph':
			return { type: 'paragraph', content: spansToNodes(block.spans) }
		case 'heading':
			return {
				type: 'heading',
				attrs: { level: block.level },
				content: spansToNodes(block.spans),
			}
		case 'list':
			return {
				type: block.ordered ? 'orderedList' : 'bulletList',
				content: block.items.map(item => ({
					type: 'listItem',
					content: [{ type: 'paragraph', content: spansToNodes(item) }],
				})),
			}
		case 'divider':
			return { type: 'horizontalRule' }
		case 'quote':
			return {
				type: 'blockquote',
				content: block.children.map(blockToNode),
			}
		case 'image':
			return { type: 'image', attrs: imageAttrs(block) }
	}
}

const imageAttrs = (block: ImageBlock): Record<string, unknown> => {
	const attrs: Record<string, unknown> = { alt: block.alt }
	if (block.width !== undefined) attrs['width'] = block.width
	if (block.height !== undefined) attrs['height'] = block.height
	if (block.source.kind === 'staging') {
		attrs['stagingId'] = block.source.stagingId
		// src is filled in by the editor when the previewUrl resolves.
	} else if (block.source.kind === 'cid') {
		attrs['cid'] = block.source.cid
		attrs['src'] = `cid:${block.source.cid}`
	} else {
		attrs['src'] = block.source.href
	}
	return attrs
}

const spansToNodes = (spans: ReadonlyArray<Span>): TiptapNode[] => {
	const nodes: TiptapNode[] = []
	for (const s of spans) {
		if (s.kind === 'break') {
			nodes.push({ type: 'hardBreak' })
			continue
		}
		if (s.kind === 'link') {
			nodes.push(linkNode(s))
			continue
		}
		nodes.push(textNode(s))
	}
	return nodes
}

const textNode = (span: TextSpan): TiptapNode => {
	const marks: TiptapMark[] = []
	if (span.bold) marks.push({ type: 'bold' })
	if (span.italic) marks.push({ type: 'italic' })
	if (span.strike) marks.push({ type: 'strike' })
	if (span.code) marks.push({ type: 'code' })
	return {
		type: 'text',
		text: span.value,
		...(marks.length > 0 ? { marks } : {}),
	}
}

const linkNode = (span: LinkSpan): TiptapNode => {
	const marks: TiptapMark[] = [{ type: 'link', attrs: { href: span.href } }]
	if (span.bold) marks.push({ type: 'bold' })
	if (span.italic) marks.push({ type: 'italic' })
	return { type: 'text', text: span.text, marks }
}

// ────────────────────────────────────────────────────────────────────
// Tiptap doc → EmailBlocks
// ────────────────────────────────────────────────────────────────────

// `@react-email/editor` wraps the user-editable content inside its
// own layout nodes (`globalContent` for theme styles, `container` for
// the editable surface, etc.) — those don't correspond to email
// blocks themselves but their descendants do. Walk through them
// recursively instead of stopping at the top level, otherwise the
// adapter returns an empty `EmailBlocks` for every doc the editor
// produces and the consumer's `bodyText` stays '' forever.
const WRAPPER_NODE_TYPES = new Set([
	'container',
	'columns',
	'column',
	'globalContent',
	'section',
])

export const tiptapToEmailBlocks = (doc: TiptapDoc): EmailBlocks => {
	const blocks: EmailBlock[] = []
	const visit = (nodes: ReadonlyArray<TiptapNode>): void => {
		for (const node of nodes) {
			if (WRAPPER_NODE_TYPES.has(node.type)) {
				visit(node.content ?? [])
				continue
			}
			const block = nodeToBlock(node)
			if (block) blocks.push(block)
		}
	}
	visit(doc.content ?? [])
	return blocks
}

const nodeToBlock = (node: TiptapNode): EmailBlock | null => {
	switch (node.type) {
		case 'paragraph':
			return { type: 'paragraph', spans: collectSpans(node.content ?? []) }
		case 'heading': {
			const rawLevel = node.attrs?.['level']
			const level = rawLevel === 2 || rawLevel === 3 ? rawLevel : 1
			return {
				type: 'heading',
				level,
				spans: collectSpans(node.content ?? []),
			}
		}
		case 'bulletList':
		case 'orderedList':
			return {
				type: 'list',
				ordered: node.type === 'orderedList',
				items: (node.content ?? []).map(listItemToSpans),
			}
		case 'horizontalRule':
			return { type: 'divider' }
		case 'blockquote': {
			const children: EmailBlock[] = []
			for (const c of node.content ?? []) {
				const child = nodeToBlock(c)
				if (child) children.push(child)
			}
			return { type: 'quote', children }
		}
		case 'image':
			return nodeToImage(node)
		default:
			return null
	}
}

const listItemToSpans = (node: TiptapNode): Span[] => {
	const spans: Span[] = []
	for (const child of node.content ?? []) {
		if (child.type === 'paragraph') {
			spans.push(...collectSpans(child.content ?? []))
		}
	}
	return spans
}

const collectSpans = (nodes: ReadonlyArray<TiptapNode>): Span[] => {
	const spans: Span[] = []
	for (const n of nodes) {
		if (n.type === 'hardBreak') {
			spans.push({ kind: 'break' })
			continue
		}
		if (n.type !== 'text' || typeof n.text !== 'string') continue
		const marks = n.marks ?? []
		const link = marks.find(m => m.type === 'link')
		const bold = marks.some(m => m.type === 'bold')
		const italic = marks.some(m => m.type === 'italic')
		const strike = marks.some(m => m.type === 'strike')
		const code = marks.some(m => m.type === 'code')
		if (link && typeof link.attrs?.['href'] === 'string') {
			spans.push({
				kind: 'link',
				href: link.attrs['href'],
				text: n.text,
				...(bold ? { bold: true } : {}),
				...(italic ? { italic: true } : {}),
			})
			continue
		}
		spans.push({
			kind: 'text',
			value: n.text,
			...(bold ? { bold: true } : {}),
			...(italic ? { italic: true } : {}),
			...(strike ? { strike: true } : {}),
			...(code ? { code: true } : {}),
		})
	}
	return spans
}

const nodeToImage = (node: TiptapNode): ImageBlock | null => {
	const attrs = node.attrs ?? {}
	const alt = typeof attrs['alt'] === 'string' ? attrs['alt'] : ''
	const widthRaw = attrs['width']
	const heightRaw = attrs['height']
	const width =
		typeof widthRaw === 'number' && widthRaw > 0 ? widthRaw : undefined
	const height =
		typeof heightRaw === 'number' && heightRaw > 0 ? heightRaw : undefined
	const stagingId = attrs['stagingId']
	if (typeof stagingId === 'string' && stagingId.length > 0) {
		return {
			type: 'image',
			source: { kind: 'staging', stagingId },
			alt,
			...(width !== undefined ? { width } : {}),
			...(height !== undefined ? { height } : {}),
		}
	}
	const cid = attrs['cid']
	if (typeof cid === 'string' && cid.length > 0) {
		return {
			type: 'image',
			source: { kind: 'cid', cid },
			alt,
			...(width !== undefined ? { width } : {}),
			...(height !== undefined ? { height } : {}),
		}
	}
	const src = attrs['src']
	if (typeof src === 'string' && /^https?:\/\//i.test(src)) {
		return {
			type: 'image',
			source: { kind: 'url', href: src },
			alt,
			...(width !== undefined ? { width } : {}),
			...(height !== undefined ? { height } : {}),
		}
	}
	return null
}
