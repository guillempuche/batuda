import { Node } from '@tiptap/core'
import { Schema } from 'effect'

export const HeroCta = Schema.Struct({
	label: Schema.String,
	action: Schema.String,
})
export type HeroCta = Schema.Schema.Type<typeof HeroCta>

export const HeroAttrs = Schema.Struct({
	heading: Schema.String,
	subheading: Schema.String,
	cta: HeroCta,
})
export type HeroAttrs = Schema.Schema.Type<typeof HeroAttrs>

export const HeroNode = Schema.Struct({
	type: Schema.Literal('hero'),
	attrs: HeroAttrs,
})
export type HeroNode = Schema.Schema.Type<typeof HeroNode>

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
