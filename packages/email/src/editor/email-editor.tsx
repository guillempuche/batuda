import {
	type EmailEditorRef,
	EmailEditor as REEmailEditor,
	type EmailEditorProps as REEmailEditorProps,
} from '@react-email/editor'
import { render } from '@react-email/render'
import {
	createElement,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react'
import '@react-email/editor/themes/default.css'
import '@react-email/editor/styles/bubble-menu.css'
import '@react-email/editor/styles/slash-command.css'

import { AgentEmail } from '../components/agent-email'
import type { EmailBlocks } from '../schema'
import { brandColors, brandFonts, brandFontWeight, brandTheme } from '../theme'
import { createImageUploader, type ImageUploader } from './image-upload'
import {
	emailBlocksToTiptap,
	type TiptapDoc,
	type TiptapNode,
	tiptapToEmailBlocks,
} from './tiptap-adapter'

// ────────────────────────────────────────────────────────────────────
// Public contract — consumed by Batuda compose-form and FooterManageDialog.
//
// The editor wrapper composes three things:
//   1. @react-email/editor's Tiptap-backed canvas (brand-themed via CSS vars)
//   2. createImageUploader — paste/drop/slash → staging endpoint
//   3. The tiptap-adapter pair — lossless JSON ↔ EmailBlocks conversion
//
// onChange fires debounced (debounceMs, default 300). Payload is always
// the three shapes: typed blocks, rendered html, rendered text.
// ────────────────────────────────────────────────────────────────────

export interface EmailEditorPayload {
	readonly json: EmailBlocks
	readonly html: string
	readonly text: string
}

export interface EmailEditorProps {
	readonly inboxId: string
	readonly mode: 'compose' | 'footer'
	readonly initialJson?: EmailBlocks | undefined
	readonly onChange: (payload: EmailEditorPayload) => void
	readonly onFocus?: (() => void) | undefined
	readonly onBlur?: (() => void) | undefined
	readonly stagingEndpoint?: string | undefined
	readonly debounceMs?: number | undefined
	readonly placeholder?: string | undefined
	readonly signOff?:
		| {
				readonly author?: string | undefined
				readonly brand?: string | undefined
				readonly city?: string | undefined
		  }
		| undefined
}

// Footer mode drops heading/divider/list from the block palette. Kept
// here so consumers agree on palette shape without importing the whole
// @react-email/editor extensions surface.
export const FOOTER_ALLOWED_BLOCKS = new Set<EmailBlocks[number]['type']>([
	'paragraph',
	'image',
])
export const COMPOSE_ALLOWED_BLOCKS = new Set<EmailBlocks[number]['type']>([
	'paragraph',
	'heading',
	'list',
	'quote',
	'divider',
	'image',
])

// Visible to tests: filters a doc to the mode's palette. Any block type
// not in the allowlist is dropped, but its span content is hoisted to a
// paragraph so user text isn't lost when switching modes.
export const enforceModePalette = (
	blocks: EmailBlocks,
	mode: 'compose' | 'footer',
): EmailBlocks => {
	const allowed =
		mode === 'footer' ? FOOTER_ALLOWED_BLOCKS : COMPOSE_ALLOWED_BLOCKS
	const out: EmailBlocks[number][] = []
	for (const block of blocks) {
		if (allowed.has(block.type)) {
			out.push(block)
			continue
		}
		if (
			(block.type === 'heading' || block.type === 'paragraph') &&
			'spans' in block
		) {
			out.push({ type: 'paragraph', spans: block.spans })
		}
	}
	return out
}

// ────────────────────────────────────────────────────────────────────
// EmailEditor — thin React wrapper. Owns the @react-email/editor
// instance, drives it via initialJson → Tiptap doc, and surfaces
// onChange with the three output shapes. The actual canvas/toolbar
// chrome is the library's; we only add staging hooks and mode palette.
// ────────────────────────────────────────────────────────────────────

export const EmailEditor = (props: EmailEditorProps) => {
	const {
		inboxId,
		mode,
		initialJson,
		onChange,
		onFocus,
		onBlur,
		stagingEndpoint = '/v1/email/attachments/staging',
		debounceMs = 300,
		placeholder,
		signOff,
	} = props

	const [doc, setDoc] = useState<TiptapDoc>(() =>
		emailBlocksToTiptap(initialJson ?? []),
	)
	const uploader: ImageUploader = useMemo(
		() => createImageUploader({ inboxId, endpoint: stagingEndpoint }),
		[inboxId, stagingEndpoint],
	)
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	// Two-phase change pipeline:
	//   1. Synchronous onChange fires `{ json, text, html: '' }` on every
	//      doc transition so consumers (canSend gates, draft auto-save)
	//      see typing immediately. The previous 300ms debounce around
	//      everything caused the consumer's body text to stay '' for
	//      the lifetime of the form whenever any upstream React identity
	//      flipped during the debounce window — the cleanup ran every
	//      render and reset the timer before it could ever fire.
	//   2. Debounced async pass calls `@react-email/render` and re-fires
	//      onChange with the final html. Slow but only the html consumer
	//      needs to wait for it; canSend just needs `text`.
	const flushSync = useCallback(
		(next: TiptapDoc) => {
			const blocks = enforceModePalette(tiptapToEmailBlocks(next), mode)
			const text = blocksToPlainText(blocks)
			onChange({ json: blocks, html: '', text })
		},
		[mode, onChange],
	)

	const flushHtml = useCallback(
		(next: TiptapDoc) => {
			const blocks = enforceModePalette(tiptapToEmailBlocks(next), mode)
			render(
				createElement(AgentEmail, {
					blocks,
					stagingIndex: new Map(),
					signOff,
				}),
				{ pretty: false },
			).then(
				html => {
					const text = blocksToPlainText(blocks)
					onChange({ json: blocks, html, text })
				},
				err => {
					// react-email's render rejects on unsupported markup or
					// internal errors; without a catch the promise's
					// rejection silently swallowed the onChange call. The
					// sync pass above already gave the consumer a usable
					// `text` snapshot, so we just log and bail.
					console.error('[EmailEditor] render failed:', err)
				},
			)
		},
		[mode, onChange, signOff],
	)

	useEffect(() => {
		flushSync(doc)
	}, [doc, flushSync])

	useEffect(() => {
		if (debounceRef.current) clearTimeout(debounceRef.current)
		debounceRef.current = setTimeout(() => flushHtml(doc), debounceMs)
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current)
		}
	}, [doc, debounceMs, flushHtml])

	return (
		<EmailEditorBridge
			inboxId={inboxId}
			doc={doc}
			uploader={uploader}
			placeholder={placeholder}
			onChangeDoc={setDoc}
			onFocus={onFocus}
			onBlur={onBlur}
		/>
	)
}

