import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute } from '@tanstack/react-router'
import { Schema } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import { ArrowLeft, Plus, ScrollText } from 'lucide-react'
import { styled } from 'next-yak'
import { useEffect, useMemo, useState } from 'react'

import type { Agent } from '@batuda/instructions/domain'
import { PriButton, usePriToast } from '@batuda/ui/pri'

import {
	clearDefaultStackAtom,
	deleteStackAtom,
	instructionStacksAtom,
	instructionTemplatesAtom,
	setDefaultStackAtom,
} from '#/atoms/instruction-atoms'
import { AgentSelector } from '#/components/instructions/agent-selector'
import {
	BackLink,
	Empty,
	Heading,
	Intro,
	Page,
	Section,
	SectionHead,
	SectionTitle,
	Subtitle,
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
import { TemplateLibrary } from '#/components/instructions/template-library'
import { DeleteConfirm } from '#/components/shared/delete-confirm'
import { ErrorState } from '#/components/shared/error-state'
import { authClient } from '#/lib/auth-client'
import { dlgNoId, dlgWithId } from '#/lib/dlg-search'
import { validateSearchWith } from '#/lib/search-schema'
import { useDlg } from '#/lib/use-dlg'
import { useReadParam } from '#/lib/use-read-param'
import { brushedMetalPlate, stenciledTitle } from '#/lib/workshop-mixins'

// As on the personal templates page, the dialogs live in `?dlg=` so they are
// deep-linkable and Back closes them. The stack half belongs to the admins who
// look after what every member's agents run by default; the template half is
// handled inside TemplateLibrary and is open to everyone.
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
	const activeMember = authClient.useActiveMember()
	const session = authClient.useSession()
	const myUserId = session.data?.user?.id ?? null
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
	const templatesLoaded = AsyncResult.isSuccess(templatesResult)
	const templatesFailed = AsyncResult.isFailure(templatesResult)

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

			{/* Anyone in the organization looks after the shared templates; only
			    admins decide which of them every member's agents follow. */}
			<TemplateLibrary
				templates={orgTemplates}
				loaded={templatesLoaded}
				failed={templatesFailed}
				scope='org'
				myUserId={myUserId}
				onChanged={refreshTemplates}
				onRetry={refreshTemplates}
				title={<Trans>Org templates</Trans>}
				newLabel={<Trans>New org template</Trans>}
				emptyText={
					<Trans>No org templates yet. Create one to get started.</Trans>
				}
				testIds={{
					row: 'org-template-row',
					view: 'org-template-view',
					newButton: 'org-templates-new',
					error: 'org-templates-error',
					dialog: 'org-template-view-dialog',
				}}
			/>

			{isAdmin ? (
				<OrgStacksAdmin orgTemplates={orgTemplates} />
			) : (
				<OrgStacksViewer />
			)}
		</Page>
	)
}

// Read-only org stacks for a regular member: names and badges so they know what
// the organization has set up, without any controls (every org stack write is
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

// The admin half of the org templates page: the stacks that decide what every
// member's agents run when a request names none. Mounted only for owners and
// admins, so its queries never fire for a regular member — who can't act on
// that data anyway, since every org stack write is admin-gated on the server.
function OrgStacksAdmin({
	orgTemplates,
}: {
	readonly orgTemplates: ReadonlyArray<TemplateShape>
}) {
	const { t } = useLingui()
	const toast = usePriToast()

	// Instructions are per surface; this picks which surface's org stacks the
	// section below edits. Org templates themselves are surface-neutral.
	const [agent, setAgent] = useState<Agent>('research')

	const stacksAtom = useMemo(() => instructionStacksAtom(agent), [agent])
	const stacksResult = useAtomValue(stacksAtom)
	const refreshStacks = useAtomRefresh(stacksAtom)

	const deleteStack = useAtomSet(deleteStackAtom, { mode: 'promiseExit' })
	const setDefaultStack = useAtomSet(setDefaultStackAtom, {
		mode: 'promiseExit',
	})
	const clearDefaultStack = useAtomSet(clearDefaultStackAtom, {
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
	const defaultStack = orgStacks.find(s => s.isDefault) ?? null

	const templateNameById = useMemo(
		() => new Map(orgTemplates.map(tpl => [tpl.id, tpl.name])),
		[orgTemplates],
	)
	const stackOptions = useMemo<ReadonlyArray<StackOption>>(
		() =>
			orgTemplates.map(x => ({ id: x.id, name: x.name, ownerUserId: null })),
		[orgTemplates],
	)

	// The confirmations stay local: they are a passing step in something the user
	// is already doing, not a place worth linking someone to.
	const [confirmStack, setConfirmStack] = useState<StackShape | null>(null)
	const [deletingStack, setDeletingStack] = useState(false)
	const [confirmClearDefault, setConfirmClearDefault] = useState(false)
	const [clearingDefault, setClearingDefault] = useState(false)

	const { dlg, open: openDlg, close: closeDlg } = useDlg(orgTemplatesDlgSchema)
	const { openRead } = useReadParam()

	const editingStack =
		dlg?.kind === 'stack'
			? (orgStacks.find(s => s.id === dlg.id) ?? null)
			: null
	const stackEditorOpen =
		dlg?.kind === 'new-stack' ||
		(dlg?.kind === 'stack' && editingStack !== null)

	// A link to a stack that is gone — deleted, or belonging to another surface —
	// drops itself once the list has loaded.
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

	// Unsetting the org default leaves every member who hasn't picked their own
	// running with no shared guidance at all, so it asks first.
	const clearOrgDefault = async () => {
		if (clearingDefault) return
		setClearingDefault(true)
		const exit = await clearDefaultStack({
			params: { agent },
			query: { scope: 'org' },
		} as never)
		setClearingDefault(false)
		setConfirmClearDefault(false)
		if (outcomeOf(exit) === 'cleared') {
			toast.add({ title: t`Org default cleared`, type: 'success' })
			refreshStacks()
			return
		}
		toast.add({
			title: t`Couldn't clear the default`,
			description: t`Please try again.`,
			type: 'error',
		})
	}

	const stackSaved = () => {
		closeDlg()
		refreshStacks()
	}

	return (
		<>
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

				{defaultStack !== null ? (
					<DefaultBanner data-testid='org-default-banner'>
						<BannerText>
							<Trans>Every member follows "{defaultStack.name}"</Trans>
						</BannerText>
						<OrgList>
							{defaultStack.templateIds.map(id => (
								<OrgItem key={id}>{templateNameById.get(id) ?? id}</OrgItem>
							))}
						</OrgList>
						<PriButton
							type='button'
							$variant='text'
							data-testid='clear-org-default'
							onClick={() => setConfirmClearDefault(true)}
						>
							<Trans>Clear the org default</Trans>
						</PriButton>
					</DefaultBanner>
				) : null}

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
								hasExistingDefault={defaultStack !== null}
								onDone={stackSaved}
								onRead={openRead}
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

			<DeleteConfirm
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

			<DeleteConfirm
				open={confirmClearDefault}
				deleting={clearingDefault}
				onConfirm={() => {
					void clearOrgDefault()
				}}
				onClose={() => setConfirmClearDefault(false)}
				testId='org-default-clear-confirm'
				title={<Trans>Clear the org default?</Trans>}
				description={
					<Trans>
						Every member who hasn't picked their own stack will run with no
						shared guidance until you set another default.
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

// Mirrors the personal page's inherit banner: what is in force right now, and
// the one control that changes it.
const DefaultBanner = styled.div`
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
