import { Node } from '@tiptap/core'

export interface ValuePropItem {
	title: string
	body: string
	image?: string
}

export interface ValuePropsAttrs {
	heading: string
	items: ValuePropItem[]
}

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
