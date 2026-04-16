import { Node } from '@tiptap/core'
import { Schema } from 'effect'

export const EpiphanyBeat = Schema.Struct({
	heading: Schema.String,
	body: Schema.String,
})
export type EpiphanyBeat = Schema.Schema.Type<typeof EpiphanyBeat>

export const EpiphanyBridgeAttrs = Schema.Struct({
	oldWay: Schema.String,
	newWay: Schema.String,
	insight: Schema.String,
	desire: Schema.String,
	beats: Schema.Array(EpiphanyBeat),
})
export type EpiphanyBridgeAttrs = Schema.Schema.Type<typeof EpiphanyBridgeAttrs>

export const EpiphanyBridgeNode = Schema.Struct({
	type: Schema.Literal('epiphanyBridge'),
	attrs: EpiphanyBridgeAttrs,
})
export type EpiphanyBridgeNode = Schema.Schema.Type<typeof EpiphanyBridgeNode>

export const EpiphanyBridge = Node.create({
	name: 'epiphanyBridge',
	group: 'block',
	atom: true,

	addAttributes() {
		return {
			oldWay: { default: '' },
			newWay: { default: '' },
			insight: { default: '' },
			desire: { default: '' },
			beats: { default: [] },
		}
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', { 'data-type': 'epiphanyBridge', ...HTMLAttributes }]
	},

	parseHTML() {
		return [{ tag: 'div[data-type="epiphanyBridge"]' }]
	},
})
