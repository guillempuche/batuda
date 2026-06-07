import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import {
	ArrowLeft,
	Check,
	Download,
	Pencil,
	Plus,
	ScrollText,
	Trash2,
	X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriDialog, usePriToast } from '@batuda/ui/pri'

import {
	acceptDonationAtom,
	defaultStacksAtom,
	deleteTemplateAtom,
	importPresetAtom,
	instructionDonationsAtom,
	instructionPresetsAtom,
	instructionTemplatesAtom,
	rejectDonationAtom,
	setOrgStackAtom,
} from '#/atoms/instruction-atoms'
import {
	InstructionIconButton,
	OwnerBadge,
} from '#/components/instructions/instruction-chrome'
import {
	narrowDonations,
	narrowPresets,
	narrowStackIds,
	narrowTemplates,
	type TemplateShape,
} from '#/components/instructions/instruction-shapes'
import {
	type StackOption,
	StackPicker,
} from '#/components/instructions/stack-picker'
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

export const Route = createFileRoute('/settings/organization/templates')({
	head: () => ({ meta: [{ title: 'Org instruction templates — Batuda' }] }),
	component: OrgTemplatesPage,
})

function OrgTemplatesPage() {
	const { t } = useLingui()
	const toast = usePriToast()
	const activeMember = authClient.useActiveMember()
	const role = activeMember.data?.role ?? null
	const isAdmin = role === 'owner' || role === 'admin'

	const templatesResult = useAtomValue(instructionTemplatesAtom)
	const refreshTemplates = useAtomRefresh(instructionTemplatesAtom)
	const donationsResult = useAtomValue(instructionDonationsAtom)
	const refreshDonations = useAtomRefresh(instructionDonationsAtom)
	const presetsResult = useAtomValue(instructionPresetsAtom)
	const stacksAtom = useMemo(() => defaultStacksAtom(AGENT), [])
	const stacksResult = useAtomValue(stacksAtom)
	const refreshStacks = useAtomRefresh(stacksAtom)

	const deleteTemplate = useAtomSet(deleteTemplateAtom, { mode: 'promiseExit' })
	const setOrgStack = useAtomSet(setOrgStackAtom, { mode: 'promiseExit' })
	const acceptDonation = useAtomSet(acceptDonationAtom, { mode: 'promiseExit' })
	const rejectDonation = useAtomSet(rejectDonationAtom, { mode: 'promiseExit' })
	const importPreset = useAtomSet(importPresetAtom, { mode: 'promiseExit' })

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
	const pendingDonations = useMemo(
		() =>
			AsyncResult.isSuccess(donationsResult)
				? narrowDonations(donationsResult.value).filter(
						d => d.status === 'pending',
					)
				: [],
		[donationsResult],
	)
	const presets = useMemo(
		() =>
			AsyncResult.isSuccess(presetsResult)
				? narrowPresets(presetsResult.value)
				: [],
		[presetsResult],
	)
	const stacksFailed = AsyncResult.isFailure(stacksResult)
	const orgStackIds = AsyncResult.isSuccess(stacksResult)
		? narrowStackIds(stacksResult.value, 'org')
		: null

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
	// Seeded from the saved org default; null until the stacks query resolves.
	const [stackIds, setStackIds] = useState<ReadonlyArray<string> | null>(null)
	const [savingStack, setSavingStack] = useState(false)
	const effectiveStack = stackIds ?? orgStackIds ?? []

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
		const outcome =
			exit._tag === 'Success'
				? (exit.value as { outcome?: string } | null)?.outcome
				: null
		if (outcome === 'in_use') {
			toast.add({
				title: t`Still in use`,
				description: t`Remove "${target.name}" from the org default first, then delete it.`,
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

	const saveStack = async () => {
		setSavingStack(true)
		// Drop ids whose template was deleted mid-edit so we never persist a
		// dangling reference the server would only reject.
		const ids = effectiveStack.filter(id => stackOptions.some(o => o.id === id))
		const exit = await setOrgStack({
			params: { agent: AGENT },
			payload: { template_ids: ids },
		} as never)
		setSavingStack(false)
		const outcome =
			exit._tag === 'Success'
				? (exit.value as { outcome?: string } | null)?.outcome
				: null
		if (outcome === 'set') {
			toast.add({ title: t`Org default saved`, type: 'success' })
			refreshStacks()
			return
		}
		toast.add({
			title: t`Couldn't save`,
			description: t`Please try again.`,
			type: 'error',
		})
	}

	const accept = async (id: string, name: string) => {
		const exit = await acceptDonation({ params: { id } } as never)
		const outcome =
			exit._tag === 'Success'
				? (exit.value as { outcome?: string } | null)?.outcome
				: null
		if (outcome === 'accepted') {
			toast.add({
				title: t`Added to the org`,
				description: t`"${name}" is now an org template.`,
				type: 'success',
			})
			refreshTemplates()
			refreshDonations()
			return
		}
		toast.add({
			title: t`Couldn't add it`,
			description: t`Please try again.`,
			type: 'error',
		})
		refreshDonations()
	}

	const reject = async (id: string) => {
		const exit = await rejectDonation({ params: { id } } as never)
		const outcome =
			exit._tag === 'Success'
				? (exit.value as { outcome?: string } | null)?.outcome
				: null
		if (outcome === 'rejected') {
			toast.add({ title: t`Proposal declined`, type: 'success' })
		} else {
			toast.add({
				title: t`Couldn't decline it`,
				description: t`Please try again.`,
				type: 'error',
			})
		}
		refreshDonations()
	}

	const importToOrg = async (presetId: string, name: string) => {
		const exit = await importPreset({
			params: { presetId },
			payload: { scope: 'org' },
		} as never)
		const outcome =
			exit._tag === 'Success'
				? (exit.value as { outcome?: string } | null)?.outcome
				: null
		if (outcome === 'imported') {
			toast.add({
				title: t`Added to the org`,
				description: t`"${name}" is now an org template you can edit.`,
				type: 'success',
			})
			refreshTemplates()
			return
		}
		toast.add({
			title: t`Couldn't import it`,
			description: t`Please try again.`,
			type: 'error',
		})
	}

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
						Shared guidance every member's research agent can use, plus the
						organization's default.
					</Trans>
				</Subtitle>
			</Intro>

			{!isAdmin ? (
				<Section>
					<Notice role='note'>
						<Trans>
							Your organization's admins manage these templates. You can use any
							of them in your own default or per run.
						</Trans>
					</Notice>
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
			) : (
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
								<Trans>
									No org templates yet. Create one, import a preset, or accept a
									member's proposal.
								</Trans>
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

					<Card data-testid='org-default-stack'>
						<SectionTitle>
							<Trans>Organization default</Trans>
						</SectionTitle>
						<Hint>
							<Trans>
								These templates run for every member who hasn't set their own —
								in order. Only org templates can go here.
							</Trans>
						</Hint>
						{stacksFailed ? (
							<Notice role='alert'>
								<Trans>
									Couldn't load the org default. Refresh to try again.
								</Trans>
							</Notice>
						) : orgTemplates.length === 0 ? (
							<Empty>
								<Trans>Add an org template first.</Trans>
							</Empty>
						) : (
							<>
								<StackPicker
									options={stackOptions}
									selectedIds={effectiveStack}
									onChange={setStackIds}
								/>
								<Actions>
									<PriButton
										type='button'
										$variant='filled'
										data-testid='org-default-save'
										disabled={savingStack || effectiveStack.length === 0}
										onClick={() => {
											void saveStack()
										}}
									>
										<Trans>Save the org default</Trans>
									</PriButton>
								</Actions>
							</>
						)}
					</Card>

					<Section>
						<SectionTitle>
							<Trans>Member proposals</Trans>
						</SectionTitle>
						{pendingDonations.length === 0 ? (
							<Empty>
								<Trans>No proposals waiting for review.</Trans>
							</Empty>
						) : (
							<ReviewList>
								{pendingDonations.map(d => (
									<ReviewItem key={d.id} data-testid='donation-row'>
										<ReviewHead>
											<TemplateName>{d.name}</TemplateName>
											<ReviewActions>
												<PriButton
													type='button'
													$variant='filled'
													data-testid='donation-accept'
													onClick={() => {
														void accept(d.id, d.name)
													}}
												>
													<Check size={14} aria-hidden />
													<Trans>Add to org</Trans>
												</PriButton>
												<InstructionIconButton
													type='button'
													aria-label={t`Decline ${d.name}`}
													onClick={() => {
														void reject(d.id)
													}}
												>
													<X size={14} aria-hidden />
												</InstructionIconButton>
											</ReviewActions>
										</ReviewHead>
										<BodyPreview>{preview(d.body)}</BodyPreview>
									</ReviewItem>
								))}
							</ReviewList>
						)}
					</Section>

					<Section>
						<SectionTitle>
							<Trans>Starter presets</Trans>
						</SectionTitle>
						<Hint>
							<Trans>
								Batuda-written templates you can drop into the org and edit.
							</Trans>
						</Hint>
						{presets.length === 0 ? (
							<Empty>
								<Trans>No presets available.</Trans>
							</Empty>
						) : (
							<ReviewList>
								{presets.map(p => (
									<ReviewItem key={p.id} data-testid='preset-row'>
										<ReviewHead>
											<TemplateName>{p.name}</TemplateName>
											<PriButton
												type='button'
												$variant='outlined'
												data-testid='preset-import'
												onClick={() => {
													void importToOrg(p.id, p.name)
												}}
											>
												<Download size={14} aria-hidden />
												<Trans>Import to org</Trans>
											</PriButton>
										</ReviewHead>
										<BodyPreview>{preview(p.body)}</BodyPreview>
									</ReviewItem>
								))}
							</ReviewList>
						)}
					</Section>
				</>
			)}

			<TemplateEditorDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				editing={editing}
				scope='org'
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
					<PriDialog.Popup data-testid='org-template-delete-confirm'>
						<PriDialog.Title>
							<Trans>Delete this org template?</Trans>
						</PriDialog.Title>
						<PriDialog.Description>
							<Trans>
								"{confirmTarget?.name ?? ''}" will be removed for everyone in
								the organization. This can't be undone.
							</Trans>
						</PriDialog.Description>
						<DialogActions>
							<PriButton
								type='button'
								$variant='filled'
								data-testid='org-template-delete-confirm-button'
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

function preview(body: string): string {
	const flat = body.replace(/\s+/g, ' ').trim()
	return flat.length > 140 ? `${flat.slice(0, 140)}…` : flat
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

const Card = styled.section`
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

const Hint = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
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

const ReviewList = styled.ul`
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
`

const ReviewItem = styled.li`
	${ruledLedgerRow}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-bottom: var(--space-sm);
`

const ReviewHead = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
`

const ReviewActions = styled.div`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
`

const BodyPreview = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Actions = styled.div`
	display: flex;
	gap: var(--space-sm);
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
	color: var(--color-on-surface-variant);
	margin: 0;
`

const DialogActions = styled.div`
	display: flex;
	gap: var(--space-sm);
	justify-content: flex-end;
	margin-top: var(--space-md);
`
