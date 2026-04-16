import { Node } from '@tiptap/core'
import { Schema } from 'effect'

export const ProofMetric = Schema.Struct({
	label: Schema.String,
	humanValue: Schema.String,
	machineValue: Schema.String,
	unit: Schema.String,
})
export type ProofMetric = Schema.Schema.Type<typeof ProofMetric>

export const ProofAttrs = Schema.Struct({
	heading: Schema.String,
	metrics: Schema.Array(ProofMetric),
})
export type ProofAttrs = Schema.Schema.Type<typeof ProofAttrs>

export const ProofNode = Schema.Struct({
	type: Schema.Literal('proof'),
	attrs: ProofAttrs,
})
export type ProofNode = Schema.Schema.Type<typeof ProofNode>

export const Proof = Node.create({
	name: 'proof',
	group: 'block',
	atom: true,

	addAttributes() {
		return {
			heading: { default: '' },
			metrics: { default: [] },
		}
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', { 'data-type': 'proof', ...HTMLAttributes }]
	},

	parseHTML() {
		return [{ tag: 'div[data-type="proof"]' }]
	},
})
