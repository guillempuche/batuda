import { Trans, useLingui } from '@lingui/react/macro'
import { Check, ChevronsUpDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriDialog, PriSelect } from '@batuda/ui/pri'

import { DialogActions } from './instruction-page-chrome'

export type TransferCandidate = {
	readonly userId: string
	readonly label: string
}

/**
 * Hand a template you own to a colleague.
 *
 * Worth a confirmation of its own: once the template belongs to somebody else
 * it drops out of your library for good, because personal templates are only
 * ever readable by the person who owns them. Nobody but the new owner can pass
 * it back.
 */
export function TemplateTransferDialog({
	open,
	templateName,
	candidates,
	transferring,
	onConfirm,
	onClose,
	testId,
}: {
	readonly open: boolean
	readonly templateName: string
	// Everyone in the organization except the current owner.
	readonly candidates: ReadonlyArray<TransferCandidate>
	readonly transferring: boolean
	readonly onConfirm: (targetUserId: string) => void
	readonly onClose: () => void
	readonly testId: string
}) {
	const { t } = useLingui()
	const [targetUserId, setTargetUserId] = useState<string | null>(null)

	const items = useMemo(
		() => candidates.map(c => ({ value: c.userId, label: c.label })),
		[candidates],
	)
	const hasCandidates = items.length > 0

	return (
		<PriDialog.Root
			open={open}
			onOpenChange={(nextOpen: boolean) => {
				if (!nextOpen && !transferring) {
					setTargetUserId(null)
					onClose()
				}
			}}
		>
			<PriDialog.Portal>
				<PriDialog.Backdrop />
				<PriDialog.Popup mobile='action-sheet' data-testid={testId}>
					<PriDialog.Title>
						<Trans>Hand this template to a colleague?</Trans>
					</PriDialog.Title>
					<PriDialog.Description>
						<Trans>
							"{templateName}" becomes theirs. It leaves your library, and only
							they can hand it back.
						</Trans>
					</PriDialog.Description>

					{hasCandidates ? (
						<Picker>
							<Label htmlFor='transfer-target'>
								<Trans>New owner</Trans>
							</Label>
							<PriSelect.Root
								items={items}
								value={targetUserId}
								onValueChange={value => {
									if (typeof value === 'string') setTargetUserId(value)
								}}
							>
								<PriSelect.Trigger
									id='transfer-target'
									data-testid={`${testId}-target`}
								>
									<PriSelect.Value
										placeholder={t`Choose someone in your organization`}
									/>
									<PriSelect.Icon>
										<ChevronsUpDown size={12} aria-hidden />
									</PriSelect.Icon>
								</PriSelect.Trigger>
								<PriSelect.Portal>
									<PriSelect.Positioner
										alignItemWithTrigger={false}
										sideOffset={6}
									>
										<PriSelect.Popup>
											<PriSelect.List>
												{items.map(item => (
													<PriSelect.Item
														key={item.value}
														value={item.value}
														data-testid={`${testId}-option-${item.value}`}
													>
														<PriSelect.ItemIndicator>
															<Check size={12} aria-hidden />
														</PriSelect.ItemIndicator>
														<PriSelect.ItemText>
															{item.label}
														</PriSelect.ItemText>
													</PriSelect.Item>
												))}
											</PriSelect.List>
										</PriSelect.Popup>
									</PriSelect.Positioner>
								</PriSelect.Portal>
							</PriSelect.Root>
						</Picker>
					) : (
						<Note data-testid={`${testId}-empty`}>
							<Trans>
								There is nobody else in your organization to hand it to yet.
							</Trans>
						</Note>
					)}

					{/* Cancel first in the DOM so the safe action is the default target;
					    the reversed column below keeps the primary one visually on top. */}
					<SheetActions>
						<PriButton
							type='button'
							$variant='text'
							onClick={() => {
								if (!transferring) {
									setTargetUserId(null)
									onClose()
								}
							}}
						>
							<Trans>Cancel</Trans>
						</PriButton>
						<PriButton
							type='button'
							$variant='filled'
							data-testid={`${testId}-button`}
							disabled={transferring || targetUserId === null}
							onClick={() => {
								if (targetUserId !== null) onConfirm(targetUserId)
							}}
						>
							{transferring ? (
								<Trans>Handing over…</Trans>
							) : (
								<Trans>Hand it over</Trans>
							)}
						</PriButton>
					</SheetActions>
				</PriDialog.Popup>
			</PriDialog.Portal>
		</PriDialog.Root>
	)
}

const Picker = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	margin-top: var(--space-sm);
`

const Label = styled.label`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const Note = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: var(--space-sm) 0 0;
`

// On the phone action sheet the buttons stack full-width in the thumb zone.
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
