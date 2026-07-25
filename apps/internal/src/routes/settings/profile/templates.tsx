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
	clearDefaultStackAtom,
	deleteStackAtom,
	deleteTemplateAtom,
	instructionResolutionAtom,
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
	narrowResolution,
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
import { brushedMetalPlate, stenciledTitle } from '#/lib/workshop-mixins'

// The view/create/edit surfaces live in the `?dlg=` param so they are
// deep-linkable and the browser Back button closes them — `create`/`new-stack`
// open on their own, `view`/`edit`/`stack` target a row by id.
const templatesDlgSchema = Schema.Union([
	dlgWithId('view'),
	dlgNoId('create'),
	dlgWithId('edit'),
	dlgNoId('new-stack'),
	dlgWithId('stack'),
])

export const Route = createFileRoute('/settings/profile/templates')({
	validateSearch: validateSearchWith({ dlg: templatesDlgSchema }),
	head: () => ({ meta: [{ title: 'Instruction templates — Batuda' }] }),
	component: TemplatesPage,
})

function TemplatesPage() {
	const { t } = useLingui()
	const toast = usePriToast()
	const session = authClient.useSession()
	const myUserId = session.data?.user?.id ?? null

	// Instructions are per surface; this picks which surface's stacks the section
	// below manages. Templates themselves are surface-neutral.
	const [agent, setAgent] = useState<Agent>('research')

	const templatesResult = useAtomValue(instructionTemplatesAtom)
	const refreshTemplates = useAtomRefresh(instructionTemplatesAtom)
	const stacksAtom = useMemo(() => instructionStacksAtom(agent), [agent])
	const stacksResult = useAtomValue(stacksAtom)
	const refreshStacks = useAtomRefresh(stacksAtom)
	const resolutionAtom = useMemo(
		() => instructionResolutionAtom(agent),
		[agent],
	)
	const resolutionResult = useAtomValue(resolutionAtom)
	const refreshResolution = useAtomRefresh(resolutionAtom)
	const deleteTemplate = useAtomSet(deleteTemplateAtom, { mode: 'promiseExit' })
	const deleteStack = useAtomSet(deleteStackAtom, { mode: 'promiseExit' })
	const setDefaultStack = useAtomSet(setDefaultStackAtom, {
		mode: 'promiseExit',
	})
	const clearDefaultStack = useAtomSet(clearDefaultStackAtom, {
		mode: 'promiseExit',
	})

	const templatesFailed = AsyncResult.isFailure(templatesResult)
	const stacksFailed = AsyncResult.isFailure(stacksResult)
	const templates = useMemo<ReadonlyArray<TemplateShape>>(
		() =>
			AsyncResult.isSuccess(templatesResult)
				? narrowTemplates(templatesResult.value)
				: [],
		[templatesResult],
	)
	const personalStacks = useMemo<ReadonlyArray<StackShape>>(
		() =>
			AsyncResult.isSuccess(stacksResult)
				? narrowStacks(stacksResult.value).filter(
						s => s.scope === 'personal' && s.agent === agent,
					)
				: [],
		[stacksResult, agent],
	)
	const resolution = useMemo(
		() =>
			AsyncResult.isSuccess(resolutionResult)
				? narrowResolution(resolutionResult.value)
				: null,
		[resolutionResult],
	)

	// A personal default only counts within this scope+agent's own stacks.
	const hasPersonalDefault = personalStacks.some(s => s.isDefault)
	const orgDefault = resolution?.defaults.org ?? null
	const orgDefaultTemplateIds = orgDefault?.templateIds ?? []

	const options = useMemo<ReadonlyArray<StackOption>>(
		() =>
			templates.map(template => ({
				id: template.id,
				name: template.name,
				ownerUserId: template.ownerUserId,
			})),
		[templates],
	)
	const templateNameById = useMemo(
		() => new Map(templates.map(tpl => [tpl.id, tpl.name])),
		[templates],
	)

	const { dlg, open: openDlg, close: closeDlg } = useDlg(templatesDlgSchema)
	const [confirmTarget, setConfirmTarget] = useState<{
		readonly id: string
		readonly name: string
	} | null>(null)
	const [deleting, setDeleting] = useState(false)
	const [confirmStack, setConfirmStack] = useState<StackShape | null>(null)
	const [deletingStack, setDeletingStack] = useState(false)

	// The edit dialog resolves its target from the loaded list, so a link to an
	// open template reopens the right one on refresh. The list also carries the
	// organization's templates, which this page can only read — an edit link
	// naming one is turned into a read below rather than opening an editor whose
	// Save could never work.
	const editingRow =
		dlg?.kind === 'edit'
			? (templates.find(
					row =>
						row.id === dlg.id &&
						row.ownerUserId !== null &&
						row.ownerUserId === myUserId,
				) ?? null)
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

	const viewingRow =
		dlg?.kind === 'view'
			? (templates.find(row => row.id === dlg.id) ?? null)
			: null

	// The stack editor mounts for a create (`new-stack`) or an edit (`stack`)
	// whose target is loaded. Resolving from the loaded list keeps a deep link
	// reopening the right stack after a refresh.
	const editingStack =
		dlg?.kind === 'stack'
			? (personalStacks.find(s => s.id === dlg.id) ?? null)
			: null
	const stackEditorOpen =
		dlg?.kind === 'new-stack' ||
		(dlg?.kind === 'stack' && editingStack !== null)

	// A link to a row that is gone drops itself once the list loads. An edit link
	// naming a template this page can't change becomes a read of it, so a shared
	// address still shows the template.
	const templatesLoaded = AsyncResult.isSuccess(templatesResult)
	const stacksLoaded = AsyncResult.isSuccess(stacksResult)
	const readableInstead =
		dlg?.kind === 'edit' && editingRow === null
			? (templates.find(row => row.id === dlg.id) ?? null)
			: null
	useEffect(() => {
		if (dlg?.kind === 'edit' && templatesLoaded && editingRow === null) {
			if (readableInstead !== null) {
				openDlg({ kind: 'view', id: readableInstead.id }, { replace: true })
			} else {
				closeDlg()
			}
		}
		if (dlg?.kind === 'view' && templatesLoaded && viewingRow === null) {
			closeDlg()
		}
		if (dlg?.kind === 'stack' && stacksLoaded && editingStack === null) {
			closeDlg()
		}
	}, [
		dlg,
		templatesLoaded,
		editingRow,
		readableInstead,
		viewingRow,
		stacksLoaded,
		editingStack,
		openDlg,
		closeDlg,
	])

	const openCreate = () => openDlg({ kind: 'create' })
	const openView = (row: TemplateShape) => openDlg({ kind: 'view', id: row.id })
	const openEdit = (row: TemplateShape) => openDlg({ kind: 'edit', id: row.id })
	const openNewStack = () => openDlg({ kind: 'new-stack' })
	const openEditStack = (s: StackShape) => openDlg({ kind: 'stack', id: s.id })

	const stackSaved = () => {
		refreshStacks()
		refreshResolution()
		closeDlg()
	}

	const setDefault = async (s: StackShape) => {
		const exit = await setDefaultStack({ params: { id: s.id } } as never)
		if (outcomeOf(exit) === 'set') {
			refreshStacks()
			refreshResolution()
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
			refreshResolution()
			return
		}
		toast.add({
			title: t`Delete failed`,
			description: t`Couldn't delete the stack. Please try again.`,
			type: 'error',
		})
	}

	const switchToOrgDefault = async () => {
		const exit = await clearDefaultStack({
			params: { agent },
			query: { scope: 'personal' },
		} as never)
		if (outcomeOf(exit) === 'cleared') {
			refreshStacks()
			refreshResolution()
			return
		}
		toast.add({
			title: t`Couldn't switch`,
			description: t`Please try again.`,
			type: 'error',
		})
	}

	const confirmDelete = async () => {
		const target = confirmTarget
		if (!target || deleting) return
		setDeleting(true)
		const exit = await deleteTemplate({ params: { id: target.id } } as never)
		setDeleting(false)
		setConfirmTarget(null)
		if (exit._tag !== 'Success') {
			toast.add({
				title: t`Delete failed`,
				description: t`Couldn't delete the template. Please try again.`,
				type: 'error',
			})
			return
		}
		const outcome = outcomeOf(exit)
		// A template still referenced by a stack is blocked server-side; surface
		// why instead of letting the row silently reappear.
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

	return (
		<Page>
			<BackLink to='/settings/profile'>
				<ArrowLeft size={14} aria-hidden />
				<span>
					<Trans>Back to account</Trans>
				</span>
			</BackLink>

			<Intro>
				<Heading>
					<ScrollText size={20} aria-hidden />
					<Trans>Instruction templates</Trans>
				</Heading>
				<Subtitle>
					<Trans>
						Reusable, standing guidance your agents follow — what you sell, who
						you target, tone, and which sources to trust.
					</Trans>
				</Subtitle>
			</Intro>

			<Section>
				<SectionHead>
					<SectionTitle>
						<Trans>Templates</Trans>
					</SectionTitle>
					<PriButton
						type='button'
						$variant='filled'
						data-testid='templates-new'
						onClick={openCreate}
					>
						<Plus size={16} aria-hidden />
						<Trans>New template</Trans>
					</PriButton>
				</SectionHead>

				{templatesFailed ? (
					<ErrorState
						variant='inline'
						data-testid='profile-templates-error'
						title={t`Couldn't load your templates.`}
						onRetry={refreshTemplates}
					/>
				) : templates.length === 0 ? (
					<Empty>
						<Trans>
							No templates yet. Create one to start shaping your runs.
						</Trans>
					</Empty>
				) : (
					<TemplateList>
						{templates.map(row => {
							// Row security only ever returns org-owned or the actor's own
							// templates, so ownership is a two-way split here.
							const mine =
								row.ownerUserId !== null && row.ownerUserId === myUserId
							return (
								<TemplateRowItem key={row.id} data-testid='template-row'>
									{/* Any template on this page can be read, the org's as well
									    as your own; only its owner can change it. */}
									<TemplateNameButton
										type='button'
										aria-label={t`Read ${row.name}`}
										data-testid={`template-view-${row.id}`}
										onClick={() => openView(row)}
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
										{mine ? (
											<>
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
											</>
										) : null}
									</RowActions>
								</TemplateRowItem>
							)
						})}
					</TemplateList>
				)}
			</Section>

			<Section>
				<SectionHead>
					<SectionTitle id='profile-stacks-surface'>
						<Trans>My stacks</Trans>
					</SectionTitle>
					<AgentSelector
						agent={agent}
						onChange={setAgent}
						labelledBy='profile-stacks-surface'
					/>
				</SectionHead>

				{stacksFailed ? (
					<ErrorState
						variant='inline'
						data-testid='profile-stacks-error'
						title={t`Couldn't load your stacks.`}
						onRetry={refreshStacks}
					/>
				) : templates.length === 0 ? (
					<Empty>
						<Trans>
							Create a template above first, then group templates into a stack.
						</Trans>
					</Empty>
				) : (
					<>
						{hasPersonalDefault ? (
							<InheritBanner data-testid='inherit-banner'>
								<BannerText>
									<Trans>You're following one of your own stacks.</Trans>
								</BannerText>
								<PriButton
									type='button'
									$variant='text'
									data-testid='use-org-default'
									onClick={() => {
										void switchToOrgDefault()
									}}
								>
									<Trans>Use the org default instead</Trans>
								</PriButton>
							</InheritBanner>
						) : (
							<InheritBanner data-testid='inherit-banner'>
								<BannerText>
									<Trans>Using the org default</Trans>
								</BannerText>
								{orgDefault !== null && orgDefaultTemplateIds.length > 0 ? (
									<OrgList>
										{orgDefaultTemplateIds.map(id => (
											<OrgItem key={id}>
												{templateNameById.get(id) ?? id}
											</OrgItem>
										))}
									</OrgList>
								) : (
									<BannerHint>
										<Trans>
											Your organization has no default yet. Make a stack your
											default to steer every run.
										</Trans>
									</BannerHint>
								)}
							</InheritBanner>
						)}

						{personalStacks.length > 0 ? (
							<StackList
								stacks={personalStacks}
								onEdit={openEditStack}
								onSetDefault={s => {
									void setDefault(s)
								}}
								onDelete={setConfirmStack}
							/>
						) : (
							<Empty>
								<Trans>
									No stacks yet. Create one to group your templates.
								</Trans>
							</Empty>
						)}

						{stackEditorOpen ? (
							<StackEditor
								agent={agent}
								scope='personal'
								stack={editingStack}
								options={options}
								orgDefaultTemplateIds={orgDefaultTemplateIds}
								hasExistingDefault={hasPersonalDefault}
								onDone={stackSaved}
							/>
						) : (
							<Actions>
								<PriButton
									type='button'
									$variant='filled'
									data-testid='new-stack'
									onClick={openNewStack}
								>
									<Plus size={16} aria-hidden />
									<Trans>New stack</Trans>
								</PriButton>
							</Actions>
						)}
					</>
				)}
			</Section>

			<TemplateViewDialog
				open={viewingRow !== null}
				name={viewingRow?.name ?? ''}
				body={viewingRow?.body ?? ''}
				canEdit={
					viewingRow !== null &&
					viewingRow.ownerUserId !== null &&
					viewingRow.ownerUserId === myUserId
				}
				// Stepping from reading to editing swaps one dialog for the other, so
				// Back leaves the template rather than dropping you back into reading
				// what you just finished editing.
				onEdit={() => {
					if (viewingRow !== null)
						openDlg({ kind: 'edit', id: viewingRow.id }, { replace: true })
				}}
				onClose={closeDlg}
				testId='template-view-dialog'
			/>

			<TemplateEditorDialog
				open={dialogOpen}
				onOpenChange={next => {
					if (!next) closeDlg()
				}}
				editing={editing}
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
				testId='template-delete-confirm'
				title={<Trans>Delete this template?</Trans>}
				description={
					<Trans>
						"{confirmTarget?.name ?? ''}" will be removed for good. This can't
						be undone.
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
				testId='stack-delete-confirm'
				title={<Trans>Delete this stack?</Trans>}
				description={
					<Trans>
						"{confirmStack?.name ?? ''}" will be removed. Your templates stay;
						only this grouping goes.
					</Trans>
				}
			/>
		</Page>
	)
}

const InheritBanner = styled.div`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding: var(--space-sm);
	border-radius: var(--shape-2xs);
	border-left: 2px solid var(--color-ledger-line-strong);
`

const BannerText = styled.span`
	${stenciledTitle}
	font-size: var(--typescale-label-medium-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const BannerHint = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	margin: 0;
`

const OrgList = styled.ul`
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const OrgItem = styled.li`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface-variant);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const Actions = styled.div`
	display: flex;
	gap: var(--space-sm);
`
