import { Schema } from 'effect'

import { ComparisonTable, ComparisonTableNode } from './comparison-table'
import { Cta, CtaNode } from './cta'
import { EpiphanyBridge, EpiphanyBridgeNode } from './epiphany-bridge'
import { FalseBeliefBreak, FalseBeliefBreakNode } from './false-belief-break'
import { Faq, FaqNode } from './faq'
import { Hero, HeroNode } from './hero'
import { MetricCallout, MetricCalloutNode } from './metric-callout'
import { PainPoints, PainPointsNode } from './pain-points'
import { Proof, ProofNode } from './proof'
import { RichText, RichTextNode } from './rich-text'
import { RiskReversal, RiskReversalNode } from './risk-reversal'
import { SocialProof, SocialProofNode } from './social-proof'
import { ValueProps, ValuePropsNode } from './value-props'

export type {
	ComparisonRow,
	ComparisonTableAttrs,
	ComparisonTableNode,
} from './comparison-table'
export {
	ComparisonTable,
	ComparisonTableNode as ComparisonTableNodeSchema,
} from './comparison-table'
export type { CtaAttrs, CtaButton, CtaNode } from './cta'
export { Cta, CtaNode as CtaNodeSchema } from './cta'
export type {
	EpiphanyBeat,
	EpiphanyBridgeAttrs,
	EpiphanyBridgeNode,
} from './epiphany-bridge'
export {
	EpiphanyBridge,
	EpiphanyBridgeNode as EpiphanyBridgeNodeSchema,
} from './epiphany-bridge'
export type {
	FalseBelief,
	FalseBeliefBreakAttrs,
	FalseBeliefBreakNode,
} from './false-belief-break'
export {
	FalseBeliefBreak,
	FalseBeliefBreakNode as FalseBeliefBreakNodeSchema,
} from './false-belief-break'
export type { FaqAttrs, FaqItem, FaqNode } from './faq'
export { Faq, FaqNode as FaqNodeSchema } from './faq'
export type { HeroAttrs, HeroCta, HeroNode } from './hero'
export { Hero, HeroNode as HeroNodeSchema } from './hero'
export type { MetricCalloutAttrs, MetricCalloutNode } from './metric-callout'
export {
	MetricCallout,
	MetricCalloutNode as MetricCalloutNodeSchema,
} from './metric-callout'
export type {
	PainPointItem,
	PainPointsAttrs,
	PainPointsNode,
} from './pain-points'
export {
	PainPoints,
	PainPointsNode as PainPointsNodeSchema,
} from './pain-points'
export type { ProofAttrs, ProofMetric, ProofNode } from './proof'
export { Proof, ProofNode as ProofNodeSchema } from './proof'
export type {
	RichTextInline,
	RichTextMark,
	RichTextNode,
	RichTextParagraph,
} from './rich-text'
export { RichText, RichTextNode as RichTextNodeSchema } from './rich-text'
export type { RiskReversalAttrs, RiskReversalNode } from './risk-reversal'
export {
	RiskReversal,
	RiskReversalNode as RiskReversalNodeSchema,
} from './risk-reversal'
export type {
	SocialProofAttrs,
	SocialProofNode,
	Testimonial,
} from './social-proof'
export {
	SocialProof,
	SocialProofNode as SocialProofNodeSchema,
} from './social-proof'
export type {
	ValuePropItem,
	ValuePropsAttrs,
	ValuePropsNode,
} from './value-props'
export {
	ValueProps,
	ValuePropsNode as ValuePropsNodeSchema,
} from './value-props'

export const BlockNode = Schema.Union([
	HeroNode,
	CtaNode,
	ValuePropsNode,
	PainPointsNode,
	SocialProofNode,
	RichTextNode,
	EpiphanyBridgeNode,
	ProofNode,
	FalseBeliefBreakNode,
	RiskReversalNode,
	FaqNode,
	ComparisonTableNode,
	MetricCalloutNode,
])
export type BlockNode = Schema.Schema.Type<typeof BlockNode>

export const TiptapDocument = Schema.Struct({
	type: Schema.Literal('doc'),
	content: Schema.Array(BlockNode),
})
export type TiptapDocument = Schema.Schema.Type<typeof TiptapDocument>

export const allBlockExtensions = [
	Hero,
	Cta,
	ValueProps,
	PainPoints,
	SocialProof,
	RichText,
	EpiphanyBridge,
	Proof,
	FalseBeliefBreak,
	RiskReversal,
	Faq,
	ComparisonTable,
	MetricCallout,
]
