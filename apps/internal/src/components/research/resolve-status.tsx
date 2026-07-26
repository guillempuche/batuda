import { Trans, useLingui } from '@lingui/react/macro'
import styled from 'styled-components'

import type { ResolveDecision } from '#/hooks/use-proposal-resolution'

/**
 * What a row says about a change the reader has just decided on, shared by the
 * review queue and a run's own review so both behave identically.
 *
 * Two states, and the difference matters: while the change is still held back it
 * can be taken back, and while it is on its way it cannot. Offering to take back
 * something already sent would clear the row while the change still lands.
 */
export function ResolveStatus({
	decision,
	undoable,
	onUndo,
	testId,
}: {
	readonly decision: ResolveDecision
	readonly undoable: boolean
	readonly onUndo: () => void
	readonly testId: string
}) {
	const { t } = useLingui()
	return (
		<Wrap data-testid={testId}>
			<Label>{decision === 'apply' ? t`Applying…` : t`Rejecting…`}</Label>
			{undoable ? (
				<UndoButton
					type='button'
					onClick={onUndo}
					data-testid={`${testId}-undo`}
				>
					<Trans>Undo</Trans>
				</UndoButton>
			) : null}
		</Wrap>
	)
}

/** An amount, aligned so figures in a column line up. */
export const Money = styled.span.withConfig({ displayName: 'Money' })`
	font-family: var(--font-mono);
	font-size: var(--typescale-body-small-size);
	font-variant-numeric: tabular-nums;
	color: var(--color-on-surface-variant);
`

const Wrap = styled.div.withConfig({ displayName: 'ResolveStatusWrap' })`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
`

const Label = styled.span.withConfig({ displayName: 'ResolveStatusLabel' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
`

const UndoButton = styled.button.withConfig({ displayName: 'UndoButton' })`
	/* Small text made this under the 24px a pointer needs, and it is the only
	   thing that stops a change being written. */
	min-height: 1.5rem;
	min-width: 1.5rem;
	padding-inline: var(--space-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--color-primary);
	background: none;
	border: none;
	cursor: pointer;

	&:hover {
		text-decoration: underline;
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
		border-radius: var(--shape-2xs);
	}
`
