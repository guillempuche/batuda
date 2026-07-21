import { Trans } from '@lingui/react/macro'
import { type ReactNode, useId } from 'react'
import styled from 'styled-components'

import { PriButton } from '@batuda/ui/pri'

import { agedPaperSurface } from '#/lib/workshop-mixins'

/**
 * Tells the reader something broke while loading, so a failed fetch is never
 * mistaken for "you have no data". Omit `onRetry` when trying again cannot
 * help — a button that does nothing is worse than no button.
 *
 * `headingLevel` should match where the message sits in the page outline: 1
 * when the error replaces the whole page, 2 when it sits under a page title.
 */
export function ErrorState({
	title,
	description,
	onRetry,
	variant = 'card',
	headingLevel = 2,
	'data-testid': testId,
}: {
	title: string
	description?: ReactNode
	onRetry?: () => void
	variant?: 'card' | 'inline'
	headingLevel?: 1 | 2 | 3
	'data-testid'?: string
}) {
	const titleId = useId()

	// Naming the message keeps several Retry buttons on one page apart: a
	// screen reader reads "Retry, could not load your templates" rather than
	// an indistinguishable list of "Retry".
	const retryButton = onRetry && (
		<PriButton
			type='button'
			$variant='outlined'
			aria-describedby={titleId}
			onClick={() => onRetry()}
		>
			<Trans>Retry</Trans>
		</PriButton>
	)

	if (variant === 'inline') {
		return (
			<InlineWrapper
				role='group'
				aria-labelledby={titleId}
				data-testid={testId}
			>
				{/* Announced politely: something that failed to load is not
				    urgent enough to cut off whatever is being read. The Retry
				    button stays outside the announced part so it is offered as a
				    button to press, not read out as part of the sentence. */}
				<InlineText role='status'>
					<InlineTitle id={titleId}>{title}</InlineTitle>
					{description && <InlineDescription>{description}</InlineDescription>}
				</InlineText>
				{retryButton && <InlineActions>{retryButton}</InlineActions>}
			</InlineWrapper>
		)
	}

	return (
		<CardWrapper role='group' aria-labelledby={titleId} data-testid={testId}>
			<CardText role='status'>
				<CardTitle as={`h${headingLevel}`} id={titleId}>
					{title}
				</CardTitle>
				{description && <CardDescription>{description}</CardDescription>}
			</CardText>
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
	border-inline-start: 4px solid var(--color-error);
	color: var(--color-on-surface);
`

const CardText = styled.div.withConfig({ displayName: 'ErrorStateText' })`
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: var(--space-sm);
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
	border-inline-start: 3px solid var(--color-error);
	background: var(--color-error-container);
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
	color: var(--color-on-error-container);
`

const InlineDescription = styled.div.withConfig({
	displayName: 'ErrorStateInlineDescription',
})`
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-error-container);
	opacity: 0.85;
`

const InlineActions = styled.div.withConfig({
	displayName: 'ErrorStateInlineActions',
})`
	display: flex;
	align-items: center;
	gap: var(--space-2xs);
`
