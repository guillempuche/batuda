import type { ReactNode } from 'react'
import styled from 'styled-components'

import { brushedMetalPlate, stenciledTitle } from '#/lib/workshop-mixins'

/**
 * Stenciled display-font section title with a ruler under-rule. Optional
 * count badge renders as a mini stamped-metal tag; the action slot stays
 * right-aligned for "show all" links or toolbar buttons.
 */
export function SectionHeader({
	title,
	count,
	action,
}: {
	title: string
	count?: number
	action?: ReactNode
}) {
	return (
		<Wrapper>
			<TitleRow>
				<Heading>{title}</Heading>
				{typeof count === 'number' && <Count>{count}</Count>}
			</TitleRow>
			{action && <Actions>{action}</Actions>}
		</Wrapper>
	)
}

const Wrapper = styled.div.withConfig({ displayName: 'SectionHeader' })`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	padding-bottom: var(--space-sm);
	background-image: repeating-linear-gradient(
		90deg,
		var(--color-ledger-line-strong) 0 4px,
		transparent 4px 10px
	);
	background-repeat: no-repeat;
	background-position: left bottom;
	background-size: 100% 1px;
`

const TitleRow = styled.div.withConfig({
	displayName: 'SectionHeaderTitleRow',
})`
	display: inline-flex;
	align-items: center;
	gap: var(--space-sm);
	min-width: 0;
`

const Heading = styled.h3.withConfig({ displayName: 'SectionHeaderTitle' })`
	${stenciledTitle}
	margin: 0;
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
`

const Count = styled.span.withConfig({ displayName: 'SectionHeaderCount' })`
	${brushedMetalPlate}
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 1.75rem;
	padding: 2px var(--space-2xs);
	border-radius: var(--shape-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.04em;
	color: var(--color-on-surface);
	text-shadow: var(--text-shadow-emboss);
`

const Actions = styled.div.withConfig({ displayName: 'SectionHeaderActions' })`
	display: inline-flex;
	align-items: center;
	gap: var(--space-xs);
`
