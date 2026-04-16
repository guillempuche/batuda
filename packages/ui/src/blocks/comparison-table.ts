import { Node } from '@tiptap/core'
import { Schema } from 'effect'

export const ComparisonRow = Schema.Struct({
	left: Schema.String,
	right: Schema.String,
})
export type ComparisonRow = Schema.Schema.Type<typeof ComparisonRow>

export const ComparisonTableAttrs = Schema.Struct({
	heading: Schema.String,
	leftLabel: Schema.String,
	rightLabel: Schema.String,
	rows: Schema.Array(ComparisonRow),
})
export type ComparisonTableAttrs = Schema.Schema.Type<
	typeof ComparisonTableAttrs
>

export const ComparisonTableNode = Schema.Struct({
	type: Schema.Literal('comparisonTable'),
	attrs: ComparisonTableAttrs,
})
export type ComparisonTableNode = Schema.Schema.Type<typeof ComparisonTableNode>

export const ComparisonTable = Node.create({
	name: 'comparisonTable',
	group: 'block',
	atom: true,

	addAttributes() {
		return {
			heading: { default: '' },
			leftLabel: { default: '' },
			rightLabel: { default: '' },
			rows: { default: [] },
		}
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', { 'data-type': 'comparisonTable', ...HTMLAttributes }]
	},

	parseHTML() {
		return [{ tag: 'div[data-type="comparisonTable"]' }]
	},
})
