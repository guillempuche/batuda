import { Node } from '@tiptap/core'
import { Schema } from 'effect'

export const ValuePropItem = Schema.Struct({
	title: Schema.String,
	body: Schema.String,
	image: Schema.optional(Schema.String),
})
export type ValuePropItem = Schema.Schema.Type<typeof ValuePropItem>

export const ValuePropsAttrs = Schema.Struct({
	heading: Schema.String,
	items: Schema.Array(ValuePropItem),
})
export type ValuePropsAttrs = Schema.Schema.Type<typeof ValuePropsAttrs>

export const ValuePropsNode = Schema.Struct({
	type: Schema.Literal('valueProps'),
	attrs: ValuePropsAttrs,
})
export type ValuePropsNode = Schema.Schema.Type<typeof ValuePropsNode>

export const ValueProps = Node.create({
	name: 'valueProps',
	group: 'block',
	atom: true,

	addAttributes() {
		return {
			heading: { default: '' },
			items: { default: [] },
		}
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', { 'data-type': 'valueProps', ...HTMLAttributes }]
	},

	parseHTML() {
		return [{ tag: 'div[data-type="valueProps"]' }]
	},
})
