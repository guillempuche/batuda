import { useAtomSet } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import {
	Check,
	ChevronsUpDown,
	Pencil,
	ShieldAlert,
	Star,
	Trash2,
	X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import styled from 'styled-components'

import { CHANNEL_KINDS } from '@batuda/domain'
import {
	PriButton,
	PriDialog,
	PriField,
	PriInput,
	PriMenu,
	PriSelect,
	usePriToast,
} from '@batuda/ui/pri'

import { TrustBadge } from '#/components/research/trust-badge'
import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import { badRequestMessage } from '#/lib/tagged-failure'
import { agedPaperRow, stenciledTitle } from '#/lib/workshop-mixins'
import { useChannelKindLabel } from './channel-kind-label'
import type { DisplayChannel } from './display-channels'

type Props = {
	// `null` keeps the dialog closed; any id opens it for that contact.
	readonly contactId: string | null
	readonly contactName: string
	readonly channels: ReadonlyArray<DisplayChannel>
	readonly onClose: () => void
	readonly onChanged: () => void
}

type Draft = { kind: string; value: string; label: string }

const EMPTY_DRAFT: Draft = { kind: 'email', value: '', label: '' }

export function ManageChannelsDialog({
	contactId,
	contactName,
	channels,
	onClose,
	onChanged,
}: Props) {
	const { t } = useLingui()
	const toast = usePriToast()
	const kindLabel = useChannelKindLabel()

	const addChannel = useAtomSet(
		BatudaApiAtom.mutation('contacts', 'addChannel'),
		{ mode: 'promiseExit' },
	)
	const updateChannel = useAtomSet(
		BatudaApiAtom.mutation('contacts', 'updateChannel'),
		{ mode: 'promiseExit' },
	)
	const deleteChannel = useAtomSet(
		BatudaApiAtom.mutation('contacts', 'deleteChannel'),
		{ mode: 'promiseExit' },
	)

	const [newKind, setNewKind] = useState<string>('email')
	const [newValue, setNewValue] = useState<string>('')
	const [newLabel, setNewLabel] = useState<string>('')
	const [adding, setAdding] = useState(false)
	const [addError, setAddError] = useState<string | null>(null)

	// One row at a time: two half-finished rows on screen cannot be told apart.
	const [editingId, setEditingId] = useState<string | null>(null)
	const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
	// Which row is mid-write, so a slow save on one never freezes the others.
	const [busyId, setBusyId] = useState<string | null>(null)
	const [rowError, setRowError] = useState<{
		id: string
		message: string
	} | null>(null)

	// The dialog stays mounted between people, so without this the last person's
	// half-typed address turns up on the next one — and a row id left behind
	// would point into a list it does not belong to.
	//
	// biome-ignore lint/correctness/useExhaustiveDependencies: the contact is what this clears for, and the body only writes — reading it here would be the same value every time
	useEffect(() => {
		setNewKind('email')
		setNewValue('')
		setNewLabel('')
		setAdding(false)
		setAddError(null)
		setEditingId(null)
		setDraft(EMPTY_DRAFT)
		setBusyId(null)
		setRowError(null)
	}, [contactId])

	// A refusal is about the text still in the box, so it belongs beside it. A
	// write that simply did not land has nothing to point at, so it goes to a
	// toast that names which address it was about.
	const reportFailure = (ch: DisplayChannel, cause: unknown) => {
		const message = badRequestMessage(cause)
		if (message !== null) {
			setRowError({ id: ch.id, message })
			return
		}
		toast.add({
			title: t`Could not change ${ch.value}`,
			description: t`The change didn't go through. Try again.`,
			type: 'error',
		})
		console.error('[batuda] contacts.updateChannel failed', cause)
	}

	const handleAdd = async () => {
		const value = newValue.trim()
		if (!contactId || value === '' || adding) return
		setAdding(true)
		setAddError(null)
		const label = newLabel.trim()
		const exit = await addChannel({
			params: { id: contactId },
			// An empty label is left out rather than stored blank, so "nobody named
			// this one" stays distinct from "somebody named it the empty string".
			payload: { kind: newKind, value, ...(label ? { label } : {}) },
		} as never)
		setAdding(false)
		if (exit._tag === 'Success') {
			setNewValue('')
			setNewLabel('')
			onChanged()
			return
		}
		const message = badRequestMessage(exit.cause)
		if (message !== null) {
			setAddError(message)
			return
		}
		toast.add({
			title: t`Could not add ${value}`,
			description: t`The change didn't go through. Try again.`,
			type: 'error',
		})
	}

	const startEdit = (ch: DisplayChannel) => {
		setEditingId(ch.id)
		setDraft({ kind: ch.kind, value: ch.value, label: ch.label ?? '' })
		setRowError(null)
	}

	const cancelEdit = () => {
		setEditingId(null)
		setRowError(null)
	}

	const submitEdit = async (ch: DisplayChannel) => {
		if (!contactId || busyId !== null) return
		const value = draft.value.trim()
		if (value === '') {
			setRowError({ id: ch.id, message: t`An address can't be blank.` })
			return
		}
		// An empty box means "take the name back off", which the server spells as
		// null; leaving the box as it was changes nothing.
		const label = draft.label.trim() === '' ? null : draft.label.trim()
		const payload: Record<string, unknown> = {}
		if (draft.kind !== ch.kind) payload['kind'] = draft.kind
		if (value !== ch.value) payload['value'] = value
		if (label !== ch.label) payload['label'] = label
		// A save that changes nothing is a cancel, not a round trip.
		if (Object.keys(payload).length === 0) {
			cancelEdit()
			return
		}
		setBusyId(ch.id)
		setRowError(null)
		const exit = await updateChannel({
			params: { id: contactId, channelId: ch.id },
			payload,
		} as never)
		setBusyId(null)
		if (exit._tag === 'Success') {
			setEditingId(null)
			onChanged()
			return
		}
		reportFailure(ch, exit.cause)
	}

	const handleRemove = async (ch: DisplayChannel) => {
		if (!contactId || busyId !== null) return
		setBusyId(ch.id)
		const exit = await deleteChannel({
			params: { id: contactId, channelId: ch.id },
		} as never)
		setBusyId(null)
		if (exit._tag === 'Success') onChanged()
		else reportFailure(ch, exit.cause)
	}

	const patchRow = async (
		ch: DisplayChannel,
		payload: Record<string, unknown>,
	) => {
		if (!contactId || busyId !== null) return
		setBusyId(ch.id)
		const exit = await updateChannel({
			params: { id: contactId, channelId: ch.id },
			payload,
		} as never)
		setBusyId(null)
		if (exit._tag === 'Success') onChanged()
		else reportFailure(ch, exit.cause)
	}

	return (
		<PriDialog.Root
			open={contactId !== null}
			onOpenChange={(open: boolean) => {
				if (!open) onClose()
			}}
		>
			<PriDialog.Portal>
				<PriDialog.Backdrop />
				<PriDialog.Popup data-testid='manage-channels-dialog'>
					<Header>
						<PriDialog.Title render={<Title />}>
							<Trans>Channels — {contactName}</Trans>
						</PriDialog.Title>
						<PriDialog.Close
							render={props => (
								<CloseButton type='button' aria-label={t`Close`} {...props}>
									<X size={18} />
								</CloseButton>
							)}
						/>
					</Header>

					{channels.length === 0 ? (
						<Empty>
							<Trans>
								No channels yet. Add the first reachable address below.
							</Trans>
						</Empty>
					) : (
						<ChannelList>
							{channels.map(ch => (
								<ChannelRow key={ch.id} data-testid={`channel-row-${ch.id}`}>
									{editingId === ch.id ? (
										<EditForm
											action={() => {
												void submitEdit(ch)
											}}
											onKeyDown={event => {
												if (event.key === 'Escape') cancelEdit()
											}}
										>
											<KindPicker
												value={draft.kind}
												disabled={busyId === ch.id}
												label={t`Kind`}
												testId={`channel-kind-${ch.id}`}
												kindLabel={kindLabel}
												onChange={kind => {
													setDraft(d => ({ ...d, kind }))
													setRowError(null)
												}}
											/>
											<PriField.Root>
												<PriField.Label htmlFor={`channel-value-${ch.id}`}>
													<Trans>Address</Trans>
												</PriField.Label>
												<PriInput
													id={`channel-value-${ch.id}`}
													data-testid={`channel-value-${ch.id}`}
													// The row only opens on the reader's own click, and a
													// wrong address is what they came to change.
													autoFocus
													value={draft.value}
													onChange={e => {
														setDraft(d => ({ ...d, value: e.target.value }))
														setRowError(null)
													}}
												/>
											</PriField.Root>
											<PriField.Root>
												<PriField.Label htmlFor={`channel-label-${ch.id}`}>
													<Trans>Name</Trans>
												</PriField.Label>
												<PriInput
													id={`channel-label-${ch.id}`}
													data-testid={`channel-label-${ch.id}`}
													placeholder={t`orders, Girona shop…`}
													value={draft.label}
													onChange={e => {
														setDraft(d => ({ ...d, label: e.target.value }))
														setRowError(null)
													}}
												/>
											</PriField.Root>
											<EditActions>
												<PriButton
													type='submit'
													data-testid={`channel-save-${ch.id}`}
													disabled={busyId === ch.id}
												>
													<Trans>Save</Trans>
												</PriButton>
												<PriButton
													type='button'
													$variant='text'
													data-testid={`channel-cancel-${ch.id}`}
													onClick={cancelEdit}
												>
													<Trans>Cancel</Trans>
												</PriButton>
											</EditActions>
											{rowError?.id === ch.id ? (
												<RowError
													role='alert'
													data-testid={`channel-error-${ch.id}`}
												>
													{rowError.message}
												</RowError>
											) : null}
										</EditForm>
									) : (
										<>
											<Kind>{kindLabel(ch.kind)}</Kind>
											<Value>
												{ch.value}
												{ch.label ? (
													<ChannelLabel>{ch.label}</ChannelLabel>
												) : null}
												{ch.kind === 'email' &&
												(ch.verification !== null || ch.confidence !== null) ? (
													<TrustBadge
														verification={ch.verification}
														confidence={ch.confidence}
														machineCheckable
													/>
												) : null}
											</Value>
											<RowActions>
												{ch.kind === 'email' ? (
													<PriMenu.Root>
														<PriMenu.Trigger
															render={props => (
																<IconButton
																	type='button'
																	aria-label={t`How far ${ch.value} is trusted`}
																	data-testid={`channel-trust-${ch.id}`}
																	disabled={busyId === ch.id}
																	{...props}
																>
																	<ShieldAlert size={14} />
																</IconButton>
															)}
														/>
														<PriMenu.Portal>
															<PriMenu.Positioner sideOffset={6}>
																<PriMenu.Popup>
																	{/* Three verbs rather than a picker: a control
																that can only ever go down is a lie about
																being two-way. Each is a whole string of its
																own — Catalan agrees the adjective with a
																gender a slot cannot carry — and each reuses
																the word the badge already shows, so the row
																and the card never say two things about one
																address.

																"Unverified" is deliberately not offered: it
																records a check that settled nothing, which
																reads identically to removing a verdict and
																leaves a reader picking between two controls
																that look the same. Removing shows only when
																there is one to remove. */}
																	<PriMenu.Item
																		data-testid='channel-trust-option-risky'
																		onClick={() =>
																			void patchRow(ch, {
																				verification: 'risky',
																			})
																		}
																	>
																		<span>{t`Mark as risky`}</span>
																	</PriMenu.Item>
																	<PriMenu.Item
																		data-testid='channel-trust-option-undeliverable'
																		onClick={() =>
																			void patchRow(ch, {
																				verification: 'undeliverable',
																			})
																		}
																	>
																		<span>{t`Mark as undeliverable`}</span>
																	</PriMenu.Item>
																	{ch.verification !== null ? (
																		<PriMenu.Item
																			data-testid='channel-trust-option-clear'
																			onClick={() =>
																				void patchRow(ch, {
																					verification: null,
																				})
																			}
																		>
																			<span>{t`Remove this verdict`}</span>
																		</PriMenu.Item>
																	) : null}
																	<MenuNote>
																		<Trans>
																			This is what we expect before sending. A
																			bounce is what happened after.
																		</Trans>
																	</MenuNote>
																</PriMenu.Popup>
															</PriMenu.Positioner>
														</PriMenu.Portal>
													</PriMenu.Root>
												) : null}
												<IconButton
													type='button'
													aria-label={
														ch.isPrimary
															? t`${ch.value} is the main ${kindLabel(ch.kind)}`
															: t`Use ${ch.value} as the main ${kindLabel(ch.kind)}`
													}
													data-testid={`channel-primary-${ch.id}`}
													$active={ch.isPrimary}
													disabled={ch.isPrimary || busyId === ch.id}
													onClick={() =>
														void patchRow(ch, { is_primary: true })
													}
												>
													<Star
														size={14}
														{...(ch.isPrimary ? { fill: 'currentColor' } : {})}
													/>
												</IconButton>
												<IconButton
													type='button'
													aria-label={t`Edit ${kindLabel(ch.kind)} ${ch.value}`}
													data-testid={`channel-edit-${ch.id}`}
													disabled={busyId === ch.id}
													onClick={() => startEdit(ch)}
												>
													<Pencil size={14} />
												</IconButton>
												<IconButton
													type='button'
													aria-label={t`Remove ${kindLabel(ch.kind)} ${ch.value}`}
													data-testid={`channel-remove-${ch.id}`}
													disabled={busyId === ch.id}
													onClick={() => void handleRemove(ch)}
												>
													<Trash2 size={14} />
												</IconButton>
											</RowActions>
											{rowError?.id === ch.id ? (
												<RowError
													role='alert'
													data-testid={`channel-error-${ch.id}`}
												>
													{rowError.message}
												</RowError>
											) : null}
										</>
									)}
								</ChannelRow>
							))}
						</ChannelList>
					)}

					{/* Says what each verb means, not what the send path does with it.
					    The two are not the same — "unverified" asserts nothing, so it
					    reads like an address nobody checked — and which verdicts stop a
					    send is the sending side's rule to state, not this dialog's. */}
					<Note>
						<Trans>
							Risky and undeliverable record doubt about an address. Removing a
							verdict says nobody has checked, which is the truth about one that
							was written down rather than found out. Only a check can confirm
							an address again.
						</Trans>
					</Note>

					<AddForm
						action={() => {
							void handleAdd()
						}}
					>
						<KindPicker
							value={newKind}
							disabled={adding}
							label={t`Kind`}
							testId='channel-add-kind'
							kindLabel={kindLabel}
							onChange={setNewKind}
						/>
						<PriField.Root>
							<PriField.Label htmlFor='channel-add-value'>
								<Trans>Address</Trans>
							</PriField.Label>
							<PriInput
								id='channel-add-value'
								data-testid='channel-add-value'
								placeholder={t`name@company.com`}
								value={newValue}
								onChange={e => {
									setNewValue(e.target.value)
									setAddError(null)
								}}
							/>
						</PriField.Root>
						<PriField.Root>
							<PriField.Label htmlFor='channel-add-label'>
								<Trans>Name</Trans>
							</PriField.Label>
							<PriInput
								id='channel-add-label'
								data-testid='channel-add-label'
								placeholder={t`orders, Girona shop…`}
								value={newLabel}
								onChange={e => setNewLabel(e.target.value)}
							/>
						</PriField.Root>
						<PriButton
							type='submit'
							data-testid='channel-add-submit'
							disabled={adding || newValue.trim() === ''}
						>
							<Trans>Add</Trans>
						</PriButton>
						{addError ? (
							<RowError role='alert' data-testid='channel-add-error'>
								{addError}
							</RowError>
						) : null}
					</AddForm>
				</PriDialog.Popup>
			</PriDialog.Portal>
		</PriDialog.Root>
	)
}

// The kinds the picker offers come from the shared list, so one that has an icon
// and a spoken name is always one somebody can choose.
//
// A synthetic click cannot hold this open — the press opens it and the release
// closes it again — so an agent driving the app by hand should focus the trigger
// and press ArrowDown instead. See .claude/skills/debug-apps/SKILL.md. Playwright
// drives it directly, which is what the end-to-end test does.
function KindPicker({
	value,
	disabled,
	label,
	testId,
	kindLabel,
	onChange,
}: {
	readonly value: string
	readonly disabled: boolean
	readonly label: string
	readonly testId: string
	readonly kindLabel: (kind: string) => string
	readonly onChange: (kind: string) => void
}) {
	return (
		<PriField.Root>
			<PriField.Label>{label}</PriField.Label>
			<PriSelect.Root
				items={CHANNEL_KINDS.map(kind => ({
					value: kind,
					label: kindLabel(kind),
				}))}
				value={value}
				onValueChange={v => {
					if (typeof v === 'string') onChange(v)
				}}
			>
				<KindTrigger
					data-testid={testId}
					aria-label={label}
					disabled={disabled}
				>
					<PriSelect.Value />
					<ChevronsUpDown size={13} aria-hidden />
				</KindTrigger>
				<PriSelect.Portal>
					<PriSelect.Positioner sideOffset={6}>
						<PriSelect.Popup>
							{CHANNEL_KINDS.map(kind => (
								<PriSelect.Item
									key={kind}
									value={kind}
									data-testid={`${testId}-option-${kind}`}
								>
									<PriSelect.ItemIndicator>
										<Check size={12} aria-hidden />
									</PriSelect.ItemIndicator>
									<PriSelect.ItemText>{kindLabel(kind)}</PriSelect.ItemText>
								</PriSelect.Item>
							))}
						</PriSelect.Popup>
					</PriSelect.Positioner>
				</PriSelect.Portal>
			</PriSelect.Root>
		</PriField.Root>
	)
}

const Header = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	margin-bottom: var(--space-md);
`

const Title = styled.h2`
	${stenciledTitle}
	font-size: var(--typescale-title-medium-size);
`

const CloseButton = styled.button`
	display: inline-flex;
	padding: var(--space-2xs);
	color: var(--color-on-surface-variant);
	background: transparent;
	border: none;
	cursor: pointer;
`

const Empty = styled.p`
	color: var(--color-on-surface-variant);
	font-size: var(--typescale-body-small-size);
	margin: 0 0 var(--space-md);
`

const Note = styled.p`
	color: var(--color-on-surface-variant);
	font-size: var(--typescale-body-small-size);
	margin: 0 0 var(--space-sm);
`

const MenuNote = styled.p`
	max-width: 16rem;
	padding: var(--space-2xs) var(--space-xs);
	margin: 0;
	color: var(--color-on-surface-variant);
	font-size: var(--typescale-label-small-size);
	border-top: 1px solid var(--color-outline-variant);
`

const ChannelList = styled.ul`
	list-style: none;
	margin: 0 0 var(--space-md);
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const ChannelRow = styled.li`
	${agedPaperRow}
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-xs);
	padding: var(--space-2xs) var(--space-xs);
`

const Kind = styled.span`
	font-size: var(--typescale-label-small-size);
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
	min-width: 4.5rem;
`

const Value = styled.span`
	flex: 1 1 8rem;
	/* Without this the box can be squeezed narrower than a word, and a phone
	   number comes out one number per line. */
	min-width: 0;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-2xs);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface);
	overflow-wrap: anywhere;
`

// On a phone the buttons take a line of their own, so the address keeps a whole
// one rather than being wrapped down to a column of fragments.
const RowActions = styled.div`
	flex: 1 0 100%;
	display: flex;
	justify-content: flex-end;
	align-items: center;

	@media (min-width: 480px) {
		flex: 0 0 auto;
	}
`

const ChannelLabel = styled.span`
	display: inline-block;
	padding: 0 var(--space-2xs);
	border-radius: var(--shape-2xs);
	background: var(--color-surface-container-high);
	color: var(--color-on-surface-variant);
	font-size: var(--typescale-label-small-size);
`

const IconButton = styled.button<{ $active?: boolean }>`
	display: inline-flex;
	padding: var(--space-2xs);
	color: ${p =>
		p.$active ? 'var(--color-primary)' : 'var(--color-on-surface-variant)'};
	background: transparent;
	border: none;
	cursor: pointer;

	&:disabled {
		cursor: default;
		opacity: ${p => (p.$active ? 1 : 0.4)};
	}
`

const EditForm = styled.form`
	display: flex;
	flex-direction: column;
	gap: var(--space-xs);
	width: 100%;

	@media (min-width: 640px) {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr);
		align-items: end;
	}
`

// Their own row, so the three fields split the width between them rather than
// what a Save and a Cancel leave over — which is not enough to read an address in.
const EditActions = styled.div`
	display: flex;
	gap: var(--space-2xs);
	align-items: center;

	@media (min-width: 640px) {
		grid-column: 1 / -1;
		justify-content: flex-end;
	}
`

const RowError = styled.p`
	width: 100%;
	margin: 0;
	color: var(--color-primary);
	font-size: var(--typescale-body-small-size);
	border-inline-start: 3px solid var(--color-primary);
	padding-inline-start: var(--space-xs);

	@media (min-width: 768px) {
		grid-column: 1 / -1;
	}
`

const AddForm = styled.form`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-xs);
	align-items: end;
`

const KindTrigger = styled(PriSelect.Trigger).withConfig({
	displayName: 'ChannelKindTrigger',
})`
	gap: var(--space-3xs);
	padding: var(--space-2xs) var(--space-xs);
	font-size: var(--typescale-body-small-size);
	text-transform: none;
	letter-spacing: 0;
`
