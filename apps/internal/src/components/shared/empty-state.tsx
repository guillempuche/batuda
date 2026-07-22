import type { ComponentType, ReactNode } from 'react'
import styled from 'styled-components'

import {
	agedPaperSurface,
	brushedMetalBezel,
	maskingTapeCorner,
} from '#/lib/workshop-mixins'

/**
 * Aged-paper empty-state note. The outer card is taped to the workspace
 * via a beige masking-tape strip rotated at the top-left corner, and
 * the icon slot sits inside a brushed-metal bezel so it reads as a
 * tool pinned to the paper.
 *
 * `headingLevel` should match where the note sits in the page outline: 1
 * when the empty state replaces the whole page, 2 when it sits under a
 * page or section title. The title looks like a heading, so it is marked
 * up as one — otherwise it is skipped by heading navigation.
 */
export function EmptyState({
	icon: Icon,
	title,
	description,
	action,
	headingLevel = 2,
}: {
	icon?: ComponentType<{ size?: number | string; 'aria-hidden'?: boolean }>
	title: string
	description?: ReactNode
	action?: ReactNode
	headingLevel?: 1 | 2 | 3
}) {
	return (
		<Wrapper>
			<Tape aria-hidden />
			{Icon && (
				<Bezel>
					<Icon size={30} aria-hidden />
				</Bezel>
			)}
			<Title as={`h${headingLevel}`}>{title}</Title>
			{description && <Description>{description}</Description>}
			{action && <Actions>{action}</Actions>}
		</Wrapper>
	)
}

const Wrapper = styled.div.withConfig({ displayName: 'EmptyState' })`
	${agedPaperSurface}
	position: relative;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: var(--space-sm);
	padding: var(--space-2xl) var(--space-lg) var(--space-xl);
	margin: var(--space-md) auto;
	max-width: 32rem;
	text-align: center;
	color: var(--color-on-surface);
`

const Tape = styled.span.withConfig({ displayName: 'EmptyStateTape' })`
	${maskingTapeCorner}
`

const Bezel = styled.span.withConfig({ displayName: 'EmptyStateBezel' })`
	${brushedMetalBezel}
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 3.5rem;
	height: 3.5rem;
	margin-bottom: var(--space-2xs);
	border-radius: 50%;
	color: var(--color-on-surface);
`

const Title = styled.p.withConfig({ displayName: 'EmptyStateTitle' })`
	margin: 0;
	font-family: var(--font-display);
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--color-on-surface);
	text-shadow: var(--text-shadow-emboss);
`

const Description = styled.div.withConfig({
	displayName: 'EmptyStateDescription',
})`
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	color: var(--color-on-surface-variant);
	max-width: 28rem;
	font-style: italic;
`

const Actions = styled.div.withConfig({ displayName: 'EmptyStateActions' })`
	margin-top: var(--space-xs);
`
