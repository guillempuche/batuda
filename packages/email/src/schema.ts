import { Schema } from 'effect'

// Outbound email body as a typed tree. Shared across the HTTP draft API,
// MCP tool validation, the server-side renderer, and the editor's
// serialized JSON. The tree is the single source of truth — html and
// text outputs are derived at render time.

// Link hrefs — the only schemes we let through end-to-end. Anything else
// becomes plain text at the sanitizer boundary; if the schema sees it,
// it's because the caller (MCP tool / HTTP client) tried to bypass the
// sanitizer, so we reject outright.
const LinkHref = Schema.String.check(
	Schema.makeFilter(
		(s: string): true | string =>
			/^(https?:\/\/|mailto:)/i.test(s) ||
			`href must start with http://, https://, or mailto: — got ${JSON.stringify(s)}`,
	),
)

// Image url-source hrefs — same scheme gate but excluding mailto (an
// <img src="mailto:…"> is nonsense). http is allowed; TLS is a transport
// concern. Host allowlisting is enforced at the MCP layer, not here —
// human-authored emails may legitimately reference any https image.
const ImageHref = Schema.String.check(
	Schema.makeFilter(
		(s: string): true | string =>
			/^https?:\/\//i.test(s) ||
			`image href must start with http:// or https:// — got ${JSON.stringify(s)}`,
	),
)

export const TextSpan = Schema.Struct({
	kind: Schema.Literal('text'),
	value: Schema.String,
	bold: Schema.optional(Schema.Boolean),
	italic: Schema.optional(Schema.Boolean),
	strike: Schema.optional(Schema.Boolean),
	code: Schema.optional(Schema.Boolean),
})
export type TextSpan = typeof TextSpan.Type

export const LinkSpan = Schema.Struct({
	kind: Schema.Literal('link'),
	href: LinkHref,
	text: Schema.String,
	bold: Schema.optional(Schema.Boolean),
	italic: Schema.optional(Schema.Boolean),
})
export type LinkSpan = typeof LinkSpan.Type

export const BreakSpan = Schema.Struct({
	kind: Schema.Literal('break'),
})
export type BreakSpan = typeof BreakSpan.Type

export const Span = Schema.Union([TextSpan, LinkSpan, BreakSpan])
export type Span = typeof Span.Type

export const ParagraphBlock = Schema.Struct({
	type: Schema.Literal('paragraph'),
	spans: Schema.Array(Span),
})
export type ParagraphBlock = typeof ParagraphBlock.Type

const HeadingLevel = Schema.Literals([1, 2, 3] as const)
export type HeadingLevel = typeof HeadingLevel.Type

export const HeadingBlock = Schema.Struct({
	type: Schema.Literal('heading'),
	level: HeadingLevel,
	spans: Schema.Array(Span),
})
export type HeadingBlock = typeof HeadingBlock.Type

export const ListBlock = Schema.Struct({
	type: Schema.Literal('list'),
	ordered: Schema.Boolean,
	items: Schema.Array(Schema.Array(Span)),
})
export type ListBlock = typeof ListBlock.Type

export const DividerBlock = Schema.Struct({
	type: Schema.Literal('divider'),
})
export type DividerBlock = typeof DividerBlock.Type

const ImageDim = Schema.Number.check(
	Schema.makeFilter(
		(n: number): true | string =>
			(Number.isInteger(n) && n > 0) ||
			'image dimension must be a positive integer',
	),
)

const ImageSourceStaging = Schema.Struct({
	kind: Schema.Literal('staging'),
	// Human drafts: in-progress upload. Renderer resolves stagingId → cid at send.
	stagingId: Schema.String.check(Schema.isMinLength(1)),
})
const ImageSourceCid = Schema.Struct({
	kind: Schema.Literal('cid'),
	// Inherited from a quoted parent; the bytes are already a provider-resident
	// inline MIME part that we re-attach on send.
	cid: Schema.String.check(Schema.isMinLength(1)),
})
const ImageSourceUrl = Schema.Struct({
	kind: Schema.Literal('url'),
	href: ImageHref,
})

export const ImageSource = Schema.Union([
	ImageSourceStaging,
	ImageSourceCid,
	ImageSourceUrl,
])
export type ImageSource = typeof ImageSource.Type

export const ImageBlock = Schema.Struct({
	type: Schema.Literal('image'),
	source: ImageSource,
	alt: Schema.String,
	width: Schema.optional(ImageDim),
	height: Schema.optional(ImageDim),
})
export type ImageBlock = typeof ImageBlock.Type

// Recursive forward-declaration for the quote branch. Quote can contain
// arbitrarily nested quotes — reply chains walk this naturally.
export interface QuoteBlock {
	readonly type: 'quote'
	readonly children: ReadonlyArray<EmailBlock>
}

export type EmailBlock =
	| ParagraphBlock
	| HeadingBlock
	| ListBlock
	| QuoteBlock
	| DividerBlock
	| ImageBlock

export const EmailBlock: Schema.Codec<EmailBlock> = Schema.suspend(
	(): Schema.Codec<EmailBlock> =>
		Schema.Union([
			ParagraphBlock,
			HeadingBlock,
			ListBlock,
			QuoteBlock,
			DividerBlock,
			ImageBlock,
		]),
)

export const QuoteBlock: Schema.Codec<QuoteBlock> = Schema.Struct({
	type: Schema.Literal('quote'),
	children: Schema.Array(
		Schema.suspend((): Schema.Codec<EmailBlock> => EmailBlock),
	),
})

// The top-level body — an ordered, possibly-empty array of blocks.
// Empty is allowed: a user may clear the body and save the draft.
export const EmailBlocks = Schema.Array(EmailBlock)
export type EmailBlocks = typeof EmailBlocks.Type
