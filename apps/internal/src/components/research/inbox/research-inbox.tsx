import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import type { MessageDescriptor } from '@lingui/core'
import { Trans, useLingui } from '@lingui/react/macro'
import { Link, useNavigate } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import { ArrowRight, Microscope, Search } from 'lucide-react'
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import styled from 'styled-components'

import { isAttentionResearchStatus } from '@batuda/domain'
import { PriButton, PriInput, usePriToast } from '@batuda/ui/pri'

import {
	type PendingProposal,
	pendingProposalsAtom,
	researchListAtom,
	resolveProposalsBatchAtom,
} from '#/atoms/research-atoms'
import {
	fieldChanges,
	humanizeFieldKey,
	proposedChannels,
} from '#/components/research/field-diff'
import { PaidActionQueue } from '#/components/research/inbox/paid-action-queue'
import {
	isEnteredOutcome,
	type ProposalOutcome,
	trustTier,
	verdictRank,
} from '#/components/research/proposal-logic'
import { OutcomeBadge } from '#/components/research/proposal-outcome'
import { ResearchDialog } from '#/components/research/research-dialog'
import { Money, ResolveStatus } from '#/components/research/resolve-status'
import {
	fieldLabel,
	operationLabel,
	statusLabel,
	subjectTableLabel,
} from '#/components/research/run-labels'
import { narrowResearch } from '#/components/research/run-shapes'
import { TrustBadge } from '#/components/research/trust-badge'
import { ErrorState } from '#/components/shared/error-state'
import { SrOnly } from '#/components/shared/sr-only'
import {
	type ResolveDecision,
	type ResolveOutcome,
	useProposalResolution,
} from '#/hooks/use-proposal-resolution'
import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import { dlgNoId } from '#/lib/dlg-search'
import { formatMoneyCents } from '#/lib/format-money'
import { useDlg } from '#/lib/use-dlg'
import {
	agedPaperSurface,
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

/** Page size for the cross-run proposal query — matches the loader's fetch. */
export const INBOX_PROPOSAL_LIMIT = 100

/** The single atom the inbox reads (and the loader hydrates) for its queue. */
export function inboxPendingProposalsAtom() {
	return pendingProposalsAtom({ limit: INBOX_PROPOSAL_LIMIT })
}

function rowKey(p: PendingProposal): string {
	return `${p.researchId}::${p.proposedUpdateId ?? ''}`
}

function tierOf(p: PendingProposal) {
	return trustTier({
		verification: p.verification,
		confidence: p.confidence,
		machineCheckable: p.machineCheckable,
	})
}

// Whether the "Find companies" dialog is open lives in the `?dlg=discovery`
// URL param — like the other dialogs in the app — so it is deep-linkable and
// the back button closes it. The route validates this schema; a value outside
// it decodes to nothing and the dialog stays closed.
export const researchDlgSchema = dlgNoId('discovery')

// Boolean adapter over the shared `?dlg=` helper: this route owns a single,
// id-less dialog, so its open/closed state collapses to a boolean.
function useResearchDlg(): readonly [boolean, (next: boolean) => void] {
	const { dlg, open, close } = useDlg(researchDlgSchema)
	const setOpen = useCallback(
		(next: boolean) => {
			if (next) {
				open({ kind: 'discovery' })
			} else {
				close()
			}
		},
		[open, close],
	)
	return [dlg !== undefined, setOpen]
}

export function ResearchInbox() {
	const { t, i18n } = useLingui()
	const toast = usePriToast()
	const navigate = useNavigate()
	const [discoveryOpen, setDiscoveryOpen] = useResearchDlg()

	const [search, setSearch] = useState('')
	const [minConfidence, setMinConfidence] = useState(0)
	const [machineOnly, setMachineOnly] = useState(false)

	// Filtering happens where the rows live. Sifting a fetched page in the browser
	// only ever searched the newest hundred, so a matching change beyond that was
	// invisible and the queue could read as empty while work was waiting.
	const proposalsAtom = useMemo(
		() =>
			pendingProposalsAtom({
				limit: INBOX_PROPOSAL_LIMIT,
				...(minConfidence > 0 ? { minConfidence } : {}),
				...(machineOnly ? { machineCheckable: true } : {}),
			}),
		[minConfidence, machineOnly],
	)
	const proposalsResult = useAtomValue(proposalsAtom)
	const refreshProposals = useAtomRefresh(proposalsAtom)
	const runsAtom = useMemo(
		() => researchListAtom({ limit: INBOX_PROPOSAL_LIMIT }),
		[],
	)
	const runsResult = useAtomValue(runsAtom)
	const spendAtom = useMemo(
		() =>
			BatudaApiAtom.query('research', 'spend', {
				query: { range: 'month', groupBy: 'provider' },
			}),
		[],
	)
	const spendResult = useAtomValue(spendAtom)

	const resolveBatch = useAtomSet(resolveProposalsBatchAtom, {
		mode: 'promiseExit',
	})
	const { results, pending, sending, resolve, undo, setResults } =
		useProposalResolution()

	// Whether the "apply all verified" button is waiting on its confirm step.
	const [confirmingBatch, setConfirmingBatch] = useState(false)
	const [batchBusy, setBatchBusy] = useState(false)
	// What the last bulk apply did, said out loud. Writing several records at once
	// finished in silence: the rows quietly turned into badges, which tells a
	// reader watching the screen but nobody listening to it.
	const [batchOutcome, setBatchOutcome] = useState<string | null>(null)

	const proposals = useMemo<ReadonlyArray<PendingProposal>>(
		() =>
			AsyncResult.isSuccess(proposalsResult)
				? [...proposalsResult.value.items]
				: [],
		[proposalsResult],
	)
	const runs = useMemo(
		() =>
			AsyncResult.isSuccess(runsResult)
				? narrowResearch(runsResult.value.items)
				: [],
		[runsResult],
	)
	const paidSpendCents = useMemo(
		() =>
			AsyncResult.isSuccess(spendResult) ? sumSpend(spendResult.value) : 0,
		[spendResult],
	)

	// Subject, confidence and verifiable-only are applied where the rows live, so
	// only the free-text search narrows what has been fetched — there is no
	// server-side search to defer it to.
	const visible = useMemo(() => {
		const term = search.trim().toLowerCase()
		if (term.length === 0) return proposals
		return proposals.filter(p => {
			const haystack =
				`${p.subjectName ?? ''} ${p.runQuery} ${p.reason ?? ''}`.toLowerCase()
			return haystack.includes(term)
		})
	}, [proposals, search])

	const trustworthy = useMemo(
		() => visible.filter(p => tierOf(p) === 'trustworthy'),
		[visible],
	)
	const needsReview = useMemo(
		() =>
			visible
				.filter(p => tierOf(p) === 'needs_review')
				.sort((a, b) => {
					const rank = verdictRank(a.verification) - verdictRank(b.verification)
					if (rank !== 0) return rank
					return (b.confidence ?? 0) - (a.confidence ?? 0)
				}),
		[visible],
	)
	const attention = useMemo(
		() => runs.filter(r => isAttentionResearchStatus(r.status)),
		[runs],
	)

	// A change that came back as a conflict or as invalid is still waiting for
	// someone, so counting every reply as dealt with made the queue look shorter
	// than it is.
	const resolvedCount = Object.values(results).filter(
		r =>
			isEnteredOutcome(r.outcome as ProposalOutcome) ||
			r.outcome === 'rejected',
	).length
	// The count comes back with the rows, so the tile states the real figure
	// instead of "100+" whenever a page happened to fill up.
	const totalPending = AsyncResult.isSuccess(proposalsResult)
		? proposalsResult.value.total
		: proposals.length
	const pendingCount = Math.max(0, totalPending - resolvedCount)
	// More are waiting than were fetched, so say so rather than quietly ending.
	const notShown = Math.max(0, totalPending - proposals.length)
	const recentRuns = runs.length

	const isLoading = AsyncResult.isInitial(proposalsResult)
	const isFailure = AsyncResult.isFailure(proposalsResult)

	// Read out what the queue currently holds. A sighted reader watches the list
	// change when they search or filter; a listener got silence, with no way to
	// tell "nothing matches" from "still loading". The region is always on the
	// page so a change to its wording is announced — one added at the same moment
	// as its text is not.
	const liveSummary = isLoading
		? t`Loading the changes waiting for review.`
		: isFailure
			? t`The list of changes could not be loaded.`
			: (batchOutcome ??
				t`${trustworthy.length} ready to apply, ${needsReview.length} need reading, ${attention.length} runs need attention.`)

	function resolveOne(p: PendingProposal, decision: ResolveDecision): void {
		if (p.proposedUpdateId === null) return
		resolve(rowKey(p), p.researchId, p.proposedUpdateId, decision, () =>
			toast.add({ title: t`Could not resolve this proposal.`, type: 'error' }),
		)
	}

	async function applyAllVerified(): Promise<void> {
		setConfirmingBatch(false)
		const items = trustworthy
			.filter(
				p =>
					p.proposedUpdateId !== null &&
					results[rowKey(p)] === undefined &&
					pending[rowKey(p)] === undefined &&
					sending[rowKey(p)] === undefined,
			)
			.map(p => ({
				research_id: p.researchId,
				proposed_update_id: p.proposedUpdateId as string,
				decision: 'apply' as const,
			}))
		if (items.length === 0) return
		setBatchBusy(true)
		setBatchOutcome(t`Applying ${items.length} changes…`)
		const exit = await resolveBatch({ payload: { items } })
		setBatchBusy(false)
		if (exit._tag === 'Success') {
			setResults(prev => {
				const next = { ...prev }
				for (const r of exit.value.results) {
					next[`${r.research_id}::${r.proposed_update_id}`] = {
						outcome: r.outcome,
						reason: r.reason ?? null,
					}
				}
				return next
			})
			// Say how it actually went. Some of a batch can come back as a clash or
			// as unusable, and those are still waiting for someone.
			const entered = exit.value.results.filter(r =>
				isEnteredOutcome(r.outcome as ProposalOutcome),
			).length
			const leftover = exit.value.results.length - entered
			setBatchOutcome(
				leftover === 0
					? t`${entered} changes entered the records.`
					: t`${entered} entered the records, ${leftover} still need you.`,
			)
		} else {
			toast.add({ title: t`Could not apply the batch.`, type: 'error' })
			setBatchOutcome(t`The changes could not be applied.`)
		}
	}

	// A row already resolved, or held inside its undo window, is no longer part
	// of the batch — count and gather only the still-actionable ones.
	const verifiedToApply = trustworthy.filter(
		p =>
			p.proposedUpdateId !== null &&
			results[rowKey(p)] === undefined &&
			pending[rowKey(p)] === undefined &&
			sending[rowKey(p)] === undefined,
	).length

	return (
		<Page>
			<IntroRow>
				<Intro>
					<Heading>
						<Microscope size={20} aria-hidden />
						<Trans>Research</Trans>
					</Heading>
					<Subtitle>
						<Trans>
							Review what the research agent found and decide what enters the
							CRM.
						</Trans>
					</Subtitle>
				</Intro>
				<IntroActions>
					<PriButton
						type='button'
						$variant='filled'
						data-testid='discovery-open'
						onClick={() => setDiscoveryOpen(true)}
					>
						<Search size={16} aria-hidden />
						<Trans>Find companies</Trans>
					</PriButton>
					<RunsLink to='/research/runs' data-testid='inbox-runs-link'>
						<Trans>All runs</Trans>
						<ArrowRight size={14} aria-hidden />
					</RunsLink>
				</IntroActions>
			</IntroRow>

			<SrOnly role='status' data-testid='research-inbox-live'>
				{liveSummary}
			</SrOnly>

			<Counters data-testid='research-inbox-counters'>
				<Tile>
					<TileValue>
						{recentRuns >= INBOX_PROPOSAL_LIMIT ? '100+' : recentRuns}
					</TileValue>
					<TileLabel>
						<Trans>Recent runs</Trans>
					</TileLabel>
				</Tile>
				<Tile>
					<TileValue>{pendingCount}</TileValue>
					<TileLabel>
						<Trans>Pending review</Trans>
					</TileLabel>
				</Tile>
				<Tile>
					<TileValue>{attention.length}</TileValue>
					<TileLabel>
						<Trans>Attention needed</Trans>
					</TileLabel>
				</Tile>
				<Tile>
					<TileValue>
						{formatMoneyCents(paidSpendCents, { locale: i18n.locale })}
					</TileValue>
					<TileLabel>
						<Trans>Paid spend this month</Trans>
					</TileLabel>
				</Tile>
			</Counters>

			<Toolbar>
				<Filters>
					<PriInput
						type='search'
						value={search}
						placeholder={t`Search name or query`}
						aria-label={t`Search the review queue`}
						data-testid='research-inbox-search'
						onChange={e => setSearch(e.target.value)}
					/>
					<FilterSelect
						value={String(minConfidence)}
						aria-label={t`Minimum confidence`}
						data-testid='research-inbox-min-confidence'
						onChange={e => setMinConfidence(Number(e.target.value))}
					>
						<option value='0'>{t`Any confidence`}</option>
						<option value='50'>{t`50%+`}</option>
						<option value='70'>{t`70%+`}</option>
						<option value='90'>{t`90%+`}</option>
					</FilterSelect>
					<ToggleLabel>
						<input
							type='checkbox'
							checked={machineOnly}
							data-testid='research-inbox-machine-only'
							onChange={e => setMachineOnly(e.target.checked)}
						/>
						<Trans>Verifiable only</Trans>
					</ToggleLabel>
				</Filters>
				{confirmingBatch ? (
					<ConfirmBatch>
						<PriButton
							type='button'
							$variant='filled'
							disabled={batchBusy}
							onClick={() => void applyAllVerified()}
							data-testid='research-inbox-apply-all-confirm'
						>
							{batchBusy ? t`Applying…` : t`Confirm apply ${verifiedToApply}`}
						</PriButton>
						<RefreshLink
							type='button'
							onClick={() => setConfirmingBatch(false)}
						>
							<Trans>Cancel</Trans>
						</RefreshLink>
					</ConfirmBatch>
				) : (
					<PriButton
						type='button'
						$variant='filled'
						disabled={verifiedToApply === 0 || batchBusy}
						onClick={() => setConfirmingBatch(true)}
						data-testid='research-inbox-apply-all'
					>
						{t`Apply all verified (${verifiedToApply})`}
					</PriButton>
				)}
				<RefreshLink
					type='button'
					onClick={() => {
						setResults({})
						// Last batch's news is stale once the queue is re-read, so the
						// spoken summary goes back to describing what is waiting.
						setBatchOutcome(null)
						refreshProposals()
					}}
				>
					<Trans>Refresh</Trans>
				</RefreshLink>
			</Toolbar>

			{isLoading ? (
				<SkeletonList role='status' aria-label={t`Loading the review queue`}>
					{[0, 1, 2, 3].map(i => (
						<SkeletonRow key={i} />
					))}
				</SkeletonList>
			) : isFailure ? (
				<ErrorState
					variant='inline'
					data-testid='research-inbox-error'
					title={t`Could not load the review queue.`}
					onRetry={refreshProposals}
				/>
			) : (
				<>
					{attention.length > 0 ? (
						<Section data-testid='research-inbox-attention'>
							<SectionTitle>
								<Trans>Attention needed</Trans>
							</SectionTitle>
							<Rows>
								{attention.map(run => {
									// Each status says its own name. Treating everything that is
									// not "no reliable data" as a failure reported a run that
									// succeeded but wants a second look as broken.
									const label = statusLabel(run.status)
									return (
										<AttentionRow key={run.id}>
											<RowMain>
												<RowQuery>{run.query}</RowQuery>
												<RowMeta>{label ? i18n._(label) : run.status}</RowMeta>
											</RowMain>
											<OpenRunLink
												id={run.id}
												label={t`Open run: ${run.query}`}
											>
												<Trans>Open</Trans>
												<ArrowRight size={14} aria-hidden />
											</OpenRunLink>
										</AttentionRow>
									)
								})}
							</Rows>
						</Section>
					) : null}

					<PaidActionQueue />

					<ProposalSection
						testId='research-inbox-trustworthy'
						title={t`Ready to apply`}
						hint={t`Verified emails and grounded values — safe to apply in one click.`}
						proposals={trustworthy}
						results={results}
						pending={pending}
						sending={sending}
						batchBusy={batchBusy}
						onResolve={resolveOne}
						onUndo={undo}
					/>

					<ProposalSection
						testId='research-inbox-needs-review'
						title={t`Needs your review`}
						hint={t`Free-text, low-confidence or unverified — read before applying.`}
						proposals={needsReview}
						results={results}
						pending={pending}
						sending={sending}
						batchBusy={batchBusy}
						onResolve={resolveOne}
						onUndo={undo}
					/>

					{notShown > 0 ? (
						<Truncated data-testid='research-inbox-truncated'>
							{t`Showing ${proposals.length} of ${totalPending}. Narrow the filters to reach the rest.`}
						</Truncated>
					) : null}

					{trustworthy.length === 0 &&
					needsReview.length === 0 &&
					attention.length === 0 ? (
						<Empty data-testid='research-inbox-empty'>
							<Trans>Nothing to review right now.</Trans>
						</Empty>
					) : null}
				</>
			)}

			<ResearchDialog
				open={discoveryOpen}
				onOpenChange={setDiscoveryOpen}
				onCreated={id => {
					void navigate({ to: '/research/$id', params: { id } })
				}}
			/>
		</Page>
	)
}

function ProposalSection({
	testId,
	title,
	hint,
	proposals,
	results,
	pending,
	sending,
	batchBusy,
	onResolve,
	onUndo,
}: {
	readonly testId: string
	readonly title: string
	readonly hint: string
	readonly proposals: ReadonlyArray<PendingProposal>
	readonly results: Record<string, ResolveOutcome>
	readonly pending: Record<string, ResolveDecision>
	readonly sending: Record<string, ResolveDecision>
	/** A bulk apply is in flight, so single rows must not be resolved alongside it. */
	readonly batchBusy: boolean
	readonly onResolve: (p: PendingProposal, decision: ResolveDecision) => void
	readonly onUndo: (key: string) => void
}) {
	if (proposals.length === 0) return null
	return (
		<Section data-testid={testId}>
			<SectionTitle>{title}</SectionTitle>
			<SectionHint>{hint}</SectionHint>
			<Rows>
				{proposals.map((p, index) => (
					<ProposalRow
						// A proposal recorded before these carried their own id has none,
						// and two such from the same run cannot be told apart, so position
						// is the only thing left to separate them.
						// biome-ignore lint/suspicious/noArrayIndexKey: the index only breaks ties behind a real key; without it two id-less proposals from one run collide and React drops a row.
						key={`${rowKey(p)}#${index}`}
						proposal={p}
						result={results[rowKey(p)]}
						pending={pending[rowKey(p)]}
						sending={sending[rowKey(p)]}
						batchBusy={batchBusy}
						onResolve={onResolve}
						onUndo={() => onUndo(rowKey(p))}
					/>
				))}
			</Rows>
		</Section>
	)
}

function ProposalRow({
	proposal,
	result,
	pending,
	sending,
	batchBusy,
	onResolve,
	onUndo,
}: {
	readonly proposal: PendingProposal
	readonly result: ResolveOutcome | undefined
	readonly pending: ResolveDecision | undefined
	readonly sending: ResolveDecision | undefined
	readonly batchBusy: boolean
	readonly onResolve: (p: PendingProposal, decision: ResolveDecision) => void
	readonly onUndo: () => void
}) {
	const { t, i18n } = useLingui()
	// Prefer the subject's real name; fall back to a localized "Company · 1a2b3c"
	// tag, then to the run's query when the proposal has no subject yet.
	const tableLabel =
		proposal.subjectTable !== null
			? subjectTableLabel(proposal.subjectTable)
			: null
	const subjectLabel =
		proposal.subjectName ??
		(proposal.subjectTable !== null
			? proposal.subjectId !== null
				? `${tableLabel ? i18n._(tableLabel) : proposal.subjectTable} · ${proposal.subjectId.slice(0, 8)}`
				: tableLabel
					? i18n._(tableLabel)
					: proposal.subjectTable
			: proposal.runQuery)
	const opLabel = operationLabel(proposal.operation)
	// Cheap work and paid lookups are tallied separately, so a run whose whole
	// cost was a paid lookup reads as free unless both are counted.
	const runTotalCents = proposal.runCostCents + proposal.runPaidCostCents

	return (
		<Row data-testid='research-inbox-row'>
			<RowMain>
				<RowHead>
					<Operation>
						{opLabel ? i18n._(opLabel) : proposal.operation}
					</Operation>
					<RowQuery>{subjectLabel}</RowQuery>
				</RowHead>
				{proposal.reason !== null ? (
					<RowReason>{proposal.reason}</RowReason>
				) : null}
				<ProposedValues proposal={proposal} />
				<RowBadges>
					<TrustBadge
						verification={proposal.verification}
						confidence={proposal.confidence}
						machineCheckable={proposal.machineCheckable}
					/>
					{runTotalCents > 0 ? (
						<Money
							data-testid='research-inbox-row-cost'
							title={t`What this run has cost so far`}
						>
							{formatMoneyCents(runTotalCents, { locale: i18n.locale })}
						</Money>
					) : null}
					<OpenRunLink
						id={proposal.researchId}
						label={t`Open run for ${subjectLabel}`}
					>
						<Trans>Open run</Trans>
						<ArrowRight size={14} aria-hidden />
					</OpenRunLink>
				</RowBadges>
			</RowMain>
			<RowActions>
				{result !== undefined ? (
					<OutcomeBadge
						outcome={result.outcome as ProposalOutcome}
						reason={result.reason}
					/>
				) : pending !== undefined ? (
					<ResolveStatus
						decision={pending}
						undoable
						onUndo={onUndo}
						testId='research-inbox-pending'
					/>
				) : sending !== undefined ? (
					<ResolveStatus
						decision={sending}
						undoable={false}
						onUndo={onUndo}
						testId='research-inbox-sending'
					/>
				) : (
					<>
						<PriButton
							type='button'
							$variant='filled'
							aria-label={t`Apply ${subjectLabel}`}
							disabled={proposal.proposedUpdateId === null || batchBusy}
							onClick={() => onResolve(proposal, 'apply')}
							data-testid='research-inbox-apply'
						>
							{t`Apply`}
						</PriButton>
						<PriButton
							type='button'
							$variant='outlined'
							aria-label={t`Reject ${subjectLabel}`}
							disabled={proposal.proposedUpdateId === null || batchBusy}
							onClick={() => onResolve(proposal, 'reject')}
							data-testid='research-inbox-reject'
						>
							{t`Reject`}
						</PriButton>
					</>
				)}
			</RowActions>
		</Row>
	)
}

/**
 * A field's proper name when it has one, otherwise its wire spelling read as
 * words — so a field nobody has named yet still reads sensibly instead of
 * showing the name the database uses.
 */
function fieldName(key: string, i18n: { _: (d: MessageDescriptor) => string }) {
	const label = fieldLabel(key)
	return label === null ? humanizeFieldKey(key) : i18n._(label)
}

// How many values a row shows before it stops; the rest are on the run's page.
const INLINE_FIELD_LIMIT = 4

/**
 * What this change would actually write. Without it the row asks for a yes or a
 * no on a value the reader cannot see — the reason line says why the run
 * believes something, never what it would put in the record.
 */
function ProposedValues({ proposal }: { readonly proposal: PendingProposal }) {
	const { t, i18n } = useLingui()
	const changes = fieldChanges(proposal.fields, proposal.subjectCurrent)
	const channels = proposedChannels(proposal.fields)
	if (changes.length === 0 && channels.length === 0) return null
	const shown = changes.slice(0, INLINE_FIELD_LIMIT)
	const hidden = changes.length - shown.length

	return (
		<Values data-testid='research-inbox-values'>
			{channels.map(channel => (
				<ValueLine key={`${channel.kind}:${channel.value}`}>
					<ValueKey>{fieldName(channel.kind, i18n)}</ValueKey>
					<ValueNew>{channel.value}</ValueNew>
				</ValueLine>
			))}
			{shown.map(change => (
				<ValueLine key={change.key}>
					<ValueKey>{fieldName(change.key, i18n)}</ValueKey>
					{change.unchanged ? (
						<ValueSame>{t`already ${change.to}`}</ValueSame>
					) : (
						<>
							{/* The line through the old value and the arrow are both
							    visual only, so which value is which is spoken outright —
							    otherwise the row reads as two values in a row with nothing
							    to say one replaces the other. */}
							{change.from !== null ? (
								<>
									<SrOnly>{t`currently`}</SrOnly>
									<ValueOld>{change.from}</ValueOld>
									<ValueArrow aria-hidden>→</ValueArrow>
									<SrOnly>{t`would become`}</SrOnly>
								</>
							) : (
								<SrOnly>{t`nothing on file, would add`}</SrOnly>
							)}
							<ValueNew>{change.to}</ValueNew>
						</>
					)}
				</ValueLine>
			))}
			{hidden > 0 ? (
				<ValueMore>{t`and ${hidden} more on the run`}</ValueMore>
			) : null}
		</Values>
	)
}

function sumSpend(rows: ReadonlyArray<unknown>): number {
	let total = 0
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const amount = (row as Record<string, unknown>)['amountCents']
		if (typeof amount === 'number') total += amount
	}
	return total
}

