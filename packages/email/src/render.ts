// Server-side renderer. Takes an EmailBlock tree + resolved attachment
// references, emits { html, text, resolvedAttachments } suitable for
// handing to the email provider. Used by the MCP send path and the
// human draft-save path — single pipeline, one rendered shape.

import { render, toPlainText } from '@react-email/render'
import type { ReactElement } from 'react'
import { createElement } from 'react'

import { AgentEmail } from './components/agent-email'
import type { EmailBlock, ImageBlock, Span } from './schema'

// ────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────

// One entry per staged attachment referenced by the tree. The render
// pipeline only needs metadata (cid, filename, contentType) — the actual
// bytes travel out-of-band to the provider, keyed by stagingId.
export interface StagedAttachmentRef {
	readonly stagingId: string
	readonly cid: string
	readonly filename: string
	readonly contentType: string
	readonly inline: boolean
}

// Resolved attachment handed back to the caller — same shape as input,
// plus a guarantee that exactly the ones referenced in the tree are
// included (deduplicated by stagingId).
export interface ResolvedAttachment {
	readonly stagingId: string
	readonly cid: string
	readonly filename: string
	readonly contentType: string
	readonly inline: boolean
}

export interface RenderOptions {
	readonly preview?: string | undefined
	readonly attachments?: ReadonlyArray<StagedAttachmentRef> | undefined
	readonly signOff?:
		| {
				readonly author?: string | undefined
				readonly brand?: string | undefined
				readonly city?: string | undefined
		  }
		| undefined
}

export interface RenderedEmail {
	readonly html: string
	readonly text: string
	readonly resolvedAttachments: ReadonlyArray<ResolvedAttachment>
}

// ────────────────────────────────────────────────────────────────────
// renderBlocks
// ────────────────────────────────────────────────────────────────────

export const renderBlocks = async (
	blocks: ReadonlyArray<EmailBlock>,
	options: RenderOptions = {},
): Promise<RenderedEmail> => {
	const stagingIndex = indexStaging(options.attachments ?? [])
	const used = new Set<string>()
	// Walk the tree once to detect missing staging refs before we spend
	// cycles rendering — every image block with kind='staging' must map
	// to a ref supplied by the caller.
	validateStagingRefs(blocks, stagingIndex, used)

	const element: ReactElement = createElement(AgentEmail, {
		blocks,
		stagingIndex,
		preview: options.preview,
		signOff: options.signOff,
	})

	const html = await render(element, { pretty: false })
	const text = renderBlocksText(blocks, options)

	const resolvedAttachments: ResolvedAttachment[] = []
	const seen = new Set<string>()
	for (const id of used) {
		if (seen.has(id)) continue
		seen.add(id)
		const ref = stagingIndex.get(id)
		if (ref) resolvedAttachments.push(ref)
	}
	// Non-image staged refs (e.g. PDF attachment) are always forwarded
	// regardless of whether the body references them — users add chips
	// explicitly and expect them to travel.
	for (const ref of options.attachments ?? []) {
		if (seen.has(ref.stagingId)) continue
		if (ref.inline) continue
		seen.add(ref.stagingId)
		resolvedAttachments.push(ref)
	}

	return { html, text, resolvedAttachments }
}

export type StagingIndex = ReadonlyMap<string, StagedAttachmentRef>

const indexStaging = (
	refs: ReadonlyArray<StagedAttachmentRef>,
): StagingIndex => {
	const m = new Map<string, StagedAttachmentRef>()
	for (const ref of refs) m.set(ref.stagingId, ref)
	return m
}

const validateStagingRefs = (
	blocks: ReadonlyArray<EmailBlock>,
	index: StagingIndex,
	used: Set<string>,
): void => {
	for (const block of blocks) walkForStaging(block, index, used)
}

