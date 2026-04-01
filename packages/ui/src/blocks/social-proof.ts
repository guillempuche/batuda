import { Node } from '@tiptap/core'

export interface Testimonial {
	quote: string
	author: string
	company: string
}

export interface SocialProofAttrs {
	heading: string
	testimonials: Testimonial[]
}

export const SocialProof = Node.create({
	name: 'socialProof',
	group: 'block',
	atom: true,

	addAttributes() {
		return {
			heading: { default: '' },
			testimonials: { default: [] },
		}
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', { 'data-type': 'socialProof', ...HTMLAttributes }]
	},

	parseHTML() {
		return [{ tag: 'div[data-type="socialProof"]' }]
	},
})
