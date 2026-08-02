import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import { ArrowLeft, Check, Merge, Trash2 } from 'lucide-react'
import { useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriDialog, PriInput, usePriToast } from '@batuda/ui/pri'

import {
	type CompanyIndustry,
	companyIndustriesAtom,
} from '#/atoms/company-industries-atoms'
import { PriCombobox } from '#/components/primitives/pri-combobox'
import { ErrorState } from '#/components/shared/error-state'
import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import {
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

/**
 * The organisation's own list of trades, and the four things worth doing to it.
 *
 * Trades are not created here — one comes into being the moment somebody writes
 * it onto a company, which is the only time anybody knows what it should be
 * called. This page is for afterwards: agreeing on the wording research
 * proposed, correcting a spelling, folding a duplicate into the one that
 * stays, and dropping one nothing turned out to use.
 *
 * The ones research proposed are listed first and marked, because they are the
 * only entries nobody has actually read.
 */

export const Route = createFileRoute('/settings/organization/industries')({
	head: () => ({ meta: [{ title: 'Industries — Batuda' }] }),
	component: IndustriesPage,
})

function IndustriesPage() {
	const { t } = useLingui()
	const toast = usePriToast()

	const listResult = useAtomValue(companyIndustriesAtom)
	const refresh = useAtomRefresh(companyIndustriesAtom)

	const renameIndustry = useAtomSet(
		BatudaApiAtom.mutation('companyIndustries', 'rename'),
		{ mode: 'promiseExit' },
	)
	const reviewIndustry = useAtomSet(
		BatudaApiAtom.mutation('companyIndustries', 'review'),
		{ mode: 'promiseExit' },
	)
	const mergeIndustry = useAtomSet(
		BatudaApiAtom.mutation('companyIndustries', 'merge'),
		{ mode: 'promiseExit' },
	)
	const deleteIndustry = useAtomSet(
		BatudaApiAtom.mutation('companyIndustries', 'delete'),
		{ mode: 'promiseExit' },
	)

	// The row being renamed, and the draft it holds. One at a time: renaming two
	// trades at once has no meaning, and a single draft cannot be mixed up.
	const [editingId, setEditingId] = useState<string | null>(null)
	const [draft, setDraft] = useState('')
	const [busyId, setBusyId] = useState<string | null>(null)
	const [mergeSource, setMergeSource] = useState<CompanyIndustry | null>(null)
	// What was typed into the target box, and the trade it settled on. They are
	// separate so half-typed text cannot be mistaken for a choice.
	const [mergeQuery, setMergeQuery] = useState('')
	const [mergeTargetId, setMergeTargetId] = useState<string>('')

	const industries: ReadonlyArray<CompanyIndustry> = AsyncResult.isSuccess(
		listResult,
	)
		? listResult.value
		: []
	const needsReview = industries.filter(i => i.needsReview)

	const startRename = (industry: CompanyIndustry) => {
		setEditingId(industry.id)
		setDraft(industry.label)
	}

	const submitRename = async (industry: CompanyIndustry) => {
		const label = draft.trim()
		if (label.length === 0 || label === industry.label) {
			setEditingId(null)
			return
		}
		setBusyId(industry.id)
		const exit = await renameIndustry({
			params: { id: industry.id },
			payload: { label },
		})
		setBusyId(null)
		if (exit._tag === 'Success') {
			setEditingId(null)
			refresh()
			return
		}
		toast.add({
			title: t`Could not rename ${industry.label}`,
			description: t`Another industry may already go by that name — merge them instead.`,
			type: 'error',
		})
	}

	const accept = async (industry: CompanyIndustry) => {
		setBusyId(industry.id)
		const exit = await reviewIndustry({ params: { id: industry.id } })
		setBusyId(null)
		if (exit._tag === 'Success') {
			refresh()
			return
		}
		toast.add({ title: t`Could not accept ${industry.label}`, type: 'error' })
	}

	const confirmMerge = async () => {
		const from = mergeSource
		if (from === null || mergeTargetId === '') return
		setBusyId(from.id)
		const exit = await mergeIndustry({
			params: { id: from.id },
			payload: { intoId: mergeTargetId },
		})
		setBusyId(null)
		setMergeSource(null)
		setMergeTargetId('')
		setMergeQuery('')
		if (exit._tag === 'Success') {
			refresh()
			toast.add({ title: t`Merged ${from.label}`, type: 'success' })
			return
		}
		toast.add({ title: t`Could not merge ${from.label}`, type: 'error' })
	}

	const remove = async (industry: CompanyIndustry) => {
		setBusyId(industry.id)
		const exit = await deleteIndustry({ params: { id: industry.id } })
		setBusyId(null)
		if (exit._tag === 'Success') {
			refresh()
			return
		}
		toast.add({
			title: t`Could not remove ${industry.label}`,
			description: t`It is still on at least one company — merge it instead.`,
			type: 'error',
		})
	}

	const mergeTargets = industries.filter(i => i.id !== mergeSource?.id)

	return (
		<Page>
			<BackLink to='/settings/organization'>
				<ArrowLeft size={14} aria-hidden />
				<Trans>Organization</Trans>
			</BackLink>

			<Intro>
				<Heading>
					<Trans>Industries</Trans>
				</Heading>
				<Subtitle>
					<Trans>
						The trades your companies are in. Each one is written the first time
						somebody uses it, however they spell it — this is where the list
						gets tidied.
					</Trans>
				</Subtitle>
			</Intro>

			{AsyncResult.isFailure(listResult) ? (
				<ErrorState
					title={t`Could not load the industries`}
					onRetry={refresh}
				/>
			) : AsyncResult.isInitial(listResult) ? (
				<Subtitle>
					<Trans>Loading…</Trans>
				</Subtitle>
			) : industries.length === 0 ? (
				<Card>
					<Subtitle>
						<Trans>
							No industries yet. One appears here as soon as a company is given
							a trade.
						</Trans>
					</Subtitle>
				</Card>
			) : (
				<Card data-testid='industries-list'>
					{needsReview.length > 0 ? (
						<ReviewNote data-testid='industries-review-note'>
							<Trans>
								{needsReview.length} came from research and nobody has read them
								yet.
							</Trans>
						</ReviewNote>
					) : null}
					<Rows>
						{industries.map(industry => (
							<Row
								key={industry.id}
								data-testid={`industry-row-${industry.slug}`}
								$flagged={industry.needsReview}
							>
								<Names>
									{editingId === industry.id ? (
										<PriInput
											autoFocus
											value={draft}
											onChange={e => setDraft(e.target.value)}
											onKeyDown={e => {
												if (e.key === 'Enter') {
													e.preventDefault()
													void submitRename(industry)
												}
												if (e.key === 'Escape') setEditingId(null)
											}}
											disabled={busyId === industry.id}
											aria-label={t`Rename ${industry.label}`}
											data-testid='industry-rename-input'
										/>
									) : (
										<NameButton
											type='button'
											onClick={() => startRename(industry)}
											aria-label={t`Rename ${industry.label}`}
										>
											{industry.label}
										</NameButton>
									)}
									<Usage>
										{industry.companyCount === 1 ? (
											<Trans>1 company</Trans>
										) : (
											<Trans>{industry.companyCount} companies</Trans>
										)}
									</Usage>
								</Names>

								<Actions>
									{editingId === industry.id ? (
										<PriButton
											type='button'
											$variant='filled'
											disabled={busyId === industry.id}
											onClick={() => void submitRename(industry)}
											data-testid='industry-rename-save'
										>
											<Trans>Save</Trans>
										</PriButton>
									) : (
										<>
											{industry.needsReview ? (
												<PriButton
													type='button'
													$variant='outlined'
													disabled={busyId === industry.id}
													onClick={() => void accept(industry)}
													data-testid='industry-accept'
												>
													<Check size={14} aria-hidden />
													<Trans>Accept</Trans>
												</PriButton>
											) : null}
											<PriButton
												type='button'
												$variant='text'
												disabled={
													busyId === industry.id || industries.length < 2
												}
												onClick={() => {
													setMergeSource(industry)
													setMergeTargetId('')
													setMergeQuery('')
												}}
												aria-label={t`Merge ${industry.label} into another`}
												data-testid='industry-merge'
											>
												<Merge size={14} aria-hidden />
											</PriButton>
											{industry.companyCount === 0 ? (
												<PriButton
													type='button'
													$variant='destructive'
													disabled={busyId === industry.id}
													onClick={() => void remove(industry)}
													aria-label={t`Remove ${industry.label}`}
													data-testid='industry-remove'
												>
													<Trash2 size={14} aria-hidden />
												</PriButton>
											) : null}
										</>
									)}
								</Actions>
							</Row>
						))}
					</Rows>
				</Card>
			)}

			<PriDialog.Root
				open={mergeSource !== null}
				onOpenChange={open => {
					if (open) return
					setMergeSource(null)
					setMergeTargetId('')
					setMergeQuery('')
				}}
			>
				<PriDialog.Portal>
					<PriDialog.Backdrop />
					<PriDialog.Popup data-testid='industry-merge-dialog'>
						<PriDialog.Title>
							<Trans>Merge {mergeSource?.label ?? ''}</Trans>
						</PriDialog.Title>
						<PriDialog.Description>
							<Trans>
								Every company on it moves to the industry you pick, and this one
								goes.
							</Trans>
						</PriDialog.Description>
						{/* Typed rather than picked from a list: an organisation that has
						    been running a while has more trades than fit on a screen, and
						    scrolling to one is slower than naming it. */}
						<PriCombobox.Root
							items={mergeTargets.map(i => i.label)}
							value={mergeQuery}
							onValueChange={next => {
								setMergeQuery(next)
								// Only a name that is actually one of the trades counts as a
								// choice, whether it was clicked or typed out in full; half a
								// name leaves Merge out of reach.
								setMergeTargetId(
									mergeTargets.find(
										i => i.label.toLowerCase() === next.trim().toLowerCase(),
									)?.id ?? '',
								)
							}}
						>
							<PriCombobox.Input
								placeholder={t`Pick an industry`}
								aria-label={t`Pick an industry`}
								data-testid='industry-merge-target'
							/>
							<PriCombobox.Portal>
								<PriCombobox.Positioner sideOffset={6}>
									<PriCombobox.Popup>
										<PriCombobox.Empty />
										<PriCombobox.List>
											{(label: string) => (
												<PriCombobox.Item key={label} value={label}>
													{label}
												</PriCombobox.Item>
											)}
										</PriCombobox.List>
									</PriCombobox.Popup>
								</PriCombobox.Positioner>
							</PriCombobox.Portal>
						</PriCombobox.Root>
						<DialogActions>
							<PriButton
								type='button'
								$variant='text'
								onClick={() => setMergeSource(null)}
							>
								<Trans>Cancel</Trans>
							</PriButton>
							<PriButton
								type='button'
								$variant='filled'
								disabled={mergeTargetId === ''}
								onClick={() => void confirmMerge()}
								data-testid='industry-merge-confirm'
							>
								<Trans>Merge</Trans>
							</PriButton>
						</DialogActions>
					</PriDialog.Popup>
				</PriDialog.Portal>
			</PriDialog.Root>
		</Page>
	)
}

const Page = styled.div.withConfig({ displayName: 'IndustriesPage' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`

const BackLink = styled(Link).withConfig({ displayName: 'IndustriesBackLink' })`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	align-self: flex-start;
	font-family: var(--font-display);
	font-size: var(--typescale-label-medium-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
	text-decoration: none;

	&:hover {
		color: var(--color-on-surface);
	}
`

const Intro = styled.div.withConfig({ displayName: 'IndustriesIntro' })`
	${rulerUnderRule}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-bottom: var(--space-xs);
`

const Heading = styled.h2.withConfig({ displayName: 'IndustriesHeading' })`
	${stenciledTitle}
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
	margin: 0;
`

const Subtitle = styled.p.withConfig({ displayName: 'IndustriesSubtitle' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Card = styled.div.withConfig({ displayName: 'IndustriesCard' })`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md);
`

const ReviewNote = styled.p.withConfig({ displayName: 'IndustriesReviewNote' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Rows = styled.div.withConfig({ displayName: 'IndustriesRows' })`
	display: flex;
	flex-direction: column;
`

const Row = styled.div.withConfig({
	displayName: 'IndustriesRow',
	shouldForwardProp: prop => prop !== '$flagged',
})<{ $flagged: boolean }>`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	padding: var(--space-sm) var(--space-2xs);
	border-bottom: 1px solid
		color-mix(in srgb, var(--color-on-surface) 12%, transparent);
	border-left: 3px solid
		${p => (p.$flagged ? 'var(--color-highlight-amber)' : 'transparent')};

	&:last-child {
		border-bottom: none;
	}
`

const Names = styled.div.withConfig({ displayName: 'IndustriesNames' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	min-width: 0;
	flex: 1;
`

const NameButton = styled.button.withConfig({
	displayName: 'IndustriesNameButton',
})`
	align-self: flex-start;
	background: transparent;
	border: 1px dashed transparent;
	border-radius: var(--shape-2xs);
	padding: var(--space-3xs) var(--space-2xs);
	margin: calc(var(--space-3xs) * -1) calc(var(--space-2xs) * -1);
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	color: var(--color-on-surface);
	text-align: left;
	cursor: text;

	&:hover,
	&:focus-visible {
		border-color: color-mix(in srgb, var(--color-on-surface) 25%, transparent);
		outline: none;
	}
`

const Usage = styled.span.withConfig({ displayName: 'IndustriesUsage' })`
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
`

const Actions = styled.div.withConfig({ displayName: 'IndustriesActions' })`
	display: flex;
	align-items: center;
	gap: var(--space-2xs);
	flex-shrink: 0;
`

const DialogActions = styled.div.withConfig({
	displayName: 'IndustriesDialogActions',
})`
	display: flex;
	justify-content: flex-end;
	gap: var(--space-2xs);
	margin-top: var(--space-md);
`