// ── Styles ───────────────────────────────────────────────────────

const Page = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`

const IntroRow = styled.div`
	display: flex;
	align-items: flex-end;
	justify-content: space-between;
	gap: var(--space-md);
	flex-wrap: wrap;
`

const IntroActions = styled.div`
	display: flex;
	align-items: center;
	gap: var(--space-sm);
	padding-bottom: var(--space-xs);
`

const RunsLink = styled(Link)`
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-primary);
	text-decoration: none;

	&:hover {
		text-decoration: underline;
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
		border-radius: var(--shape-2xs);
	}
`

const Intro = styled.div`
	${rulerUnderRule}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-bottom: var(--space-xs);
	flex: 1 1 20rem;
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
`

const Counters = styled.div`
	display: grid;
	grid-template-columns: repeat(2, 1fr);
	gap: var(--space-sm);

	@media (min-width: 768px) {
		grid-template-columns: repeat(4, 1fr);
	}
`

const Tile = styled.div`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	padding: var(--space-md);
	border-radius: var(--shape-2xs);
`

const TileValue = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-headline-medium-size);
	line-height: var(--typescale-headline-medium-line);
	font-variant-numeric: tabular-nums;
	color: var(--color-on-surface);
`

const TileLabel = styled.span`
	${stenciledTitle}
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const Toolbar = styled.div`
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-sm);
`

const Filters = styled.div`
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-2xs);
`

const FilterSelect = styled.select`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	padding: var(--space-3xs) var(--space-2xs);
	border-radius: var(--shape-2xs);
	border: 1px solid color-mix(in oklab, var(--color-on-surface) 24%, transparent);
	background: var(--color-surface);
	color: var(--color-on-surface);

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const ToggleLabel = styled.label`
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	cursor: pointer;
`

