import { Node } from '@tiptap/core'
import { Schema } from 'effect'

export const RichTextMark = Schema.Union([
	Schema.Struct({ type: Schema.Literal('bold') }),
	Schema.Struct({ type: Schema.Literal('italic') }),
	Schema.Struct({
		type: Schema.Literal('link'),
		attrs: Schema.Struct({
			href: Schema.String,
			target: Schema.optional(Schema.String),
		}),
	}),
])
export type RichTextMark = Schema.Schema.Type<typeof RichTextMark>

export const RichTextInline = Schema.Struct({
	type: Schema.Literal('text'),
	text: Schema.String,
	marks: Schema.optional(Schema.Array(RichTextMark)),
})
export type RichTextInline = Schema.Schema.Type<typeof RichTextInline>

export const RichTextParagraph = Schema.Struct({
	type: Schema.Literal('paragraph'),
	content: Schema.optional(Schema.Array(RichTextInline)),
})
export type RichTextParagraph = Schema.Schema.Type<typeof RichTextParagraph>

export const RichTextNode = Schema.Struct({
	type: Schema.Literal('richText'),
	content: Schema.Array(RichTextParagraph),
})
export type RichTextNode = Schema.Schema.Type<typeof RichTextNode>

export const RichText = Node.create({
	name: 'richText',
	group: 'block',
	content: 'paragraph+',

	renderHTML({ HTMLAttributes }) {
		return ['div', { 'data-type': 'richText', ...HTMLAttributes }, 0]
	},

	parseHTML() {
		return [{ tag: 'div[data-type="richText"]' }]
	},
})
