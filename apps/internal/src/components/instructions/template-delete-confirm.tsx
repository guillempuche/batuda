import { Trans } from '@lingui/react/macro'
import type { ReactNode } from 'react'
import styled from 'styled-components'

import { PriButton, PriDialog } from '@batuda/ui/pri'

import { DialogActions } from './instruction-page-chrome'

// Delete-confirmation dialog shared by the personal and org template pages.
// The plumbing is identical — a focus-trapped popup, a Delete button that
// disables while the delete runs, and Cancel — so each page passes only its
// own wording and a test id. The dialog stays open mid-delete so a row can't
// disappear under a half-finished action.
export function TemplateDeleteConfirm({
	open,
	deleting,
	onConfirm,
	onClose,
	testId,
	title,
	description,
}: {
	readonly open: boolean
	readonly deleting: boolean
	readonly onConfirm: () => void
	readonly onClose: () => void
	readonly testId: string
	readonly title: ReactNode
	readonly description: ReactNode
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
							$variant='destructive'
							data-testid={`${testId}-button`}
							disabled={deleting}
							onClick={onConfirm}
						>
							{deleting ? <Trans>Deleting…</Trans> : <Trans>Delete</Trans>}
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
const SheetActions = styled(DialogActions)`
	@media (max-width: 40rem) {
		flex-direction: column-reverse;
		align-items: stretch;
		gap: var(--space-xs);

		& > * {
			width: 100%;
		}
	}
`