const RefreshLink = styled.button`
	/* Small text made these under the 24px a pointer needs, and Undo is the only
	   thing that stops a change being written. */
	min-height: 1.5rem;
	min-width: 1.5rem;
	padding-inline: var(--space-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
	background: none;
	border: none;
	cursor: pointer;

	&:hover {
		color: var(--color-on-surface);
	}
`

const Section = styled.section`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
`

const SectionTitle = styled.h3`
	${stenciledTitle}
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
	margin: 0;
`

const SectionHint = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Rows = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
`

const Row = styled.div`
	${agedPaperSurface}
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-sm);
	align-items: flex-start;
	justify-content: space-between;
	padding: var(--space-sm) var(--space-md);
	border-radius: var(--shape-2xs);
`

const AttentionRow = styled(Row)``

const RowMain = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	min-width: 12rem;
	flex: 1;
`

const RowHead = styled.div`
	display: inline-flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: var(--space-2xs);
`

const Operation = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-primary);
`

const RowQuery = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
`

const RowReason = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const RowMeta = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const RowBadges = styled.div`
	display: inline-flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-sm);
`

const RowActions = styled.div`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
`

const ConfirmBatch = styled.div`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
`

// Styling `Link` directly with styled-components erases TanStack's typed
// `params` inference, so the chrome lives on a wrapper and the real Link
// stays plain — keeping `params={{ id }}` type-checked against the route.
const OpenRunChrome = styled.span`
	& > a {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3xs);
		font-family: var(--font-display);
		font-size: var(--typescale-label-small-size);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-on-surface-variant);
		text-decoration: none;
	}

	& > a:hover {
		color: var(--color-primary);
	}
`

