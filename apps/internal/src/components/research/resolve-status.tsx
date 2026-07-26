import { Trans, useLingui } from '@lingui/react/macro'
import { useEffect, useRef } from 'react'
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
	const undoRef = useRef<HTMLButtonElement>(null)
	const wrapRef = useRef<HTMLDivElement>(null)

	// Pressing apply or reject removes the button that was pressed, which left
	// the keyboard back at the top of the document — from there, reaching the next
	// row meant tabbing past the whole toolbar and every row above it. Taking the
	// change back is what follows from the press, so that is where the keyboard
	// goes; it also puts the one control that stops the write within reach of
	// someone who cannot see that it appeared.
	//
	// Once the change is on its way that button goes too, which would drop the
	// keyboard a second time — so the row itself takes over, but only while the
	// reader is still standing here. Pulling focus back to a row they have already
	// left would be worse than losing it.
	useEffect(() => {
		if (undoable) {
			undoRef.current?.focus()
			return
		}
		const wrap = wrapRef.current
		if (wrap?.contains(document.activeElement)) wrap.focus()
	}, [undoable])

	return (
		<Wrap ref={wrapRef} tabIndex={-1} data-testid={testId}>
			<Label>{decision === 'apply' ? t`Applying…` : t`Rejecting…`}</Label>
			{undoable ? (
				<UndoButton
					ref={undoRef}
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

	/* Takes the keyboard when the take-back control goes away, so it shows a mark
	   there rather than appearing to land nowhere. */
	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
		border-radius: var(--shape-2xs);
	}
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
