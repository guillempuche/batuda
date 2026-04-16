import { Node } from '@tiptap/core'
import { Schema } from 'effect'

export const FaqItem = Schema.Struct({
	question: Schema.String,
	answer: Schema.String,
})
export type FaqItem = Schema.Schema.Type<typeof FaqItem>

export const FaqAttrs = Schema.Struct({
	heading: Schema.String,
	items: Schema.Array(FaqItem),
})
export type FaqAttrs = Schema.Schema.Type<typeof FaqAttrs>

export const FaqNode = Schema.Struct({
	type: Schema.Literal('faq'),
	attrs: FaqAttrs,
})
export type FaqNode = Schema.Schema.Type<typeof FaqNode>

export const Faq = Node.create({
	name: 'faq',
	group: 'block',
	atom: true,

	addAttributes() {
		return {
			heading: { default: '' },
			items: { default: [] },
		}
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', { 'data-type': 'faq', ...HTMLAttributes }]
	},

	parseHTML() {
		return [{ tag: 'div[data-type="faq"]' }]
	},
})
