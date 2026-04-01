export type { CtaAttrs, CtaButton } from './cta'
export { Cta } from './cta'
export type { HeroAttrs } from './hero'
export { Hero } from './hero'
export type { PainPointItem, PainPointsAttrs } from './pain-points'
export { PainPoints } from './pain-points'
export type { SocialProofAttrs, Testimonial } from './social-proof'
export { SocialProof } from './social-proof'
export type { ValuePropItem, ValuePropsAttrs } from './value-props'
export { ValueProps } from './value-props'

import { Cta } from './cta'
import { Hero } from './hero'
import { PainPoints } from './pain-points'
import { SocialProof } from './social-proof'
import { ValueProps } from './value-props'

export const allBlockExtensions = [
	Hero,
	Cta,
	ValueProps,
	PainPoints,
	SocialProof,
]
