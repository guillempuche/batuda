import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { DateTime } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import { useMemo, useState } from 'react'
import styled from 'styled-components'

import { PriButton, usePriToast } from '@batuda/ui/pri'

import {
	RUN_PROPOSALS_PAGE_SIZE,
	researchDetailAtom,
	resolveProposalsBatchAtom,
	runProposedUpdatesAtom,
} from '#/atoms/research-atoms'
import {
	type DiscoveredExisting,
	DiscoveredExistingSection,
	FieldKey,
	FieldRow,
	FieldsTable,
	FieldValue,
} from '#/components/research/findings/shared'
import {
	type ProposalOutcome,
	trustTier,
} from '#/components/research/proposal-logic'
import { OutcomeBadge } from '#/components/research/proposal-outcome'
import {
	Provenance,
	type ProvenanceSource,
} from '#/components/research/provenance'
import { ResolveStatus } from '#/components/research/resolve-status'
import {
	narrowProposedUpdates,
	type ReviewProposal,
	strongestChannelTrust,
} from '#/components/research/review/proposal-narrow'
import { TrustBadge } from '#/components/research/trust-badge'
import { InfiniteListFooter } from '#/components/shared/infinite-list-footer'
import { useInfiniteList } from '#/hooks/use-infinite-list'
import {
	type ResolveDecision,
	type ResolveOutcome,
	useProposalResolution,
} from '#/hooks/use-proposal-resolution'
import { brushedMetalPlate, stenciledTitle } from '#/lib/workshop-mixins'

type RunContext = {
	readonly completedAt: string | null
	readonly sourceById: ReadonlyMap<string, ProvenanceSource>
	readonly discoveredExisting: ReadonlyArray<DiscoveredExisting>
}

