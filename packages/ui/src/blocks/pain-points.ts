import { Node } from '@tiptap/core'
import { Schema } from 'effect'

export const PainPointItem = Schema.Struct({
	icon: Schema.String,
	title: Schema.String,
	body: Schema.String,
})
export type PainPointItem = Schema.Schema.Type<typeof PainPointItem>

export const PainPointsAttrs = Schema.Struct({
	heading: Schema.String,
	items: Schema.Array(PainPointItem),
})
export type PainPointsAttrs = Schema.Schema.Type<typeof PainPointsAttrs>

export const PainPointsNode = Schema.Struct({
	type: Schema.Literal('painPoints'),
	attrs: PainPointsAttrs,
})
export type PainPointsNode = Schema.Schema.Type<typeof PainPointsNode>

export const PainPoints = Node.create({
	name: 'painPoints',
	group: 'block',
	atom: true,

	addAttributes() {
		return {
			heading: { default: '' },
			items: { default: [] },
		}
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', { 'data-type': 'painPoints', ...HTMLAttributes }]
	},

	parseHTML() {
		return [{ tag: 'div[data-type="painPoints"]' }]
	},
})
