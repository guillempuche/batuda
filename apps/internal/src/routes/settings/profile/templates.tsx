import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import { ArrowLeft, Gift, Pencil, Plus, ScrollText, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriDialog, usePriToast } from '@batuda/ui/pri'

import {
	defaultStacksAtom,
	deleteTemplateAtom,
	donateTemplateAtom,
	instructionTemplatesAtom,
} from '#/atoms/instruction-atoms'
import { DefaultStackEditor } from '#/components/instructions/default-stack-editor'
import {
	InstructionIconButton,
	OwnerBadge,
} from '#/components/instructions/instruction-chrome'
import {
	BackLink,
	DialogActions,
	Empty,
	Heading,
	Intro,
	Notice,
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
	narrowStackIds,
	narrowTemplates,
	outcomeOf,
	type TemplateShape,
} from '#/components/instructions/instruction-shapes'
import type { StackOption } from '#/components/instructions/stack-picker'
import {
	type TemplateDraft,
	TemplateEditorDialog,
} from '#/components/instructions/template-editor-dialog'
import { authClient } from '#/lib/auth-client'
import { brushedMetalPlate, stenciledTitle } from '#/lib/workshop-mixins'

const AGENT = 'research'

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
	const donateTemplate = useAtomSet(donateTemplateAtom, { mode: 'promiseExit' })

	const templatesFailed = AsyncResult.isFailure(templatesResult)
	const stacksFailed = AsyncResult.isFailure(stacksResult)
	const templates = useMemo<ReadonlyArray<TemplateShape>>(
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
		if (exit._tag !== 'Success') {
			toast.add({
				title: t`Delete failed`,
				description: t`Couldn't delete the template. Please try again.`,
				type: 'error',
			})
			return
		}
		const outcome = outcomeOf(exit)
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

	// Offer a personal template to the org; an admin reviews it before it
	// becomes an org-owned template everyone can use.
	const donate = async (row: TemplateShape) => {
		const exit = await donateTemplate({ params: { id: row.id } } as never)
		const outcome = outcomeOf(exit)
		if (outcome === 'proposed') {
			toast.add({
				title: t`Sent to your admins`,
				description: t`"${row.name}" is waiting for an admin to add it to the organization.`,
				type: 'success',
			})
			return
		}
		toast.add({
			title: t`Couldn't send it`,
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
												aria-label={t`Donate ${row.name} to your organization`}
												onClick={() => {
													void donate(row)
												}}
											>
												<Gift size={14} aria-hidden />
											</InstructionIconButton>
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
