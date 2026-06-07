import { Trans } from '@lingui/react/macro'
import type { ReactNode } from 'react'

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
				<PriDialog.Popup data-testid={testId}>
					<PriDialog.Title>{title}</PriDialog.Title>
					<PriDialog.Description>{description}</PriDialog.Description>
					<DialogActions>
						{/* Confirm button gets its own selector so tests can click it apart from the popup. */}
						<PriButton
							type='button'
							$variant='filled'
							data-testid={`${testId}-button`}
							disabled={deleting}
							onClick={onConfirm}
						>
							{deleting ? <Trans>Deleting…</Trans> : <Trans>Delete</Trans>}
						</PriButton>
						<PriDialog.Close
							render={props => (
								<PriButton type='button' $variant='text' {...props}>
									<Trans>Cancel</Trans>
								</PriButton>
							)}
						/>
					</DialogActions>
				</PriDialog.Popup>
			</PriDialog.Portal>
		</PriDialog.Root>
	)
}