function OpenRunLink({
	id,
	label,
	children,
}: {
	readonly id: string
	readonly label?: string
	readonly children: ReactNode
}) {
	return (
		<OpenRunChrome>
			<Link
				to='/research/$id'
				params={{ id }}
				{...(label !== undefined ? { 'aria-label': label } : {})}
			>
				{children}
			</Link>
		</OpenRunChrome>
	)
}

const Empty = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const SkeletonList = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

// A shimmering placeholder row that stands in for a queue item while the review
// list loads, so the page shows its shape instead of a bare "Loading…" line.
const SkeletonRow = styled.div`
	height: 3.5rem;
	border-radius: var(--shape-2xs);
	background: linear-gradient(
		90deg,
		color-mix(in oklab, var(--color-on-surface) 6%, transparent) 25%,
		color-mix(in oklab, var(--color-on-surface) 12%, transparent) 37%,
		color-mix(in oklab, var(--color-on-surface) 6%, transparent) 63%
	);
	background-size: 400% 100%;
	animation: shimmer 1.4s ease infinite;

	@keyframes shimmer {
		0% {
			background-position: 100% 50%;
		}
		100% {
			background-position: 0% 50%;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		animation: none;
	}
`

const Values = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const ValueLine = styled.div`
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: var(--space-3xs) var(--space-2xs);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	min-width: 0;
`

const ValueKey = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const ValueOld = styled.span`
	color: var(--color-on-surface-variant);
	text-decoration: line-through;
	word-break: break-word;
`

const ValueArrow = styled.span`
	color: var(--color-on-surface-variant);
`

const ValueNew = styled.span`
	color: var(--color-on-surface);
	word-break: break-word;
`

const ValueSame = styled.span`
	color: var(--color-on-surface-variant);
	font-style: italic;
`

const ValueMore = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
`

const Truncated = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`