const blocksToPlainText = (blocks: EmailBlocks): string => {
	// Minimal text form for the editor-internal onChange path. The send
	// pipeline uses the dedicated renderer in render.ts; this is just the
	// snapshot kept alongside the draft.
	const parts: string[] = []
	for (const b of blocks) {
		if (b.type === 'paragraph' || b.type === 'heading') {
			parts.push(
				b.spans
					.map(s =>
						s.kind === 'break' ? '\n' : s.kind === 'link' ? s.text : s.value,
					)
					.join(''),
			)
		} else if (b.type === 'list') {
			for (const item of b.items) {
				parts.push(
					'- ' +
						item
							.map(s =>
								s.kind === 'break' ? ' ' : s.kind === 'link' ? s.text : s.value,
							)
							.join(''),
				)
			}
		} else if (b.type === 'divider') {
			parts.push('---')
		} else if (b.type === 'image') {
			parts.push(b.alt ? `[image: ${b.alt}]` : '[image]')
		}
	}
	return parts.join('\n')
}

// Bridge — drives the @react-email/editor instance. Two responsibilities
// the library can't handle itself:
//   1. Preserve stagingId on image nodes. The library's upload API only
//      hands back { url }; we keep a sidecar Map<previewUrl → stagingId>
//      and patch it onto image nodes before handing JSON back up.
//   2. Fire DELETE on removed images so storage doesn't leak. We diff
//      the prior-flush stagingIds vs. the current ones and discard the
//      drop-out set.

interface BridgeProps {
	readonly inboxId: string
	readonly doc: TiptapDoc
	readonly uploader: ImageUploader
	readonly placeholder?: string | undefined
	readonly onChangeDoc: (next: TiptapDoc) => void
	readonly onFocus?: (() => void) | undefined
	readonly onBlur?: (() => void) | undefined
}

