import { Node } from '@tiptap/core'

export interface CtaButton {
	label: string
	action: string
	url: string
}

export interface CtaAttrs {
	heading: string
	body: string
	buttons: CtaButton[]
}

export const Cta = Node.create({
	name: 'cta',
	group: 'block',
	atom: true,

	addAttributes() {
		return {
			heading: { default: '' },
			body: { default: '' },
			buttons: { default: [] },
		}
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', { 'data-type': 'cta', ...HTMLAttributes }]
	},

	parseHTML() {
		return [{ tag: 'div[data-type="cta"]' }]
	},
})
