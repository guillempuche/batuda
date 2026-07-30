import { useAtomSet } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { Schema } from 'effect'
import {
	MoreHorizontal,
	Pencil,
	Plus,
	Trash2,
	UserRoundPlus,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

import { PriButton, PriMenu, usePriToast } from '@batuda/ui/pri'

import {
	deleteTemplateAtom,
	transferTemplateAtom,
} from '#/atoms/instruction-atoms'
import { ErrorState } from '#/components/shared/error-state'
import { authClient } from '#/lib/auth-client'
import { dlgNoId, dlgWithId } from '#/lib/dlg-search'
import { useDlg } from '#/lib/use-dlg'
import { useReadParam } from '#/lib/use-read-param'
import { InstructionIconButton, OwnerBadge } from './instruction-chrome'
import {
	Empty,
	RowActions,
	Section,
	SectionHead,
	SectionTitle,
	TemplateList,
	TemplateNameButton,
	TemplateRowItem,
} from './instruction-page-chrome'
import { outcomeOf, type TemplateShape } from './instruction-shapes'
import { TemplateDeleteConfirm } from './template-delete-confirm'
import { TemplateDialog } from './template-dialog'
import { TemplateTransferDialog } from './template-transfer-dialog'

// The writing surfaces live in `?dlg=` so they are deep-linkable and Back closes
// them. Each page declares a wider union of its own; decoding against this
// narrow one means a stack dialog in the address simply doesn't open a template.
export const templateDlgSchema = Schema.Union([
	dlgNoId('create'),
	dlgWithId('edit'),
])

/**
 * The templates half of an instruction settings page: the list, and every way
 * of acting on a template.
 *
 * Both pages show the same thing and differ only in which templates they hand
 * over and what a new one belongs to, so the list, the dialogs and the URL
 * wiring live here rather than being written twice and drifting apart.
 *
 * Reading is addressed by `?read=` rather than `?dlg=` because it can be opened
 * on top of a half-written stack without throwing that draft away.
 */
export function TemplateLibrary({
	templates,
	loaded,
	failed,
	scope,
	myUserId,
	onChanged,
	onRetry,
	title,
	newLabel,
	emptyText,
	testIds,
}: {
	readonly templates: ReadonlyArray<TemplateShape>
	readonly loaded: boolean
	readonly failed: boolean
	// What a template created here belongs to.
	readonly scope: 'personal' | 'org'
	readonly myUserId: string | null
	// Re-read the lists after a write; a template can sit inside a stack.
	readonly onChanged: () => void
	readonly onRetry: () => void
	readonly title: ReactNode
	readonly newLabel: ReactNode
	readonly emptyText: ReactNode
	readonly testIds: {
		readonly row: string
		readonly view: string
		readonly newButton: string
		readonly error: string
		readonly dialog: string
	}
}) {
	const { t } = useLingui()
	const toast = usePriToast()
	const activeOrg = authClient.useActiveOrganization()
	const deleteTemplate = useAtomSet(deleteTemplateAtom, { mode: 'promiseExit' })
	const transferTemplate = useAtomSet(transferTemplateAtom, {
		mode: 'promiseExit',
	})

	const { dlg, open: openDlg, close: closeDlg } = useDlg(templateDlgSchema)
	const { readId, openRead, closeRead } = useReadParam()

	// Deleting or handing over a template takes its row away, buttons and all,
	// and closes the dialog if it was open, so nothing is left holding focus.
	// Send focus to the New button, the one control that is always on the page.
	const newButtonRef = useRef<HTMLButtonElement>(null)

	const [confirmDelete, setConfirmDelete] = useState<TemplateShape | null>(null)
	const [deleting, setDeleting] = useState(false)
	const [confirmTransfer, setConfirmTransfer] = useState<TemplateShape | null>(
		null,
	)
	const [transferring, setTransferring] = useState(false)

	// Reading wins when both keys name a template: it is the one opened over
	// whatever else is on screen. Closing clears only the key that opened the
	// dialog, so a stack draft in `?dlg=` survives being read over.
	const editTarget =
		dlg?.kind === 'edit'
			? (templates.find(row => row.id === dlg.id) ?? null)
			: null
	const readTarget =
		readId !== undefined
			? (templates.find(row => row.id === readId) ?? null)
			: null
	const isCreate = dlg?.kind === 'create'
	const target = readTarget ?? editTarget
	const dialogOpen = isCreate || target !== null
	const closeDialog = () => {
		if (readId !== undefined) closeRead()
		else if (dlg !== undefined) closeDlg()
	}

	// A link to a row that is gone drops itself once the list has loaded, so the
	// address never sits there opening nothing with no way to clear it.
	useEffect(() => {
		if (!loaded) return
		if (readId !== undefined && readTarget === null) closeRead()
		if (dlg?.kind === 'edit' && editTarget === null) closeDlg()
	}, [loaded, readId, readTarget, dlg, editTarget, closeRead, closeDlg])

	// Only a template you own can change hands, and only to somebody else.
	const candidates = useMemo(
		() =>
			(activeOrg.data?.members ?? [])
				.filter(m => m.userId !== myUserId)
				.map(m => ({
					userId: m.userId,
					label: m.user.name ?? m.user.email,
				})),
		[activeOrg.data, myUserId],
	)

	const runDelete = async () => {
		const row = confirmDelete
		if (!row || deleting) return
		setDeleting(true)
		const exit = await deleteTemplate({ params: { id: row.id } } as never)
		setDeleting(false)
		setConfirmDelete(null)
		const outcome = outcomeOf(exit)
		// A template still inside a stack is blocked server-side; say why rather
		// than letting the row quietly reappear.
		if (outcome === 'in_use') {
			toast.add({
				title: t`Still in use`,
				description: t`Remove "${row.name}" from the stacks that use it first, then delete it.`,
				type: 'error',
			})
			onChanged()
			return
		}
		if (outcome !== 'deleted') {
			toast.add({
				title: t`Delete failed`,
				description: t`Couldn't delete the template. Please try again.`,
				type: 'error',
			})
			onChanged()
			return
		}
		toast.add({ title: t`Template deleted`, type: 'success' })
		if (target?.id === row.id) closeDialog()
		newButtonRef.current?.focus()
		onChanged()
	}

	const runTransfer = async (targetUserId: string) => {
		const row = confirmTransfer
		if (!row || transferring) return
		setTransferring(true)
		const exit = await transferTemplate({
			params: { id: row.id },
			payload: { target_user_id: targetUserId },
		} as never)
		setTransferring(false)
		setConfirmTransfer(null)
		const outcome = outcomeOf(exit)
		if (outcome === 'transferred') {
			toast.add({
				title: t`Template handed over`,
				description: t`"${row.name}" is theirs now, so it has left your library.`,
				type: 'success',
			})
			if (target?.id === row.id) closeDialog()
			newButtonRef.current?.focus()
			onChanged()
			return
		}
		if (outcome === 'in_use') {
			toast.add({
				title: t`Still in use`,
				description: t`Take "${row.name}" out of your stacks first — they would lose it once somebody else owns it.`,
				type: 'error',
			})
			return
		}
		if (outcome === 'invalid_target') {
			toast.add({
				title: t`Not in your organization`,
				description: t`Pick somebody who is still a member.`,
				type: 'error',
			})
			return
		}
		toast.add({
			title: t`Couldn't hand it over`,
			description: t`Please try again.`,
			type: 'error',
		})
	}

	return (
		<Section>
			<SectionHead>
				<SectionTitle>{title}</SectionTitle>
				<PriButton
					ref={newButtonRef}
					type='button'
					$variant='filled'
					data-testid={testIds.newButton}
					onClick={() => openDlg({ kind: 'create' })}
				>
					<Plus size={16} aria-hidden />
					{newLabel}
				</PriButton>
			</SectionHead>

			{failed ? (
				<ErrorState
					variant='inline'
					data-testid={testIds.error}
					title={t`Couldn't load your templates.`}
					onRetry={onRetry}
				/>
			) : templates.length === 0 ? (
				<Empty>{emptyText}</Empty>
			) : (
				<TemplateList>
					{templates.map(row => {
						const mine =
							row.ownerUserId !== null && row.ownerUserId === myUserId
						return (
							<TemplateRowItem key={row.id} data-testid={testIds.row}>
								<TemplateNameButton
									type='button'
									aria-label={t`Read ${row.name}`}
									data-testid={`${testIds.view}-${row.id}`}
									onClick={() => openRead(row.id)}
								>
									{row.name}
								</TemplateNameButton>
								<OwnerBadge>
									{row.ownerUserId === null ? (
										<Trans>Org</Trans>
									) : (
										<Trans>Mine</Trans>
									)}
								</OwnerBadge>
								<RowActions>
									{/* Editing is far and away the common one, so it keeps a
									    button of its own; the rest would crowd the name out on a
									    phone, where every icon is a 2.5rem target. */}
									<InstructionIconButton
										type='button'
										aria-label={t`Edit ${row.name}`}
										data-testid={`template-edit-${row.id}`}
										onClick={() => openDlg({ kind: 'edit', id: row.id })}
									>
										<Pencil size={14} aria-hidden />
									</InstructionIconButton>
									{mine ? (
										<PriMenu.Root>
											<PriMenu.Trigger
												render={props => (
													<InstructionIconButton
														type='button'
														aria-label={t`More actions for ${row.name}`}
														data-testid={`template-more-${row.id}`}
														{...props}
													>
														<MoreHorizontal size={14} aria-hidden />
													</InstructionIconButton>
												)}
											/>
											<PriMenu.Portal>
												<PriMenu.Positioner sideOffset={6}>
													<PriMenu.Popup>
														<PriMenu.Item
															data-testid={`template-transfer-${row.id}`}
															onClick={() => setConfirmTransfer(row)}
														>
															<UserRoundPlus size={14} aria-hidden />
															<span>{t`Hand to a colleague`}</span>
														</PriMenu.Item>
														<PriMenu.Item
															data-testid={`template-delete-${row.id}`}
															onClick={() => setConfirmDelete(row)}
														>
															<Trash2 size={14} aria-hidden />
															<span>{t`Delete`}</span>
														</PriMenu.Item>
													</PriMenu.Popup>
												</PriMenu.Positioner>
											</PriMenu.Portal>
										</PriMenu.Root>
									) : (
										<InstructionIconButton
											type='button'
											aria-label={t`Delete ${row.name}`}
											data-testid={`template-delete-${row.id}`}
											onClick={() => setConfirmDelete(row)}
										>
											<Trash2 size={14} aria-hidden />
										</InstructionIconButton>
									)}
								</RowActions>
							</TemplateRowItem>
						)
					})}
				</TemplateList>
			)}

			<TemplateDialog
				open={dialogOpen}
				startInEdit={readTarget === null && editTarget !== null}
				target={target}
				scope={scope}
				canTransfer={
					target !== null &&
					target.ownerUserId !== null &&
					target.ownerUserId === myUserId
				}
				onOpenChange={next => {
					if (!next) closeDialog()
				}}
				onSaved={onChanged}
				onDelete={setConfirmDelete}
				onTransfer={setConfirmTransfer}
				testId={testIds.dialog}
			/>

			<TemplateDeleteConfirm
				open={confirmDelete !== null}
				deleting={deleting}
				onConfirm={() => {
					void runDelete()
				}}
				onClose={() => setConfirmDelete(null)}
				testId='template-delete-confirm'
				title={<Trans>Delete this template?</Trans>}
				description={
					confirmDelete?.ownerUserId === null ? (
						<Trans>
							"{confirmDelete?.name ?? ''}" will be removed for everyone in the
							organization. This can't be undone.
						</Trans>
					) : (
						<Trans>
							"{confirmDelete?.name ?? ''}" will be removed for good. This can't
							be undone.
						</Trans>
					)
				}
			/>

			<TemplateTransferDialog
				open={confirmTransfer !== null}
				templateName={confirmTransfer?.name ?? ''}
				candidates={candidates}
				transferring={transferring}
				onConfirm={targetUserId => {
					void runTransfer(targetUserId)
				}}
				onClose={() => setConfirmTransfer(null)}
				testId='template-transfer-confirm'
			/>
		</Section>
	)
}
