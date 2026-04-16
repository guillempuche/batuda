import { Node } from '@tiptap/core'
import { Schema } from 'effect'

export const RiskReversalAttrs = Schema.Struct({
	heading: Schema.String,
	body: Schema.String,
	guarantees: Schema.Array(Schema.String),
})
export type RiskReversalAttrs = Schema.Schema.Type<typeof RiskReversalAttrs>

export const RiskReversalNode = Schema.Struct({
	type: Schema.Literal('riskReversal'),
	attrs: RiskReversalAttrs,
})
export type RiskReversalNode = Schema.Schema.Type<typeof RiskReversalNode>

export const RiskReversal = Node.create({
	name: 'riskReversal',
	group: 'block',
	atom: true,

	addAttributes() {
		return {
			heading: { default: '' },
			body: { default: '' },
			guarantees: { default: [] },
		}
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', { 'data-type': 'riskReversal', ...HTMLAttributes }]
	},

	parseHTML() {
		return [{ tag: 'div[data-type="riskReversal"]' }]
	},
})