export function ProposedUpdatesReview({
	researchId,
}: {
	readonly researchId: string
}) {
	const { t } = useLingui()
	const toast = usePriToast()

	const proposalList = useInfiniteList({
		resetKey: `research-review:${researchId}`,
		pageSize: RUN_PROPOSALS_PAGE_SIZE,
		atomFor: page => runProposedUpdatesAtom(researchId, page),
	})
	// Resolving one proposal changes what the server says about the others in
	// the same run, so the review starts over rather than trusting the slices
	// it read before the decision.
	const refreshProposals = proposalList.refresh
	const detailResult = useAtomValue(researchDetailAtom(researchId))

	const resolveBatch = useAtomSet(resolveProposalsBatchAtom, {
		mode: 'promiseExit',
	})
	const {
		results,
		pending: pendingResolve,
		sending: sendingResolve,
		resolve,
		undo,
		setResults,
	} = useProposalResolution({ onResolved: refreshProposals })

	const [confirmingBatch, setConfirmingBatch] = useState(false)
	const [batchBusy, setBatchBusy] = useState(false)

	const proposals = useMemo<ReadonlyArray<ReviewProposal>>(
		() => narrowProposedUpdates(proposalList.items),
		[proposalList.items],
	)
	const context = useMemo<RunContext>(
		() =>
			AsyncResult.isSuccess(detailResult)
				? narrowRunContext(detailResult.value)
				: { completedAt: null, sourceById: new Map(), discoveredExisting: [] },
		[detailResult],
	)

	// A terminal run with nothing proposed and no CRM matches still deserves a
	// clear "nothing here" line rather than a blank gap on the page — but only
	// once the first slice is back, so a slow read never says "nothing" about a
	// run whose proposals are still on their way.
	if (
		proposals.length === 0 &&
		context.discoveredExisting.length === 0 &&
		!proposalList.isLoadingFirstPage
	)
		return (
			<Section data-testid='research-review-empty'>
				<EmptyReview>
					<Trans>This run found no changes to review.</Trans>
				</EmptyReview>
			</Section>
		)

	const pending = proposals.filter(
		p =>
			p.status === 'pending' &&
			results[p.id] === undefined &&
			pendingResolve[p.id] === undefined &&
			sendingResolve[p.id] === undefined,
	)
	const verifiedPending = pending.filter(
		p => trustTier(strongestChannelTrust(p.channels)) === 'trustworthy',
	)
	// Proposals that only touch plain fields (no email/phone channel) — the
	// lowest-risk batch, since there's no deliverability to get wrong.
	const fieldOnlyPending = pending.filter(
		p => p.channels.length === 0 && p.scalarFields.length > 0,
	)

	function resolveOne(
		proposal: ReviewProposal,
		decision: ResolveDecision,
	): void {
		resolve(proposal.id, researchId, proposal.id, decision, () =>
			toast.add({ title: t`Could not resolve this proposal.`, type: 'error' }),
		)
	}

	async function runBatch(list: ReadonlyArray<ReviewProposal>): Promise<void> {
		const items = list.map(p => ({
			research_id: researchId,
			proposed_update_id: p.id,
			decision: 'apply' as const,
		}))
		if (items.length === 0) return
		setBatchBusy(true)
		const exit = await resolveBatch({ payload: { items } })
		setBatchBusy(false)
		if (exit._tag === 'Success') {
			setResults(prev => {
				const next = { ...prev }
				for (const r of exit.value.results) {
					next[r.proposed_update_id] = {
						outcome: r.outcome,
						reason: r.reason ?? null,
					}
				}
				return next
			})
			// Re-read so each applied row now carries its saved status, keeping the
			// outcome after a reload or a remount rather than only in this reply.
			refreshProposals()
		} else {
			toast.add({ title: t`Could not apply the batch.`, type: 'error' })
		}
	}

	async function applyAllVerified(): Promise<void> {
		setConfirmingBatch(false)
		await runBatch(verifiedPending)
	}

	return (
		<Section data-testid='research-review'>
			<Head>
				<SectionTitle>
					<Trans>Proposed updates</Trans>
				</SectionTitle>
				<HeadActions>
					{fieldOnlyPending.length > 0 ? (
						<PriButton
							type='button'
							$variant='outlined'
							disabled={batchBusy}
							onClick={() => void runBatch(fieldOnlyPending)}
							data-testid='research-review-apply-fields'
						>
							{t`Apply field updates (${fieldOnlyPending.length})`}
						</PriButton>
					) : null}
					{verifiedPending.length > 0 ? (
						confirmingBatch ? (
							<>
								<PriButton
									type='button'
									$variant='filled'
									disabled={batchBusy}
									onClick={() => void applyAllVerified()}
									data-testid='research-review-apply-all-confirm'
								>
									{batchBusy
										? t`Applying…`
										: t`Confirm apply ${verifiedPending.length}`}
								</PriButton>
								<RefreshButton
									type='button'
									onClick={() => setConfirmingBatch(false)}
								>
									<Trans>Cancel</Trans>
								</RefreshButton>
							</>
						) : (
							<PriButton
								type='button'
								$variant='filled'
								disabled={batchBusy}
								onClick={() => setConfirmingBatch(true)}
								data-testid='research-review-apply-all'
							>
								{t`Apply all verified (${verifiedPending.length})`}
							</PriButton>
						)
					) : null}
					<RefreshButton
						type='button'
						onClick={() => {
							setResults({})
							refreshProposals()
						}}
					>
						<Trans>Refresh</Trans>
					</RefreshButton>
				</HeadActions>
			</Head>

			<Hint>
				<Trans>
					Applying a discovered contact merges it into a matching record if one
					already exists.
				</Trans>
			</Hint>

			<DiscoveredExistingSection matches={context.discoveredExisting} />

			<List>
				{proposals.map(proposal => (
					<ProposalCard
						key={proposal.id}
						proposal={proposal}
						result={results[proposal.id]}
						pending={pendingResolve[proposal.id]}
						sending={sendingResolve[proposal.id]}
						completedAt={context.completedAt}
						sources={sourcesFor(proposal, context.sourceById)}
						onResolve={resolveOne}
						onUndo={() => undo(proposal.id)}
					/>
				))}
			</List>
			<InfiniteListFooter list={proposalList} testId='research-review' />
		</Section>
	)
}

