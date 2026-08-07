import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute } from '@tanstack/react-router'
import { Schema } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import { ArrowLeft, Plus, ScrollText } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'

import type { Agent } from '@batuda/instructions/domain'
import { PriButton, usePriToast } from '@batuda/ui/pri'

import {
	clearDefaultStackAtom,
	deleteStackAtom,
	instructionResolutionAtom,
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
import { TemplateLibrary } from '#/components/instructions/template-library'
import { DeleteConfirm } from '#/components/shared/delete-confirm'
import { ErrorState } from '#/components/shared/error-state'
import { authClient } from '#/lib/auth-client'
import { dlgNoId, dlgWithId } from '#/lib/dlg-search'
import { validateSearchWith } from '#/lib/search-schema'
import { useDlg } from '#/lib/use-dlg'
import { useReadParam } from '#/lib/use-read-param'
import { brushedMetalPlate, stenciledTitle } from '#/lib/workshop-mixins'

// The writing surfaces live in the `?dlg=` param so they are deep-linkable and
// the browser Back button closes them — `create`/`new-stack` open on their own,
// `edit`/`stack` target a row by id. Reading carries its own `?read=` key so it
// can open over any of them. The template half of this union is handled inside
// TemplateLibrary, which decodes the same values against its own narrower one.
const templatesDlgSchema = Schema.Union([
	dlgNoId('create'),
	dlgWithId('edit'),
	dlgNoId('new-stack'),
	dlgWithId('stack'),
])

export const Route = createFileRoute('/settings/profile/templates')({
	validateSearch: validateSearchWith({
		dlg: templatesDlgSchema,
		read: Schema.NonEmptyString,
	}),
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
	const { openRead } = useReadParam()
	const [confirmStack, setConfirmStack] = useState<StackShape | null>(null)
	const [deletingStack, setDeletingStack] = useState(false)

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

	// A link to a stack that is gone drops itself once the list has loaded.
	const templatesLoaded = AsyncResult.isSuccess(templatesResult)
	const stacksLoaded = AsyncResult.isSuccess(stacksResult)
	useEffect(() => {
		if (dlg?.kind === 'stack' && stacksLoaded && editingStack === null) {
			closeDlg()
		}
	}, [dlg, stacksLoaded, editingStack, closeDlg])

	const openNewStack = () => openDlg({ kind: 'new-stack' })
	const openEditStack = (s: StackShape) => openDlg({ kind: 'stack', id: s.id })

	const stackSaved = () => {
		refreshStacks()
		refreshResolution()
		closeDlg()
	}

	// A template can sit inside a stack, so a change to one can change the other.
	const templatesChanged = () => {
		refreshTemplates()
		refreshStacks()
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

			<TemplateLibrary
				templates={templates}
				loaded={templatesLoaded}
				failed={templatesFailed}
				scope='personal'
				myUserId={myUserId}
				onChanged={templatesChanged}
				onRetry={refreshTemplates}
				title={<Trans>Templates</Trans>}
				newLabel={<Trans>New template</Trans>}
				emptyText={
					<Trans>
						No templates yet. Create one to start shaping your runs.
					</Trans>
				}
				testIds={{
					row: 'template-row',
					view: 'template-view',
					newButton: 'templates-new',
					error: 'profile-templates-error',
					dialog: 'template-view-dialog',
				}}
			/>

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
								onRead={openRead}
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

			<DeleteConfirm
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
