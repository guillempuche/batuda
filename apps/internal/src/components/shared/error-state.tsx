import { Trans } from '@lingui/react/macro'
import type { ReactNode } from 'react'
import styled from 'styled-components'

import { PriButton } from '@batuda/ui/pri'

import { agedPaperSurface } from '#/lib/workshop-mixins'

/**
 * Tells the reader something broke while loading, so a failed fetch is never
 * mistaken for "you have no data". Omit `onRetry` when trying again cannot
 * help — a button that does nothing is worse than no button.
 */
export function ErrorState({
	title,
	description,
	onRetry,
	variant = 'card',
	'data-testid': testId,
}: {
	title: string
	description?: ReactNode
	onRetry?: () => void
	variant?: 'card' | 'inline'
	'data-testid'?: string
}) {
	const retryButton = onRetry && (
		<PriButton type='button' $variant='outlined' onClick={() => onRetry()}>
			<Trans>Retry</Trans>
		</PriButton>
	)

	if (variant === 'inline') {
		return (
			<InlineWrapper role='alert' data-testid={testId}>
				<InlineText>
					<InlineTitle>{title}</InlineTitle>
					{description && <InlineDescription>{description}</InlineDescription>}
				</InlineText>
				{retryButton && <InlineActions>{retryButton}</InlineActions>}
			</InlineWrapper>
		)
	}

	return (
		<CardWrapper role='alert' data-testid={testId}>
			<CardTitle>{title}</CardTitle>
			{description && <CardDescription>{description}</CardDescription>}
			{retryButton && <CardActions>{retryButton}</CardActions>}
		</CardWrapper>
	)
}

const CardWrapper = styled.div.withConfig({ displayName: 'ErrorState' })`
	${agedPaperSurface}
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: var(--space-sm);
	padding: var(--space-xl) var(--space-lg);
	margin: var(--space-md) auto;
	max-width: 32rem;
	text-align: center;
	border-left: 4px solid var(--color-error);
	color: var(--color-on-surface);
`

const CardTitle = styled.p.withConfig({ displayName: 'ErrorStateTitle' })`
	margin: 0;
	font-family: var(--font-display);
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--color-error);
`

const CardDescription = styled.div.withConfig({
	displayName: 'ErrorStateDescription',
})`
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	color: var(--color-on-surface-variant);
	max-width: 28rem;
`

const CardActions = styled.div.withConfig({ displayName: 'ErrorStateActions' })`
	display: flex;
	align-items: center;
	gap: var(--space-sm);
	margin-top: var(--space-2xs);
`

const InlineWrapper = styled.div.withConfig({
	displayName: 'ErrorStateInline',
})`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	flex-wrap: wrap;
	padding: var(--space-2xs) var(--space-sm);
	border-left: 3px solid var(--color-error);
	background: color-mix(in srgb, var(--color-error) 6%, transparent);
`

const InlineText = styled.div.withConfig({
	displayName: 'ErrorStateInlineText',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const InlineTitle = styled.p.withConfig({
	displayName: 'ErrorStateInlineTitle',
})`
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-error);
`

const InlineDescription = styled.div.withConfig({
	displayName: 'ErrorStateInlineDescription',
})`
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const InlineActions = styled.div.withConfig({
	displayName: 'ErrorStateInlineActions',
})`
	display: flex;
	align-items: center;
	gap: var(--space-2xs);
`