const EmailEditorBridge = (props: BridgeProps) => {
	const { doc, uploader, placeholder, onChangeDoc } = props

	// previewUrl → stagingId. Populated in onUploadImage; consumed in
	// onUpdate so tiptap-adapter's nodeToImage sees the staging kind
	// when the adapter is later run on the flushed doc.
	const uploadsRef = useRef<Map<string, string>>(new Map())
	// Known stagingIds from the previous flush — lets us detect removals.
	const priorStagingRef = useRef<Set<string>>(new Set(collectStagingIds(doc)))

	const theme = useMemo(buildEditorTheme, [])

	const handleUpload = useCallback<
		NonNullable<REEmailEditorProps['onUploadImage']>
	>(
		async file => {
			const resp = await uploader.upload({
				file,
				filename: file.name,
				contentType: file.type || 'application/octet-stream',
				inline: true,
			})
			uploadsRef.current.set(resp.previewUrl, resp.stagingId)
			return { url: resp.previewUrl }
		},
		[uploader],
	)

	const handleUpdate = useCallback(
		(ref: EmailEditorRef) => {
			const raw = ref.getJSON() as TiptapDoc
			const patched = patchStagingIds(raw, uploadsRef.current)
			const nextIds = new Set(collectStagingIds(patched))
			for (const prev of priorStagingRef.current) {
				if (!nextIds.has(prev)) {
					uploader.discard(prev).catch(() => {
						// TTL sweep is the fallback — swallow so the editor UX
						// doesn't stall on a transient DELETE failure.
					})
				}
			}
			priorStagingRef.current = nextIds
			onChangeDoc(patched)
		},
		[onChangeDoc, uploader],
	)

	// `content` type in the library is `Content` (from @tiptap/core); our
	// TiptapDoc is structurally the same shape. Cast via unknown to avoid
	// the transitive @tiptap/core dep here.
	const content = doc as unknown as NonNullable<REEmailEditorProps['content']>
	const themeProp = theme
	return (
		<REEmailEditor
			content={content}
			onUpdate={handleUpdate}
			onUploadImage={handleUpload}
			{...(themeProp !== undefined ? { theme: themeProp } : {})}
			{...(placeholder !== undefined ? { placeholder } : {})}
		/>
	)
}

// Walk the doc tree; for every image node where src matches a known
// previewUrl, attach the corresponding stagingId so the adapter can
// later resolve it to { kind: 'staging', stagingId }.
const patchStagingIds = (
	doc: TiptapDoc,
	uploads: ReadonlyMap<string, string>,
): TiptapDoc => ({
	type: 'doc',
	content: doc.content.map(n => patchNode(n, uploads)),
})

const patchNode = (
	node: TiptapNode,
	uploads: ReadonlyMap<string, string>,
): TiptapNode => {
	if (node.type === 'image') {
		const attrs = node.attrs ?? {}
		const src = typeof attrs['src'] === 'string' ? attrs['src'] : ''
		const existingStagingId = attrs['stagingId']
		if (typeof existingStagingId !== 'string' && src.length > 0) {
			const stagingId = uploads.get(src)
			if (stagingId) {
				return { ...node, attrs: { ...attrs, stagingId } }
			}
		}
		return node
	}
	if (node.content && node.content.length > 0) {
		return {
			...node,
			content: node.content.map(c => patchNode(c, uploads)),
		}
	}
	return node
}

const collectStagingIds = (doc: TiptapDoc): string[] => {
	const out: string[] = []
	const visit = (n: TiptapNode) => {
		if (n.type === 'image') {
			const id = n.attrs?.['stagingId']
			if (typeof id === 'string' && id.length > 0) out.push(id)
			return
		}
		for (const c of n.content ?? []) visit(c)
	}
	for (const n of doc.content) visit(n)
	return out
}

// Map the exported brandTheme values onto the library's ThemeConfig shape.
// The library already ships a 'basic' baseline; we only override the
// components whose visual identity we actually care about for the WYSIWYG
// match with the server renderer.
const buildEditorTheme = (): REEmailEditorProps['theme'] => ({
	extends: 'basic',
	styles: {
		body: {
			fontFamily: brandFonts.body,
			color: brandColors.onSurface,
			backgroundColor: '#FFFFFF',
			fontSize: '16px',
			lineHeight: '1.55',
		},
		h1: brandTheme.heading[1],
		h2: brandTheme.heading[2],
		h3: brandTheme.heading[3],
		paragraph: {
			fontFamily: brandFonts.body,
			color: brandColors.onSurface,
			margin: brandTheme.paragraph.margin,
			fontWeight: brandFontWeight.regular,
		},
		link: {
			color: brandColors.primary,
			textDecoration: 'underline',
		},
		image: {
			maxWidth: '100%',
			height: 'auto',
		},
	},
})
