import { Node } from '@tiptap/core'

export interface PainPointItem {
	icon: string
	title: string
	body: string
}

export interface PainPointsAttrs {
	heading: string
	items: PainPointItem[]
}

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
