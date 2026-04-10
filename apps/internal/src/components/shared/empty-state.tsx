import type { ComponentType, ReactNode } from 'react'
import styled from 'styled-components'

/**
 * Generic empty-state block. Use whenever a list, filter, or feed has
 * no results — the goal is to explain the absence and (optionally)
 * surface a call-to-action that would populate it.
 */
export function EmptyState({
	icon: Icon,
	title,
	description,
	action,
}: {
	icon?: ComponentType<{ size?: number | string; 'aria-hidden'?: boolean }>
	title: string
	description?: string
	action?: ReactNode
}) {
	return (
		<Wrapper>
			{Icon && (
				<IconWrap>
					<Icon size={32} aria-hidden />
				</IconWrap>
			)}
			<Title>{title}</Title>
			{description && <Description>{description}</Description>}
			{action && <Actions>{action}</Actions>}
		</Wrapper>
	)
}

const Wrapper = styled.div.withConfig({ displayName: 'EmptyState' })`
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: var(--space-xs);
	padding: var(--space-2xl) var(--space-lg);
	text-align: center;
	color: var(--color-on-surface-variant);
`

const IconWrap = styled.div.withConfig({ displayName: 'EmptyStateIcon' })`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 4rem;
	height: 4rem;
	margin-bottom: var(--space-xs);
	border-radius: var(--shape-full);
	background: var(--color-surface-container);
	color: var(--color-on-surface-variant);
`

const Title = styled.p.withConfig({ displayName: 'EmptyStateTitle' })`
	font-family: var(--font-display);
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
	font-weight: var(--font-weight-medium);
	color: var(--color-on-surface);
	margin: 0;
`

const Description = styled.p.withConfig({
	displayName: 'EmptyStateDescription',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	color: var(--color-on-surface-variant);
	max-width: 28rem;
	margin: 0;
`

const Actions = styled.div.withConfig({ displayName: 'EmptyStateActions' })`
	margin-top: var(--space-sm);
`
