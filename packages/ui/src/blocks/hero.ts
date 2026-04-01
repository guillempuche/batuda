import { Node } from '@tiptap/core'

export interface HeroAttrs {
	heading: string
	subheading: string
	cta: { label: string; action: string }
}

export const Hero = Node.create({
	name: 'hero',
	group: 'block',
	atom: true,

	addAttributes() {
		return {
			heading: { default: '' },
			subheading: { default: '' },
			cta: { default: { label: '', action: '' } },
		}
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', { 'data-type': 'hero', ...HTMLAttributes }]
	},

	parseHTML() {
		return [{ tag: 'div[data-type="hero"]' }]
	},
})
