import type { ReactNode } from 'react'
import styled from 'styled-components'

/**
 * Section title used across the Pipeline dashboard and any other
 * page that groups lists into buckets. Optional count badge shows
 * the item total; optional action slot renders a right-aligned
 * element (typically a "Mostra tot" link or a mini-button).
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
			<Heading>
				{title}
				{typeof count === 'number' && <Count>{count}</Count>}
			</Heading>
			{action && <Actions>{action}</Actions>}
		</Wrapper>
	)
}

const Wrapper = styled.div.withConfig({ displayName: 'SectionHeader' })`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	padding-bottom: var(--space-xs);
`

const Heading = styled.h3.withConfig({ displayName: 'SectionHeaderTitle' })`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	font-family: var(--font-body);
	font-size: var(--typescale-title-small-size);
	line-height: var(--typescale-title-small-line);
	font-weight: var(--typescale-title-small-weight);
	letter-spacing: var(--typescale-title-small-tracking);
	color: var(--color-on-surface);
	text-transform: uppercase;
	margin: 0;
`

const Count = styled.span.withConfig({ displayName: 'SectionHeaderCount' })`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 1.5rem;
	padding: 0 var(--space-2xs);
	height: 1.25rem;
	background: var(--color-surface-container);
	color: var(--color-on-surface-variant);
	border-radius: var(--shape-full);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-medium);
`

const Actions = styled.div.withConfig({ displayName: 'SectionHeaderActions' })`
	display: inline-flex;
	align-items: center;
	gap: var(--space-xs);
`
