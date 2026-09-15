import { useAtomSet } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { styled } from 'next-yak'
import { useId, useState } from 'react'

import { ATTRIBUTES_PER_STACK_MAX } from '@batuda/domain'
import { PriButton, PriSwitch, usePriToast } from '@batuda/ui/pri'

import {
	deleteAttributeAtom,
	updateAttributeAtom,
} from '#/atoms/attribute-atoms'
import { DeleteConfirm } from '#/components/shared/delete-confirm'
import { ErrorState } from '#/components/shared/error-state'
import { CHANGE_FAILED, kindLabel, outcomeMessage } from './attribute-messages'
import type { AttributeDeclaration } from './attribute-shapes'
import { InstructionIconButton } from './instruction-chrome'
import {
	Empty,
	RowActions,
	Section,
	SectionHead,
	SectionTitle,
	TemplateList,
	TemplateRowItem,
} from './instruction-page-chrome'
import { outcomeOf, type StackShape } from './instruction-shapes'

/**
 * The facts the organisation records on every company, grouped by the campaign
 * that declares them.
 *
 * Only research campaigns record attributes, so the section is not there for any
 * other surface. A row can be retired rather than deleted: retiring stops runs
 * filling it and frees one of the eight slots, while the values companies
 * already hold keep reading the way they were declared.
 */
