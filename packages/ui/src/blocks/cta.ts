import { Node } from '@tiptap/core'
import { Schema } from 'effect'

export const CtaButton = Schema.Struct({
	label: Schema.String,
	action: Schema.String,
	url: Schema.String,
})
export type CtaButton = Schema.Schema.Type<typeof CtaButton>

export const CtaAttrs = Schema.Struct({
	heading: Schema.String,
	body: Schema.String,
	buttons: Schema.Array(CtaButton),
})
export type CtaAttrs = Schema.Schema.Type<typeof CtaAttrs>

export const CtaNode = Schema.Struct({
	type: Schema.Literal('cta'),
	attrs: CtaAttrs,
})
export type CtaNode = Schema.Schema.Type<typeof CtaNode>

export const Cta = Node.create({
	name: 'cta',
	group: 'block',
	atom: true,

	addAttributes() {
		return {
			heading: { default: '' },
			body: { default: '' },
			buttons: { default: [] },
		}
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', { 'data-type': 'cta', ...HTMLAttributes }]
	},

	parseHTML() {
		return [{ tag: 'div[data-type="cta"]' }]
	},
})
