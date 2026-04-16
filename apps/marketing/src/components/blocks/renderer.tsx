import type { BlockNode, TiptapDocument } from '@engranatge/ui/blocks'

import { ComparisonTableBlock } from './comparison-table-block'
import { CtaBlock } from './cta-block'
import { EpiphanyBridgeBlock } from './epiphany-bridge-block'
import { FalseBeliefBreakBlock } from './false-belief-break-block'
import { FaqBlock } from './faq-block'
import { HeroBlock } from './hero-block'
import { MetricCalloutBlock } from './metric-callout-block'
import { PainPointsBlock } from './pain-points-block'
import { ProofBlock } from './proof-block'
import { RichTextBlock } from './rich-text-block'
import { RiskReversalBlock } from './risk-reversal-block'
import { SocialProofBlock } from './social-proof-block'
import { ValuePropsBlock } from './value-props-block'

function renderBlock(node: BlockNode, key: number) {
	switch (node.type) {
		case 'hero':
			return <HeroBlock key={key} attrs={node.attrs} />
		case 'cta':
			return <CtaBlock key={key} attrs={node.attrs} />
		case 'valueProps':
			return <ValuePropsBlock key={key} attrs={node.attrs} />
		case 'painPoints':
			return <PainPointsBlock key={key} attrs={node.attrs} />
		case 'socialProof':
			return <SocialProofBlock key={key} attrs={node.attrs} />
		case 'richText':
			return <RichTextBlock key={key} node={node} />
		case 'epiphanyBridge':
			return <EpiphanyBridgeBlock key={key} attrs={node.attrs} />
		case 'proof':
			return <ProofBlock key={key} attrs={node.attrs} />
		case 'falseBeliefBreak':
			return <FalseBeliefBreakBlock key={key} attrs={node.attrs} />
		case 'riskReversal':
			return <RiskReversalBlock key={key} attrs={node.attrs} />
		case 'faq':
			return <FaqBlock key={key} attrs={node.attrs} />
		case 'comparisonTable':
			return <ComparisonTableBlock key={key} attrs={node.attrs} />
		case 'metricCallout':
			return <MetricCalloutBlock key={key} attrs={node.attrs} />
	}
}

export function PageRenderer({ doc }: { doc: TiptapDocument }) {
	return <>{doc.content.map((node, i) => renderBlock(node, i))}</>
}