const walkForStaging = (
	block: EmailBlock,
	index: StagingIndex,
	used: Set<string>,
): void => {
	if (block.type === 'image') {
		if (block.source.kind === 'staging') {
			if (!index.has(block.source.stagingId)) {
				throw new Error(
					`renderBlocks: image block references staging id "${block.source.stagingId}" but no matching attachment was supplied`,
				)
			}
			used.add(block.source.stagingId)
		}
		return
	}
	if (block.type === 'quote') {
		for (const c of block.children) walkForStaging(c, index, used)
	}
}

// ────────────────────────────────────────────────────────────────────
// Plain text renderer — dedicated walker. Using toPlainText(html) would
// lose the "> " prefix on quoted subtrees; we emit our own text form.
// ────────────────────────────────────────────────────────────────────

const renderBlocksText = (
	blocks: ReadonlyArray<EmailBlock>,
	options: RenderOptions,
): string => {
	const lines: string[] = []
	// Many clients show the preview string as the inbox snippet; the
	// HTML path emits it via <Preview>. We skip it in text — it's a
	// visual-client hint only.
	for (const block of blocks) renderBlockText(block, lines, 0)
	if (options.signOff) {
		const { author, brand, city } = options.signOff
		const parts = [author, brand, city].filter((p): p is string => !!p)
		if (parts.length > 0) {
			lines.push('')
			lines.push(parts.join(' · ').toUpperCase())
		}
	}
	// Trim trailing blanks, ensure single trailing newline.
	while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
	return `${lines.join('\n')}\n`
}

const renderBlockText = (
	block: EmailBlock,
	lines: string[],
	depth: number,
): void => {
	const prefix = '> '.repeat(depth)
	switch (block.type) {
		case 'paragraph': {
			const text = spansToText(block.spans)
			if (text.length === 0) {
				lines.push(prefix.trimEnd())
				lines.push('')
				return
			}
			for (const piece of text.split('\n')) lines.push(prefix + piece)
			lines.push(prefix.trimEnd())
			return
		}
		case 'heading': {
			const text = spansToText(block.spans)
			const underline = block.level === 1 ? '=' : block.level === 2 ? '-' : '·'
			lines.push(prefix + text)
			lines.push(
				prefix + underline.repeat(Math.max(3, Math.min(40, text.length))),
			)
			lines.push(prefix.trimEnd())
			return
		}
		case 'list': {
			block.items.forEach((item, i) => {
				const marker = block.ordered ? `${i + 1}. ` : '- '
				const text = spansToText(item)
				lines.push(prefix + marker + text)
			})
			lines.push(prefix.trimEnd())
			return
		}
		case 'divider':
			lines.push(`${prefix}---`)
			lines.push(prefix.trimEnd())
			return
		case 'image': {
			const label = block.alt ? `[image: ${block.alt}]` : '[image]'
			lines.push(prefix + label)
			lines.push(prefix.trimEnd())
			return
		}
		case 'quote': {
			for (const c of block.children) renderBlockText(c, lines, depth + 1)
			return
		}
	}
}

const spansToText = (spans: ReadonlyArray<Span>): string => {
	let out = ''
	for (const s of spans) {
		if (s.kind === 'break') {
			out += '\n'
			continue
		}
		if (s.kind === 'link') {
			// "text (href)" form — familiar from Markdown-link-to-text and
			// preserves the URL for recipients on text-only clients.
			out += s.text === s.href ? s.href : `${s.text} (${s.href})`
			continue
		}
		out += s.value
	}
	return out
}

// ────────────────────────────────────────────────────────────────────
// Re-export for consumers who want the lower-level HTML → text utility.
// ────────────────────────────────────────────────────────────────────

export { render, toPlainText }

// Image source resolver — exported so AgentEmail can call back into a
// single place for consistent cid/url resolution.
export const resolveImageSrc = (
	block: ImageBlock,
	index: StagingIndex,
): string => {
	if (block.source.kind === 'staging') {
		const ref = index.get(block.source.stagingId)
		if (!ref) {
			throw new Error(
				`resolveImageSrc: missing staging ref for ${block.source.stagingId}`,
			)
		}
		return `cid:${ref.cid}`
	}
	if (block.source.kind === 'cid') return `cid:${block.source.cid}`
	return block.source.href
}
