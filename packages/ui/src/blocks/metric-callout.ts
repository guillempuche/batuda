import { Node } from '@tiptap/core'
import { Schema } from 'effect'

export const MetricCalloutAttrs = Schema.Struct({
	value: Schema.String,
	unit: Schema.String,
	caption: Schema.String,
})
export type MetricCalloutAttrs = Schema.Schema.Type<typeof MetricCalloutAttrs>

export const MetricCalloutNode = Schema.Struct({
	type: Schema.Literal('metricCallout'),
	attrs: MetricCalloutAttrs,
})
export type MetricCalloutNode = Schema.Schema.Type<typeof MetricCalloutNode>

export const MetricCallout = Node.create({
	name: 'metricCallout',
	group: 'block',
	atom: true,

	addAttributes() {
		return {
			value: { default: '' },
			unit: { default: '' },
			caption: { default: '' },
		}
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', { 'data-type': 'metricCallout', ...HTMLAttributes }]
	},

	parseHTML() {
		return [{ tag: 'div[data-type="metricCallout"]' }]
	},
})
