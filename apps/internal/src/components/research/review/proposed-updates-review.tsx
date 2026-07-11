import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { AsyncResult } from 'effect/unstable/reactivity'
import { useMemo, useState } from 'react'
import styled from 'styled-components'

import { PriButton, usePriToast } from '@batuda/ui/pri'

import {
	applyProposalAtom,
	rejectProposalAtom,
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
import {
	narrowProposedUpdates,
	type ReviewProposal,
	strongestChannelTrust,
} from '#/components/research/review/proposal-narrow'
import { TrustBadge } from '#/components/research/trust-badge'
import { brushedMetalPlate, stenciledTitle } from '#/lib/workshop-mixins'

type ResolveState = {
	readonly outcome: ProposalOutcome
	readonly reason: string | null
}

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

	const proposalsResult = useAtomValue(runProposedUpdatesAtom(researchId))
	const refreshProposals = useAtomRefresh(runProposedUpdatesAtom(researchId))
	const detailResult = useAtomValue(researchDetailAtom(researchId))

	const apply = useAtomSet(applyProposalAtom, { mode: 'promiseExit' })
	const reject = useAtomSet(rejectProposalAtom, { mode: 'promiseExit' })
	const resolveBatch = useAtomSet(resolveProposalsBatchAtom, {
		mode: 'promiseExit',
	})

	const [results, setResults] = useState<Record<string, ResolveState>>({})
	const [busy, setBusy] = useState<Record<string, boolean>>({})
	const [batchBusy, setBatchBusy] = useState(false)

	const proposals = useMemo<ReadonlyArray<ReviewProposal>>(
		() =>
			AsyncResult.isSuccess(proposalsResult)
				? narrowProposedUpdates(proposalsResult.value)
				: [],
		[proposalsResult],
	)
	const context = useMemo<RunContext>(
		() =>
			AsyncResult.isSuccess(detailResult)
				? narrowRunContext(detailResult.value)
				: { completedAt: null, sourceById: new Map(), discoveredExisting: [] },
		[detailResult],
	)

	// A terminal run with nothing proposed and no CRM matches still deserves a
	// clear "nothing here" line rather than a blank gap on the page.
	if (proposals.length === 0 && context.discoveredExisting.length === 0)
		return (
			<Section data-testid='research-review-empty'>
				<EmptyReview>
					<Trans>This run found no changes to review.</Trans>
				</EmptyReview>
			</Section>
		)

	const pending = proposals.filter(
		p => p.status === 'pending' && results[p.id] === undefined,
	)
	const verifiedPending = pending.filter(
		p => trustTier(strongestChannelTrust(p.channels)) === 'trustworthy',
	)

	async function resolveOne(
		proposal: ReviewProposal,
		decision: 'apply' | 'reject',
	): Promise<void> {
		setBusy(b => ({ ...b, [proposal.id]: true }))
		const run = decision === 'apply' ? apply : reject
		const exit = await run({
			params: { id: researchId, puId: proposal.id },
		})
		setBusy(b => ({ ...b, [proposal.id]: false }))
		if (exit._tag === 'Success') {
			setResults(r => ({
				...r,
				[proposal.id]: {
					outcome: exit.value.outcome,
					reason: exit.value.reason ?? null,
				},
			}))
		} else {
			toast.add({ title: t`Could not resolve this proposal.`, type: 'error' })
		}
	}

	async function applyAllVerified(): Promise<void> {
		const items = verifiedPending.map(p => ({
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
		} else {
			toast.add({ title: t`Could not apply the batch.`, type: 'error' })
		}
	}

	return (
		<Section data-testid='research-review'>
			<Head>
				<SectionTitle>
					<Trans>Proposed updates</Trans>
				</SectionTitle>
				<HeadActions>
					{verifiedPending.length > 0 ? (
						<PriButton
							type='button'
							$variant='filled'
							disabled={batchBusy}
							onClick={() => void applyAllVerified()}
							data-testid='research-review-apply-all'
						>
							{batchBusy
								? t`Applying…`
								: t`Apply all verified (${verifiedPending.length})`}
						</PriButton>
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
						busy={busy[proposal.id] === true}
						completedAt={context.completedAt}
						sources={sourcesFor(proposal, context.sourceById)}
						onResolve={resolveOne}
					/>
				))}
			</List>
		</Section>
	)
}

function ProposalCard({
	proposal,
	result,
	busy,
	completedAt,
	sources,
	onResolve,
}: {
	readonly proposal: ReviewProposal
	readonly result: ResolveState | undefined
	readonly busy: boolean
	readonly completedAt: string | null
	readonly sources: ReadonlyArray<ProvenanceSource>
	readonly onResolve: (
		p: ReviewProposal,
		decision: 'apply' | 'reject',
	) => Promise<void>
}) {
	const { t } = useLingui()
	const trust = strongestChannelTrust(proposal.channels)
	const alreadyResolved = proposal.status !== 'pending'
	const cardLabel = proposal.name ?? proposal.subjectTable ?? proposal.id

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
				{result !== undefined ? (
					<OutcomeBadge outcome={result.outcome} reason={result.reason} />
				) : alreadyResolved ? (
					<ResolvedNote>
						{proposal.status === 'applied' ? (
							<Trans>Applied</Trans>
						) : (
							<Trans>Rejected</Trans>
						)}
					</ResolvedNote>
				) : (
					<>
						<PriButton
							type='button'
							$variant='filled'
							aria-label={t`Apply ${cardLabel}`}
							disabled={busy}
							onClick={() => void onResolve(proposal, 'apply')}
							data-testid='research-review-apply'
						>
							{busy ? t`Working…` : t`Apply`}
						</PriButton>
						<PriButton
							type='button'
							$variant='outlined'
							aria-label={t`Reject ${cardLabel}`}
							disabled={busy}
							onClick={() => void onResolve(proposal, 'reject')}
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

function narrowRunContext(raw: unknown): RunContext {
	if (!raw || typeof raw !== 'object') {
		return { completedAt: null, sourceById: new Map(), discoveredExisting: [] }
	}
	const r = raw as Record<string, unknown>
	const sourceById = new Map<string, ProvenanceSource>()
	if (Array.isArray(r['sources'])) {
		for (const item of r['sources']) {
			if (!item || typeof item !== 'object') continue
			const s = item as Record<string, unknown>
			const id =
				typeof s['id'] === 'string'
					? s['id']
					: typeof s['sourceId'] === 'string'
						? s['sourceId']
						: null
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
		completedAt: typeof r['completedAt'] === 'string' ? r['completedAt'] : null,
		sourceById,
		discoveredExisting: narrowDiscoveredExisting(
			findings['discoveredExisting'],
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
			typeof d['subjectTable'] === 'string' &&
			typeof d['subjectId'] === 'string' &&
			typeof d['name'] === 'string'
		) {
			out.push({
				subjectTable: d['subjectTable'],
				subjectId: d['subjectId'],
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
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface);
`

const CardActions = styled.div`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	margin-top: var(--space-3xs);
`

const ResolvedNote = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`