export function AttributeSection({
	agent,
	stacks,
	declarations,
	failed,
	readOnly,
	onAdd,
	onEdit,
	onChanged,
	onRetry,
}: {
	readonly agent: string
	// The stacks for this surface, in the order the page lists them. Only the
	// organisation's own can declare anything, so the rest are passed over.
	readonly stacks: ReadonlyArray<StackShape>
	// null while the answer is not in, so the groups wait rather than reading as
	// campaigns that declare nothing.
	readonly declarations: ReadonlyArray<AttributeDeclaration> | null
	// Whether the last read failed. A section holding a list keeps showing it; one
	// holding nothing offers a retry rather than a wait that never ends.
	readonly failed: boolean
	readonly readOnly: boolean
	readonly onAdd: (stackId: string) => void
	readonly onEdit: (declaration: AttributeDeclaration) => void
	readonly onChanged: () => void
	readonly onRetry: () => void
}) {
	const { t, i18n } = useLingui()
	const toast = usePriToast()
	const updateAttribute = useAtomSet(updateAttributeAtom, {
		mode: 'promiseExit',
	})
	const deleteAttribute = useAtomSet(deleteAttributeAtom, {
		mode: 'promiseExit',
	})

	// The confirmation is a passing step in something already under way, so it
	// stays local rather than going in the address.
	const [confirming, setConfirming] = useState<AttributeDeclaration | null>(
		null,
	)
	const [deleting, setDeleting] = useState(false)
	// The row whose switch is mid-flight, so a second flick on the same one does
	// not race the first.
	const [busyId, setBusyId] = useState<string | null>(null)
	// Names the stale sentence so the Retry beside it reads as "Retry, the last
	// refresh failed" rather than as one of several identical buttons.
	const staleId = useId()

	if (agent !== 'research') return null

	const orgStacks = stacks.filter(stack => stack.scope === 'org')

	const showFailure = (outcome: string | null) => {
		toast.add({
			title: t`Couldn't save`,
			description: i18n._(outcomeMessage(outcome, CHANGE_FAILED)),
			type: 'error',
		})
	}

	const setActive = async (
		declaration: AttributeDeclaration,
		isActive: boolean,
	) => {
		if (busyId === declaration.id) return
		setBusyId(declaration.id)
		const exit = await updateAttribute({
			params: { id: declaration.id },
			payload: { is_active: isActive },
		} as never)
		setBusyId(null)
		const outcome = outcomeOf(exit)
		if (outcome !== 'updated') {
			showFailure(outcome)
			return
		}
		onChanged()
	}

	const confirmDelete = async () => {
		const target = confirming
		if (target === null || deleting) return
		setDeleting(true)
		const exit = await deleteAttribute({ params: { id: target.id } } as never)
		setDeleting(false)
		setConfirming(null)
		const outcome = outcomeOf(exit)
		if (outcome !== 'deleted') {
			showFailure(outcome)
			return
		}
		toast.add({ title: t`Attribute deleted`, type: 'success' })
		onChanged()
	}

	return (
		<Section data-testid='org-attributes'>
			<SectionHead>
				<SectionTitle>
					<Trans>Attributes</Trans>
				</SectionTitle>
			</SectionHead>
			<Hint>
				<Trans>
					The facts I want on every company a campaign researches. A run fills
					them from what it reads, once the campaign is set to.
				</Trans>
			</Hint>

			{orgStacks.length === 0 ? (
				<Empty>
					<Trans>
						Attributes belong to a campaign. Create an org stack first.
					</Trans>
				</Empty>
			) : declarations === null ? (
				failed ? (
					<ErrorState
						variant='inline'
						data-testid='org-attributes-error'
						title={t`Couldn't load the attributes.`}
						onRetry={onRetry}
					/>
				) : (
					<Empty>
						<Trans>Loading the attributes…</Trans>
					</Empty>
				)
			) : (
				<>
					{/* A held list with a failed refresh still says so: read in silence it
					    looks like what is declared right now. */}
					{failed ? (
						<Stale data-testid='org-attributes-stale'>
							<StaleText id={staleId} role='status'>
								<Trans>
									The last refresh failed. This is the list as it was loaded
									before.
								</Trans>
							</StaleText>
							<PriButton
								type='button'
								$variant='text'
								aria-describedby={staleId}
								onClick={() => onRetry()}
							>
								<Trans>Retry</Trans>
							</PriButton>
						</Stale>
					) : null}
					{orgStacks.map(stack => {
						const rows = declarations.filter(x => x.stackId === stack.id)
						const active = rows.filter(x => x.isActive).length
						const atCap = active >= ATTRIBUTES_PER_STACK_MAX
						return (
							<Group
								key={stack.id}
								data-testid={`org-attributes-stack-${stack.id}`}
							>
								<GroupHead>
									<GroupName>{stack.name}</GroupName>
									<Count>
										<Trans>
											{active} of {ATTRIBUTES_PER_STACK_MAX} active
										</Trans>
									</Count>
								</GroupHead>

								{rows.length === 0 ? (
									<Empty>
										<Trans>
											No attributes yet. Declare the facts this campaign records
											on every company.
										</Trans>
									</Empty>
								) : (
									<TemplateList>
										{rows.map(row => (
											<TemplateRowItem
												key={row.id}
												data-testid={`org-attribute-${stack.id}-${row.key}`}
											>
												<RowText>
													<RowLabel>{row.label}</RowLabel>
													<RowKey>{row.key}</RowKey>
												</RowText>
												<Meta>{i18n._(kindLabel(row.kind))}</Meta>
												{row.unit !== null && row.unit !== '' ? (
													<Meta>{row.unit}</Meta>
												) : null}
												{row.isActive ? null : (
													<Tag>
														<Trans>Inactive</Trans>
													</Tag>
												)}
												{readOnly ? null : (
													<RowActions>
														<InstructionIconButton
															type='button'
															aria-label={t`Edit ${row.label}`}
															data-testid={`org-attribute-edit-${stack.id}-${row.key}`}
															onClick={() => onEdit(row)}
														>
															<Pencil size={14} aria-hidden />
														</InstructionIconButton>
														{/* Flicking this takes effect at once, so it is a switch
													    rather than a box waiting for a save. The row is tight
													    on a phone, so the switch is named rather than
													    labelled with visible words. */}
														<PriSwitch.Root
															checked={row.isActive}
															disabled={busyId === row.id}
															aria-label={t`Keep ${row.label} active`}
															data-testid={`org-attribute-active-${stack.id}-${row.key}`}
															onCheckedChange={(next: boolean) => {
																void setActive(row, next)
															}}
														>
															<PriSwitch.Thumb />
														</PriSwitch.Root>
														<InstructionIconButton
															type='button'
															aria-label={t`Delete ${row.label}`}
															data-testid={`org-attribute-delete-${stack.id}-${row.key}`}
															onClick={() => setConfirming(row)}
														>
															<Trash2 size={14} aria-hidden />
														</InstructionIconButton>
													</RowActions>
												)}
											</TemplateRowItem>
										))}
									</TemplateList>
								)}

								{readOnly ? null : (
									<>
										<PriButton
											type='button'
											$variant='text'
											data-testid={`org-attributes-add-${stack.id}`}
											// aria-disabled, not disabled: the button stays in the tab
											// order so a keyboard reader meets the cap and the reason
											// for it rather than a control that is simply not there.
											aria-disabled={atCap}
											{...(atCap
												? {
														'aria-describedby': `org-attributes-cap-${stack.id}`,
													}
												: {})}
											onClick={() => {
												if (!atCap) onAdd(stack.id)
											}}
										>
											<Plus size={16} aria-hidden />
											<Trans>Add attribute</Trans>
										</PriButton>
										{atCap ? (
											<Hint id={`org-attributes-cap-${stack.id}`}>
												<Trans>
													This campaign is full at {ATTRIBUTES_PER_STACK_MAX}{' '}
													active attributes. Retire one to add another.
												</Trans>
											</Hint>
										) : null}
									</>
								)}
							</Group>
						)
					})}
				</>
			)}

			<DeleteConfirm
				open={confirming !== null}
				deleting={deleting}
				onConfirm={() => {
					void confirmDelete()
				}}
				onClose={() => setConfirming(null)}
				testId='org-attribute-delete-confirm'
				title={<Trans>Delete this attribute?</Trans>}
				description={
					<Trans>
						"{confirming?.label ?? ''}" goes off this campaign and runs stop
						filling it. The values companies already hold stay on their pages.
					</Trans>
				}
			/>
		</Section>
	)
}

const Hint = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	margin: 0;
`

// A held list with a failed refresh: said quietly, since the list below it is
// still the right one to read, only not the newest.
const Stale = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	flex-wrap: wrap;
`

const StaleText = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Group = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-left: var(--space-sm);
	border-left: 2px solid var(--color-ledger-line-strong);
`

const GroupHead = styled.div`
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--space-sm);
	flex-wrap: wrap;
`

const GroupName = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-label-large-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface);
`

const Count = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	white-space: nowrap;
`

// The name and the key together: the key is what a value is filed under, so it
// is worth seeing, but quietly and in the typeface of a stored name.
const RowText = styled.span`
	flex: 1 1 auto;
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	min-width: 0;

	@media (min-width: 768px) {
		flex-direction: row;
		align-items: baseline;
		gap: var(--space-2xs);
	}
`

const RowLabel = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const RowKey = styled.code`
	font-family: var(--font-mono);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const Meta = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	white-space: nowrap;
`

const Tag = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`
