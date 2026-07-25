import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute } from '@tanstack/react-router'
import { Schema } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import { ArrowLeft, Pencil, Plus, ScrollText, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'

import type { Agent } from '@batuda/instructions/domain'
import { PriButton, usePriToast } from '@batuda/ui/pri'

import {
	deleteStackAtom,
	deleteTemplateAtom,
	instructionStacksAtom,
	instructionTemplatesAtom,
	setDefaultStackAtom,
} from '#/atoms/instruction-atoms'
import { AgentSelector } from '#/components/instructions/agent-selector'
import {
	InstructionIconButton,
	OwnerBadge,
} from '#/components/instructions/instruction-chrome'
import {
	BackLink,
	Empty,
	Heading,
	Intro,
	Page,
	RowActions,
	Section,
	SectionHead,
	SectionTitle,
	Subtitle,
	TemplateList,
	TemplateNameButton,
	TemplateRowItem,
} from '#/components/instructions/instruction-page-chrome'
import {
	narrowStacks,
	narrowTemplates,
	outcomeOf,
	type StackShape,
	type TemplateShape,
} from '#/components/instructions/instruction-shapes'
import { StackEditor } from '#/components/instructions/stack-editor'
import { StackList } from '#/components/instructions/stack-list'
import type { StackOption } from '#/components/instructions/stack-picker'
import { TemplateDeleteConfirm } from '#/components/instructions/template-delete-confirm'
import {
	type TemplateDraft,
	TemplateEditorDialog,
} from '#/components/instructions/template-editor-dialog'
import { TemplateViewDialog } from '#/components/instructions/template-view-dialog'
import { ErrorState } from '#/components/shared/error-state'
import { authClient } from '#/lib/auth-client'
import { dlgNoId, dlgWithId } from '#/lib/dlg-search'
import { validateSearchWith } from '#/lib/search-schema'
import { useDlg } from '#/lib/use-dlg'
import { useReadParam } from '#/lib/use-read-param'

// As on the personal templates page, the dialogs live in `?dlg=` so they are
// deep-linkable and Back closes them. Every one of them belongs to the admin
// half of the page; a regular member only reads, which carries its own `?read=`
// key.
const orgTemplatesDlgSchema = Schema.Union([
	dlgNoId('create'),
	dlgWithId('edit'),
	dlgNoId('new-stack'),
	dlgWithId('stack'),
])

export const Route = createFileRoute('/settings/organization/templates')({
	validateSearch: validateSearchWith({
		dlg: orgTemplatesDlgSchema,
		read: Schema.NonEmptyString,
	}),
	head: () => ({ meta: [{ title: 'Org instruction templates — Batuda' }] }),
	component: OrgTemplatesPage,
})

function OrgTemplatesPage() {
	const { t } = useLingui()
	const activeMember = authClient.useActiveMember()
	const role = activeMember.data?.role ?? null
	const isAdmin = role === 'owner' || role === 'admin'

	const templatesResult = useAtomValue(instructionTemplatesAtom)
	const refreshTemplates = useAtomRefresh(instructionTemplatesAtom)

	// Org-owned templates are the ones with no personal owner.
	const orgTemplates = useMemo<ReadonlyArray<TemplateShape>>(
		() =>
			AsyncResult.isSuccess(templatesResult)
				? narrowTemplates(templatesResult.value).filter(
						x => x.ownerUserId === null,
					)
				: [],
		[templatesResult],
	)

	// Reading is handled here rather than in the admin half so both kinds of
	// member get the same dialog — an admin opens it from the row they manage, a
	// regular member from the list they can only read.
	const { dlg, open: openDlg, close: closeDlg } = useDlg(orgTemplatesDlgSchema)
	const { readId, openRead, closeRead } = useReadParam()
	const viewingRow =
		readId !== undefined
			? (orgTemplates.find(row => row.id === readId) ?? null)
			: null

	// Settle the link once the list has loaded. A template that is gone drops its
	// link rather than leaving an empty dialog open. An edit link handed to
	// someone who may only read falls back to reading, so a shared address shows
	// them the template instead of nothing at all.
	const templatesLoaded = AsyncResult.isSuccess(templatesResult)
	const editTarget =
		dlg?.kind === 'edit'
			? (orgTemplates.find(row => row.id === dlg.id) ?? null)
			: null
	// A regular member never renders the admin half, so one of its links would
	// otherwise sit in the address bar opening nothing, with no way to clear it.
	const adminOnlyDialog =
		dlg?.kind === 'create' || dlg?.kind === 'new-stack' || dlg?.kind === 'stack'
	useEffect(() => {
		if (!isAdmin && adminOnlyDialog) {
			closeDlg()
			return
		}
		if (!templatesLoaded) return
		if (readId !== undefined && viewingRow === null) closeRead()
		if (dlg?.kind !== 'edit') return
		if (editTarget === null) closeDlg()
		else if (!isAdmin) {
			closeDlg()
			openRead(editTarget.id)
		}
	}, [
		dlg,
		templatesLoaded,
		readId,
		viewingRow,
		editTarget,
		isAdmin,
		adminOnlyDialog,
		openRead,
		closeRead,
		closeDlg,
	])

	return (
		<Page>
			<BackLink to='/settings/organization'>
				<ArrowLeft size={14} aria-hidden />
				<span>
					<Trans>Back to organization</Trans>
				</span>
			</BackLink>

			<Intro>
				<Heading>
					<ScrollText size={20} aria-hidden />
					<Trans>Org instruction templates</Trans>
				</Heading>
				<Subtitle>
					<Trans>
						Shared guidance every member's agents can use, plus the
						organization's stacks.
					</Trans>
				</Subtitle>
			</Intro>

			{isAdmin ? (
				<OrgTemplateAdmin
					orgTemplates={orgTemplates}
					refreshTemplates={refreshTemplates}
					onRead={openRead}
				/>
			) : (
				<>
					<Section>
						<Hint role='note'>
							<Trans>
								Your organization's admins manage these templates. You can read
								any of them, and use them in your own stacks or per run.
							</Trans>
						</Hint>
						{orgTemplates.length > 0 ? (
							<TemplateList>
								{orgTemplates.map(row => (
									<TemplateRowItem key={row.id} data-testid='org-template-row'>
										<TemplateNameButton
											type='button'
											aria-label={t`Read ${row.name}`}
											data-testid={`org-template-view-${row.id}`}
											onClick={() => openRead(row.id)}
										>
											{row.name}
										</TemplateNameButton>
										<OwnerBadge>
											<Trans>Org</Trans>
										</OwnerBadge>
									</TemplateRowItem>
								))}
							</TemplateList>
						) : (
							<Empty>
								<Trans>No org templates yet.</Trans>
							</Empty>
						)}
					</Section>
					<OrgStacksViewer />
				</>
			)}

			<TemplateViewDialog
				open={viewingRow !== null}
				name={viewingRow?.name ?? ''}
				body={viewingRow?.body ?? ''}
				updatedAt={viewingRow?.updatedAt ?? null}
				canEdit={isAdmin}
				orgOwned
				// Stepping from reading to editing swaps one dialog for the other, so
				// Back leaves the template rather than dropping you back into reading
				// what you just finished editing.
				onEdit={() => {
					if (viewingRow === null) return
					closeRead()
					openDlg({ kind: 'edit', id: viewingRow.id })
				}}
				onClose={closeRead}
				testId='org-template-view-dialog'
			/>
		</Page>
	)
}

// Read-only org stacks for a regular member: names and badges so they know what
// the organization has set up, without any controls (every org write is
// admin-gated on the server).
function OrgStacksViewer() {
	const [agent, setAgent] = useState<Agent>('research')
	const stacksAtom = useMemo(() => instructionStacksAtom(agent), [agent])
	const stacksResult = useAtomValue(stacksAtom)
	const refreshStacks = useAtomRefresh(stacksAtom)
	const { t } = useLingui()

	const stacksFailed = AsyncResult.isFailure(stacksResult)
	const orgStacks = useMemo<ReadonlyArray<StackShape>>(
		() =>
			AsyncResult.isSuccess(stacksResult)
				? narrowStacks(stacksResult.value).filter(
						s => s.scope === 'org' && s.agent === agent,
					)
				: [],
		[stacksResult, agent],
	)

	return (
		<Section>
			<SectionHead>
				<SectionTitle id='org-stacks-surface-view'>
					<Trans>Org stacks</Trans>
				</SectionTitle>
				<AgentSelector
					agent={agent}
					onChange={setAgent}
					labelledBy='org-stacks-surface-view'
				/>
			</SectionHead>
			{stacksFailed ? (
				<ErrorState
					variant='inline'
					data-testid='org-stacks-error'
					title={t`Couldn't load the org stacks.`}
					onRetry={refreshStacks}
				/>
			) : orgStacks.length > 0 ? (
				<StackList
					stacks={orgStacks}
					readOnly
					onEdit={() => {}}
					onSetDefault={() => {}}
					onDelete={() => {}}
				/>
			) : (
				<Empty>
					<Trans>No org stacks yet.</Trans>
				</Empty>
			)}
		</Section>
	)
}

// The admin half of the org templates page: managing org templates and the org
// stacks. It's mounted only for owners/admins, so its stack queries never fire
// for a regular member — who can't act on that data anyway, since every org
// write is admin-gated on the server.
function OrgTemplateAdmin({
	orgTemplates,
	refreshTemplates,
	onRead,
}: {
	readonly orgTemplates: ReadonlyArray<TemplateShape>
	readonly refreshTemplates: () => void
	// Reading is owned by the page above so both member and admin share one dialog.
	readonly onRead: (id: string) => void
}) {
	const { t } = useLingui()
	const toast = usePriToast()

	// Instructions are per surface; this picks which surface's org stacks the
	// section below edits. Org templates themselves are surface-neutral.
	const [agent, setAgent] = useState<Agent>('research')

	const stacksAtom = useMemo(() => instructionStacksAtom(agent), [agent])
	const stacksResult = useAtomValue(stacksAtom)
	const refreshStacks = useAtomRefresh(stacksAtom)

	const deleteTemplate = useAtomSet(deleteTemplateAtom, { mode: 'promiseExit' })
	const deleteStack = useAtomSet(deleteStackAtom, { mode: 'promiseExit' })
	const setDefaultStack = useAtomSet(setDefaultStackAtom, {
		mode: 'promiseExit',
	})

	const stacksFailed = AsyncResult.isFailure(stacksResult)
	const orgStacks = useMemo<ReadonlyArray<StackShape>>(
		() =>
			AsyncResult.isSuccess(stacksResult)
				? narrowStacks(stacksResult.value).filter(
						s => s.scope === 'org' && s.agent === agent,
					)
				: [],
		[stacksResult, agent],
	)
	const hasOrgDefault = orgStacks.some(s => s.isDefault)

	const stackOptions = useMemo<ReadonlyArray<StackOption>>(
		() =>
			orgTemplates.map(x => ({ id: x.id, name: x.name, ownerUserId: null })),
		[orgTemplates],
	)

	// The confirmations stay local: they are a passing step in something the user
	// is already doing, not a place worth linking someone to.
	const [confirmTarget, setConfirmTarget] = useState<{
		readonly id: string
		readonly name: string
	} | null>(null)
	const [deleting, setDeleting] = useState(false)
	const [confirmStack, setConfirmStack] = useState<StackShape | null>(null)
	const [deletingStack, setDeletingStack] = useState(false)

	const { dlg, open: openDlg, close: closeDlg } = useDlg(orgTemplatesDlgSchema)

	// Both editors resolve their target from the loaded list, so a link to an
	// open row reopens the right one after a refresh.
	const editingRow =
		dlg?.kind === 'edit'
			? (orgTemplates.find(row => row.id === dlg.id) ?? null)
			: null
	// Held steady while the editor is open. The editor resets its unsaved-changes
	// guard and any error message whenever this value changes, so rebuilding it
	// on every render would quietly drop a draft and hide failed saves.
	const editingId = editingRow?.id ?? null
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the template being edited, not the row object the list rebuilds on every refresh
	const editing: TemplateDraft | null = useMemo(
		() =>
			editingRow
				? { id: editingRow.id, name: editingRow.name, body: editingRow.body }
				: null,
		[editingId],
	)
	const dialogOpen =
		dlg?.kind === 'create' || (dlg?.kind === 'edit' && editingRow !== null)

	const editingStack =
		dlg?.kind === 'stack'
			? (orgStacks.find(s => s.id === dlg.id) ?? null)
			: null
	const stackEditorOpen =
		dlg?.kind === 'new-stack' ||
		(dlg?.kind === 'stack' && editingStack !== null)

	// A link to a stack that is gone — deleted, or belonging to another surface —
	// drops itself once the list has loaded. Templates are handled by the page
	// above, which is the half that knows whether they arrived.
	const stacksLoaded = AsyncResult.isSuccess(stacksResult)
	useEffect(() => {
		if (dlg?.kind === 'stack' && stacksLoaded && editingStack === null) {
			closeDlg()
		}
	}, [dlg, stacksLoaded, editingStack, closeDlg])

	// Switching surface drops any open stack editor for the previous surface.
	const selectAgent = (next: Agent) => {
		setAgent(next)
		if (dlg?.kind === 'new-stack' || dlg?.kind === 'stack') closeDlg()
	}

	const openCreate = () => openDlg({ kind: 'create' })
	const openEdit = (row: TemplateShape) => openDlg({ kind: 'edit', id: row.id })

	const confirmDelete = async () => {
		const target = confirmTarget
		if (!target || deleting) return
		setDeleting(true)
		const exit = await deleteTemplate({ params: { id: target.id } } as never)
		setDeleting(false)
		setConfirmTarget(null)
		const outcome = outcomeOf(exit)
		if (outcome === 'in_use') {
			toast.add({
				title: t`Still in use`,
				description: t`Remove "${target.name}" from the stacks that use it first, then delete it.`,
				type: 'error',
			})
			refreshStacks()
			return
		}
		if (outcome !== 'deleted') {
			toast.add({
				title: t`Delete failed`,
				description: t`Couldn't delete the template. Please try again.`,
				type: 'error',
			})
			refreshTemplates()
			return
		}
		toast.add({ title: t`Template deleted`, type: 'success' })
		refreshTemplates()
		refreshStacks()
	}

	const setDefault = async (s: StackShape) => {
		const exit = await setDefaultStack({ params: { id: s.id } } as never)
		if (outcomeOf(exit) === 'set') {
			refreshStacks()
			return
		}
		toast.add({
			title: t`Couldn't set the default`,
			description: t`Please try again.`,
			type: 'error',
		})
	}

	const confirmDeleteStack = async () => {
		const target = confirmStack
		if (!target || deletingStack) return
		setDeletingStack(true)
		const exit = await deleteStack({ params: { id: target.id } } as never)
		setDeletingStack(false)
		setConfirmStack(null)
		if (outcomeOf(exit) === 'deleted') {
			toast.add({ title: t`Stack deleted`, type: 'success' })
			refreshStacks()
			return
		}
		toast.add({
			title: t`Delete failed`,
			description: t`Couldn't delete the stack. Please try again.`,
			type: 'error',
		})
	}

	const stackSaved = () => {
		closeDlg()
		refreshStacks()
	}

	return (
		<>
			<Section>
				<SectionHead>
					<SectionTitle>
						<Trans>Org templates</Trans>
					</SectionTitle>
					<PriButton
						type='button'
						$variant='filled'
						data-testid='org-templates-new'
						onClick={openCreate}
					>
						<Plus size={16} aria-hidden />
						<Trans>New org template</Trans>
					</PriButton>
				</SectionHead>

				{orgTemplates.length === 0 ? (
					<Empty>
						<Trans>No org templates yet. Create one to get started.</Trans>
					</Empty>
				) : (
					<TemplateList>
						{orgTemplates.map(row => (
							<TemplateRowItem key={row.id} data-testid='org-template-row'>
								<TemplateNameButton
									type='button'
									aria-label={t`Read ${row.name}`}
									data-testid={`org-template-view-${row.id}`}
									onClick={() => onRead(row.id)}
								>
									{row.name}
								</TemplateNameButton>
								<OwnerBadge>
									<Trans>Org</Trans>
								</OwnerBadge>
								<RowActions>
									<InstructionIconButton
										type='button'
										aria-label={t`Edit ${row.name}`}
										onClick={() => openEdit(row)}
									>
										<Pencil size={14} aria-hidden />
									</InstructionIconButton>
									<InstructionIconButton
										type='button'
										aria-label={t`Delete ${row.name}`}
										onClick={() =>
											setConfirmTarget({ id: row.id, name: row.name })
										}
									>
										<Trash2 size={14} aria-hidden />
									</InstructionIconButton>
								</RowActions>
							</TemplateRowItem>
						))}
					</TemplateList>
				)}
			</Section>

			<Section data-testid='org-stacks'>
				<SectionHead>
					<SectionTitle id='org-stacks-surface'>
						<Trans>Org stacks</Trans>
					</SectionTitle>
					<AgentSelector
						agent={agent}
						onChange={selectAgent}
						labelledBy='org-stacks-surface'
					/>
				</SectionHead>
				<Hint>
					<Trans>
						An org stack runs for every member who hasn't set their own. The one
						marked default applies to a run that names none. Only org templates
						can go in an org stack.
					</Trans>
				</Hint>
				{stacksFailed ? (
					<ErrorState
						variant='inline'
						data-testid='org-stacks-error'
						title={t`Couldn't load the org stacks.`}
						onRetry={refreshStacks}
					/>
				) : orgTemplates.length === 0 ? (
					<Empty>
						<Trans>Add an org template first.</Trans>
					</Empty>
				) : (
					<>
						{orgStacks.length > 0 ? (
							<StackList
								stacks={orgStacks}
								onEdit={s => openDlg({ kind: 'stack', id: s.id })}
								onSetDefault={s => {
									void setDefault(s)
								}}
								onDelete={setConfirmStack}
							/>
						) : (
							<Empty>
								<Trans>No org stacks yet. Create one to get started.</Trans>
							</Empty>
						)}

						{stackEditorOpen ? (
							<StackEditor
								agent={agent}
								scope='org'
								stack={editingStack}
								options={stackOptions}
								orgDefaultTemplateIds={[]}
								hasExistingDefault={hasOrgDefault}
								onDone={stackSaved}
								onRead={onRead}
							/>
						) : (
							<Actions>
								<PriButton
									type='button'
									$variant='filled'
									data-testid='org-stack-new'
									onClick={() => openDlg({ kind: 'new-stack' })}
								>
									<Plus size={16} aria-hidden />
									<Trans>New org template stack</Trans>
								</PriButton>
							</Actions>
						)}
					</>
				)}
			</Section>

			<TemplateEditorDialog
				open={dialogOpen}
				onOpenChange={next => {
					if (!next) closeDlg()
				}}
				editing={editing}
				scope='org'
				onSaved={() => {
					refreshTemplates()
				}}
			/>

			<TemplateDeleteConfirm
				open={confirmTarget !== null}
				deleting={deleting}
				onConfirm={() => {
					void confirmDelete()
				}}
				onClose={() => setConfirmTarget(null)}
				testId='org-template-delete-confirm'
				title={<Trans>Delete this org template?</Trans>}
				description={
					<Trans>
						"{confirmTarget?.name ?? ''}" will be removed for everyone in the
						organization. This can't be undone.
					</Trans>
				}
			/>

			<TemplateDeleteConfirm
				open={confirmStack !== null}
				deleting={deletingStack}
				onConfirm={() => {
					void confirmDeleteStack()
				}}
				onClose={() => setConfirmStack(null)}
				testId='org-stack-delete-confirm'
				title={<Trans>Delete this org stack?</Trans>}
				description={
					<Trans>
						"{confirmStack?.name ?? ''}" will be removed for the organization.
						The templates stay; only this grouping goes.
					</Trans>
				}
			/>
		</>
	)
}

const Hint = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Actions = styled.div`
	display: flex;
	gap: var(--space-sm);
`