function ProposalCard({
	proposal,
	result,
	pending,
	sending,
	completedAt,
	sources,
	onResolve,
	onUndo,
}: {
	readonly proposal: ReviewProposal
	readonly result: ResolveOutcome | undefined
	readonly pending: ResolveDecision | undefined
	readonly sending: ResolveDecision | undefined
	readonly completedAt: string | null
	readonly sources: ReadonlyArray<ProvenanceSource>
	readonly onResolve: (p: ReviewProposal, decision: ResolveDecision) => void
	readonly onUndo: () => void
}) {
	const { t } = useLingui()
	const trust = strongestChannelTrust(proposal.channels)
	const cardLabel = proposal.name ?? proposal.subjectTable ?? proposal.id

	// The outcome to show: this session's fresh reply if we have it, otherwise
	// the run's own saved status. Deriving from the stored status is what makes
	// an applied or rejected proposal keep its badge across a reload, a remount,
	// or a second reviewer — the reply alone would not survive any of those.
	const shownOutcome: ResolveOutcome | null =
		result ??
		(proposal.status === 'applied'
			? { outcome: 'applied', reason: null }
			: proposal.status === 'rejected'
				? { outcome: 'rejected', reason: null }
				: null)

	return (
		<Card data-testid='research-review-card' data-proposal-id={proposal.id}>
			<CardHead>
				<Operation>{proposal.operation}</Operation>
				<Title>{proposal.name ?? proposal.subjectTable ?? proposal.id}</Title>
				{proposal.channels.length > 0 ? (
					<TrustBadge
						verification={trust.verification}
						confidence={trust.confidence}
						machineCheckable={trust.machineCheckable}
					/>
				) : null}
			</CardHead>

			{proposal.reason !== null ? <Reason>{proposal.reason}</Reason> : null}

			{proposal.channels.length > 0 ? (
				<Channels>
					{proposal.channels.map(channel => (
						<ChannelRow key={`${channel.kind}:${channel.value}`}>
							<ChannelKind>{channel.kind}</ChannelKind>
							<ChannelValue>{channel.value}</ChannelValue>
							<TrustBadge
								verification={channel.verification}
								confidence={channel.confidence}
								machineCheckable={
									channel.kind === 'email' || channel.kind === 'phone'
								}
							/>
						</ChannelRow>
					))}
				</Channels>
			) : null}

			{proposal.scalarFields.length > 0 ? (
				<FieldsTable>
					{proposal.scalarFields.map(([key, value]) => (
						<FieldRow key={key}>
							<FieldKey>{key}</FieldKey>
							<FieldValue>{value}</FieldValue>
						</FieldRow>
					))}
				</FieldsTable>
			) : null}

			<Provenance date={completedAt} sources={sources} />

			<CardActions>
				{shownOutcome !== null ? (
					<OutcomeBadge
						outcome={shownOutcome.outcome as ProposalOutcome}
						reason={shownOutcome.reason}
					/>
				) : pending !== undefined ? (
					<ResolveStatus
						decision={pending}
						undoable
						onUndo={onUndo}
						testId='research-review-pending'
					/>
				) : sending !== undefined ? (
					<ResolveStatus
						decision={sending}
						undoable={false}
						onUndo={onUndo}
						testId='research-review-sending'
					/>
				) : (
					<>
						<PriButton
							type='button'
							$variant='filled'
							aria-label={t`Apply ${cardLabel}`}
							onClick={() => onResolve(proposal, 'apply')}
							data-testid='research-review-apply'
						>
							{t`Apply`}
						</PriButton>
						<PriButton
							type='button'
							$variant='outlined'
							aria-label={t`Reject ${cardLabel}`}
							onClick={() => onResolve(proposal, 'reject')}
							data-testid='research-review-reject'
						>
							{t`Reject`}
						</PriButton>
					</>
				)}
			</CardActions>
		</Card>
	)
}

