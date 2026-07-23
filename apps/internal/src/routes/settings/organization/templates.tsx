import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import { ArrowLeft, Pencil, Plus, ScrollText, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
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
	TemplateName,
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
import { ErrorState } from '#/components/shared/error-state'
import { authClient } from '#/lib/auth-client'

export const Route = createFileRoute('/settings/organization/templates')({
	head: () => ({ meta: [{ title: 'Org instruction templates — Batuda' }] }),
	component: OrgTemplatesPage,
})

function OrgTemplatesPage() {
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
				/>
			) : (
				<>
					<Section>
						<Hint role='note'>
							<Trans>
								Your organization's admins manage these templates. You can use
								any of them in your own stacks or per run.
							</Trans>
						</Hint>
						{orgTemplates.length > 0 ? (
							<TemplateList>
								{orgTemplates.map(row => (
									<TemplateRowItem key={row.id} data-testid='org-template-row'>
										<TemplateName>{row.name}</TemplateName>
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
}: {
	readonly orgTemplates: ReadonlyArray<TemplateShape>
	readonly refreshTemplates: () => void
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

	const [dialogOpen, setDialogOpen] = useState(false)
	const [editing, setEditing] = useState<TemplateDraft | null>(null)
	const [confirmTarget, setConfirmTarget] = useState<{
		readonly id: string
		readonly name: string
	} | null>(null)
	const [deleting, setDeleting] = useState(false)
	// Local master-detail: null = closed, or a create/edit target for the editor.
	const [stackEditing, setStackEditing] = useState<
		| { readonly mode: 'new' }
		| { readonly mode: 'edit'; readonly stack: StackShape }
		| null
	>(null)
	const [confirmStack, setConfirmStack] = useState<StackShape | null>(null)
	const [deletingStack, setDeletingStack] = useState(false)

	// Switching surface drops any open editor for the previous surface.
	const selectAgent = (next: Agent) => {
		setAgent(next)
		setStackEditing(null)
	}

	const openCreate = () => {
		setEditing(null)
		setDialogOpen(true)
	}
	const openEdit = (row: TemplateShape) => {
		setEditing({ id: row.id, name: row.name, body: row.body })
		setDialogOpen(true)
	}

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
		setStackEditing(null)
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
								<TemplateName>{row.name}</TemplateName>
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
								onEdit={s => setStackEditing({ mode: 'edit', stack: s })}
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

						{stackEditing !== null ? (
							<StackEditor
								agent={agent}
								scope='org'
								stack={stackEditing.mode === 'edit' ? stackEditing.stack : null}
								options={stackOptions}
								orgDefaultTemplateIds={[]}
								hasExistingDefault={hasOrgDefault}
								onDone={stackSaved}
							/>
						) : (
							<Actions>
								<PriButton
									type='button'
									$variant='filled'
									data-testid='org-stack-new'
									onClick={() => setStackEditing({ mode: 'new' })}
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
				onOpenChange={setDialogOpen}
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
