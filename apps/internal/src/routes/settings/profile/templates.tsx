import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import { ArrowLeft, Pencil, Plus, ScrollText, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriDialog, usePriToast } from '@batuda/ui/pri'

import {
	defaultStacksAtom,
	deleteTemplateAtom,
	instructionTemplatesAtom,
} from '#/atoms/instruction-atoms'
import { DefaultStackEditor } from '#/components/instructions/default-stack-editor'
import {
	InstructionIconButton,
	OwnerBadge,
} from '#/components/instructions/instruction-chrome'
import type { StackOption } from '#/components/instructions/stack-picker'
import {
	type TemplateDraft,
	TemplateEditorDialog,
} from '#/components/instructions/template-editor-dialog'
import { authClient } from '#/lib/auth-client'
import {
	brushedMetalPlate,
	ruledLedgerRow,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

const AGENT = 'research'

type TemplateRow = {
	readonly id: string
	readonly name: string
	readonly body: string
	readonly ownerUserId: string | null
}

export const Route = createFileRoute('/settings/profile/templates')({
	head: () => ({ meta: [{ title: 'Instruction templates — Batuda' }] }),
	component: TemplatesPage,
})

function TemplatesPage() {
	const { t } = useLingui()
	const toast = usePriToast()
	const session = authClient.useSession()
	const myUserId = session.data?.user?.id ?? null

	const templatesResult = useAtomValue(instructionTemplatesAtom)
	const refreshTemplates = useAtomRefresh(instructionTemplatesAtom)
	const stacksAtom = useMemo(() => defaultStacksAtom(AGENT), [])
	const stacksResult = useAtomValue(stacksAtom)
	const refreshStacks = useAtomRefresh(stacksAtom)
	const deleteTemplate = useAtomSet(deleteTemplateAtom, { mode: 'promiseExit' })

	const templatesFailed = AsyncResult.isFailure(templatesResult)
	const stacksFailed = AsyncResult.isFailure(stacksResult)
	const templates = useMemo<ReadonlyArray<TemplateRow>>(
		() =>
			AsyncResult.isSuccess(templatesResult)
				? narrowTemplates(templatesResult.value)
				: [],
		[templatesResult],
	)
	const userStackIds = AsyncResult.isSuccess(stacksResult)
		? narrowStackIds(stacksResult.value, 'user')
		: null
	const orgStackIds = AsyncResult.isSuccess(stacksResult)
		? narrowStackIds(stacksResult.value, 'org')
		: null

	const options = useMemo<ReadonlyArray<StackOption>>(
		() =>
			templates.map(template => ({
				id: template.id,
				name: template.name,
				ownerUserId: template.ownerUserId,
			})),
		[templates],
	)

	const [dialogOpen, setDialogOpen] = useState(false)
	const [editing, setEditing] = useState<TemplateDraft | null>(null)
	const [confirmTarget, setConfirmTarget] = useState<{
		readonly id: string
		readonly name: string
	} | null>(null)
	const [deleting, setDeleting] = useState(false)

	const openCreate = () => {
		setEditing(null)
		setDialogOpen(true)
	}
	const openEdit = (row: TemplateRow) => {
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
		if (exit._tag !== 'Success') {
			toast.add({
				title: t`Delete failed`,
				description: t`Couldn't delete the template. Please try again.`,
				type: 'error',
			})
			return
		}
		const outcome = (exit.value as { outcome?: string } | null)?.outcome
		// A template still referenced by a default stack is blocked server-side;
		// surface why instead of letting the row silently reappear.
		if (outcome === 'in_use') {
			toast.add({
				title: t`Still in use`,
				description: t`Remove "${target.name}" from your default first, then delete it.`,
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
						Reusable, standing guidance your research agent follows — what you
						sell, who you target, tone, and which sources to trust.
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
					<Notice role='alert'>
						<Trans>Couldn't load your templates. Refresh to try again.</Trans>
					</Notice>
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
									<TemplateName>{row.name}</TemplateName>
									<OwnerBadge>
										{row.ownerUserId === null ? (
											<Trans>Org</Trans>
										) : (
											<Trans>Mine</Trans>
										)}
									</OwnerBadge>
									{mine ? (
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
									) : null}
								</TemplateRowItem>
							)
						})}
					</TemplateList>
				)}
			</Section>

			{stacksFailed ? (
				<Notice role='alert'>
					<Trans>Couldn't load your default. Refresh to try again.</Trans>
				</Notice>
			) : templates.length === 0 ? (
				<EmptyDefault>
					<EmptyDefaultTitle>
						<Trans>Your research default</Trans>
					</EmptyDefaultTitle>
					<Empty>
						<Trans>
							Create a template above first, then pick which ones run by
							default.
						</Trans>
					</Empty>
				</EmptyDefault>
			) : (
				<DefaultStackEditor
					agent={AGENT}
					options={options}
					userStackIds={userStackIds}
					orgStackIds={orgStackIds}
					onSaved={() => {
						refreshStacks()
					}}
				/>
			)}

			<TemplateEditorDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				editing={editing}
				onSaved={() => {
					refreshTemplates()
				}}
			/>

			<PriDialog.Root
				open={confirmTarget !== null}
				onOpenChange={(nextOpen: boolean) => {
					if (!nextOpen && !deleting) setConfirmTarget(null)
				}}
			>
				<PriDialog.Portal>
					<PriDialog.Backdrop />
					<PriDialog.Popup data-testid='template-delete-confirm'>
						<PriDialog.Title>
							<Trans>Delete this template?</Trans>
						</PriDialog.Title>
						<PriDialog.Description>
							<Trans>
								"{confirmTarget?.name ?? ''}" will be removed for good. This
								can't be undone.
							</Trans>
						</PriDialog.Description>
						<DialogActions>
							<PriButton
								type='button'
								$variant='filled'
								data-testid='template-delete-confirm-button'
								disabled={deleting}
								onClick={() => {
									void confirmDelete()
								}}
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
		</Page>
	)
}

