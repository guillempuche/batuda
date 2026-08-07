import { Trans } from '@lingui/react/macro'
import type { ReactNode } from 'react'
import styled from 'styled-components'

import { PriButton, PriDialog } from '@batuda/ui/pri'

// Asking before something is removed. The plumbing is the same wherever it is
// asked — a focus-trapped popup, a confirm button that disables while the work
// runs, and Cancel — so each caller passes only its own wording and a test id.
// The dialog stays open mid-action so a row cannot disappear under a
// half-finished one.
export function DeleteConfirm({
	open,
	deleting,
	onConfirm,
	onClose,
	testId,
	title,
	description,
	confirmLabel,
	busyLabel,
	destructive,
}: {
	readonly open: boolean
	readonly deleting: boolean
	readonly onConfirm: () => void
	readonly onClose: () => void
	readonly testId: string
	readonly title: ReactNode
	readonly description: ReactNode
	// What the confirm button says. Defaults to Delete; a caller undoing
	// something rather than removing it passes its own word.
	readonly confirmLabel?: ReactNode
	readonly busyLabel?: ReactNode
	readonly destructive?: boolean
}) {
	return (
		<PriDialog.Root
			open={open}
			onOpenChange={(nextOpen: boolean) => {
				if (!nextOpen && !deleting) onClose()
			}}
		>
			<PriDialog.Portal>
				<PriDialog.Backdrop />
				<PriDialog.Popup mobile='action-sheet' data-testid={testId}>
					<PriDialog.Title>{title}</PriDialog.Title>
					<PriDialog.Description>{description}</PriDialog.Description>
					{/* Cancel is first in the DOM so the safe action is the default target
					    (keyboard order, and initial focus once dialogs focus in). The
					    reversed column below keeps the destructive button visually on top. */}
					<SheetActions>
						<PriButton
							type='button'
							$variant='text'
							onClick={() => {
								if (!deleting) onClose()
							}}
						>
							<Trans>Cancel</Trans>
						</PriButton>
						{/* Confirm button gets its own selector so tests can click it apart from the popup. */}
						<PriButton
							type='button'
							$variant={destructive === false ? 'filled' : 'destructive'}
							data-testid={`${testId}-button`}
							// Stays focusable while it runs: taking focus away mid-action
							// drops the reader at the top of the page with no idea whether
							// anything happened.
							disabled={deleting}
							focusableWhenDisabled
							aria-busy={deleting}
							onClick={onConfirm}
						>
							{deleting
								? (busyLabel ?? <Trans>Deleting…</Trans>)
								: (confirmLabel ?? <Trans>Delete</Trans>)}
						</PriButton>
					</SheetActions>
				</PriDialog.Popup>
			</PriDialog.Portal>
		</PriDialog.Root>
	)
}

// On the phone action sheet the buttons stack full-width in the thumb zone.
// column-reverse puts the destructive Delete on top and Cancel at the bottom
// (most reachable, the safe default) while Cancel stays first in the DOM.
const SheetActions = styled.div`
	display: flex;
	gap: var(--space-sm);
	justify-content: flex-end;
	margin-top: var(--space-md);

	@media (max-width: 40rem) {
		flex-direction: column-reverse;
		align-items: stretch;
		gap: var(--space-xs);

		& > * {
			width: 100%;
		}
	}
`
