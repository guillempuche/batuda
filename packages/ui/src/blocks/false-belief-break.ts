import { Node } from '@tiptap/core'
import { Schema } from 'effect'

export const FalseBelief = Schema.Struct({
	kind: Schema.Literals(['vehicle', 'internal', 'external']),
	readerThinks: Schema.String,
	counter: Schema.String,
})
export type FalseBelief = Schema.Schema.Type<typeof FalseBelief>

export const FalseBeliefBreakAttrs = Schema.Struct({
	heading: Schema.String,
	beliefs: Schema.Array(FalseBelief),
})
export type FalseBeliefBreakAttrs = Schema.Schema.Type<
	typeof FalseBeliefBreakAttrs
>

export const FalseBeliefBreakNode = Schema.Struct({
	type: Schema.Literal('falseBeliefBreak'),
	attrs: FalseBeliefBreakAttrs,
})
export type FalseBeliefBreakNode = Schema.Schema.Type<
	typeof FalseBeliefBreakNode
>

export const FalseBeliefBreak = Node.create({
	name: 'falseBeliefBreak',
	group: 'block',
	atom: true,

	addAttributes() {
		return {
			heading: { default: '' },
			beliefs: { default: [] },
		}
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', { 'data-type': 'falseBeliefBreak', ...HTMLAttributes }]
	},

	parseHTML() {
		return [{ tag: 'div[data-type="falseBeliefBreak"]' }]
	},
})