function narrowTemplates(value: unknown): ReadonlyArray<TemplateRow> {
	if (!Array.isArray(value)) return []
	const out: Array<TemplateRow> = []
	for (const row of value) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		const id = typeof r['id'] === 'string' ? r['id'] : null
		const name = typeof r['name'] === 'string' ? r['name'] : null
		if (id === null || name === null) continue
		out.push({
			id,
			name,
			body: typeof r['body'] === 'string' ? r['body'] : '',
			ownerUserId:
				typeof r['ownerUserId'] === 'string' ? r['ownerUserId'] : null,
		})
	}
	return out
}

function narrowStackIds(
	value: unknown,
	key: 'org' | 'user',
): ReadonlyArray<string> | null {
	if (!value || typeof value !== 'object') return null
	const slot = (value as Record<string, unknown>)[key]
	if (!slot || typeof slot !== 'object') return null
	const ids = (slot as Record<string, unknown>)['templateIds']
	if (!Array.isArray(ids)) return null
	return ids.filter((x): x is string => typeof x === 'string')
}

const Page = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`

const BackLink = styled(Link)`
	display: inline-flex;
	gap: var(--space-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-medium-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
	text-decoration: none;

	&:hover {
		color: var(--color-on-surface);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const Intro = styled.div`
	${rulerUnderRule}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-bottom: var(--space-xs);
`

const Heading = styled.h2`
	${stenciledTitle}
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
	margin: 0;
`

const Subtitle = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
	max-width: 46rem;
`

const Section = styled.section`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md);
	border-radius: var(--shape-2xs);
`

const SectionHead = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
`

const SectionTitle = styled.h3`
	${stenciledTitle}
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
	margin: 0;
`

const TemplateList = styled.ul`
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const TemplateRowItem = styled.li`
	${ruledLedgerRow}
	display: flex;
	align-items: center;
	gap: var(--space-sm);
	padding: var(--space-2xs) 0;
`

const TemplateName = styled.span`
	flex: 1 1 auto;
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const RowActions = styled.div`
	display: inline-flex;
	gap: var(--space-2xs);
`

const Empty = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Notice = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-error);
	padding: var(--space-2xs) var(--space-sm);
	border-left: 3px solid var(--color-error);
	background: color-mix(in srgb, var(--color-error) 6%, transparent);
	margin: 0;
`

const EmptyDefault = styled.section`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md);
	border-radius: var(--shape-2xs);
`

const EmptyDefaultTitle = styled.h3`
	${stenciledTitle}
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
	margin: 0;
`

const DialogActions = styled.div`
	display: flex;
	gap: var(--space-sm);
	justify-content: flex-end;
	margin-top: var(--space-md);
`