function sourcesFor(
	proposal: ReviewProposal,
	sourceById: ReadonlyMap<string, ProvenanceSource>,
): ReadonlyArray<ProvenanceSource> {
	return proposal.citations.map(citation => {
		const resolved = sourceById.get(citation.sourceId)
		// A citation's `sourceId` is itself a URL, so it is a usable link even
		// when the run's source rows have been pruned.
		return resolved ?? { url: citation.sourceId }
	})
}

// Typed date fields decode to DateTime.Utc on the wire; fall back to their
// string form for anything already an ISO string.
function dateToIsoOrNull(value: unknown): string | null {
	if (typeof value === 'string') return value
	if (DateTime.isDateTime(value)) return DateTime.formatIso(value)
	return null
}

function narrowRunContext(raw: unknown): RunContext {
	if (!raw || typeof raw !== 'object') {
		return { completedAt: null, sourceById: new Map(), discoveredExisting: [] }
	}
	const r = raw as Record<string, unknown>
	const sourceById = new Map<string, ProvenanceSource>()
	if (Array.isArray(r['sources'])) {
		for (const item of r['sources']) {
			if (!item || typeof item !== 'object') continue
			// Each entry is the run's record of visiting a page, with the page
			// itself nested inside; the address and title a citation links to live
			// on the page, not on the visit.
			const source = (item as Record<string, unknown>)['source']
			if (!source || typeof source !== 'object') continue
			const s = source as Record<string, unknown>
			const id = typeof s['id'] === 'string' ? s['id'] : null
			const url = typeof s['url'] === 'string' ? s['url'] : null
			if (id !== null && url !== null) {
				sourceById.set(id, {
					url,
					title: typeof s['title'] === 'string' ? s['title'] : null,
				})
			}
		}
	}
	const findings =
		r['findings'] && typeof r['findings'] === 'object'
			? (r['findings'] as Record<string, unknown>)
			: {}
	return {
		completedAt: dateToIsoOrNull(r['completedAt']),
		sourceById,
		discoveredExisting: narrowDiscoveredExisting(
			findings['discovered_existing'],
		),
	}
}

function narrowDiscoveredExisting(
	raw: unknown,
): ReadonlyArray<DiscoveredExisting> {
	if (!Array.isArray(raw)) return []
	const out: Array<DiscoveredExisting> = []
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue
		const d = item as Record<string, unknown>
		if (
			typeof d['subject_table'] === 'string' &&
			typeof d['subject_id'] === 'string' &&
			typeof d['name'] === 'string'
		) {
			out.push({
				subject_table: d['subject_table'],
				subject_id: d['subject_id'],
				name: d['name'],
			})
		}
	}
	return out
}

// ── Styles ───────────────────────────────────────────────────────

const Section = styled.section`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md);
	border-radius: var(--shape-2xs);
`

const EmptyReview = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Head = styled.div`
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
`

const HeadActions = styled.div`
	display: inline-flex;
	align-items: center;
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
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const RefreshButton = styled.button`
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

const List = styled.ul`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	margin: 0;
	padding: 0;
	list-style: none;
`

const Card = styled.li`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding: var(--space-sm) var(--space-md);
	border: 1px solid color-mix(in oklab, var(--color-on-surface) 10%, transparent);
	border-radius: var(--shape-2xs);
	background: var(--color-surface);
`

const CardHead = styled.div`
	display: inline-flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-2xs);
`

const Operation = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-primary);
`

const Title = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	font-weight: var(--font-weight-bold);
	color: var(--color-on-surface);
`

const Reason = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Channels = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const ChannelRow = styled.div`
	display: inline-flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-2xs);
`

const ChannelKind = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const ChannelValue = styled.span`
	font-family: var(--font-mono);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface);
`

const CardActions = styled.div`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	margin-top: var(--space-3xs);
`
