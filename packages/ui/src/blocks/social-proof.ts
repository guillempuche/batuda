import { Node } from '@tiptap/core'
import { Schema } from 'effect'

export const Testimonial = Schema.Struct({
	quote: Schema.String,
	author: Schema.String,
	company: Schema.String,
})
export type Testimonial = Schema.Schema.Type<typeof Testimonial>

export const SocialProofAttrs = Schema.Struct({
	heading: Schema.String,
	testimonials: Schema.Array(Testimonial),
})
export type SocialProofAttrs = Schema.Schema.Type<typeof SocialProofAttrs>

export const SocialProofNode = Schema.Struct({
	type: Schema.Literal('socialProof'),
	attrs: SocialProofAttrs,
})
export type SocialProofNode = Schema.Schema.Type<typeof SocialProofNode>

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
