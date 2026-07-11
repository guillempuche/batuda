import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { Link, useNavigate } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import { ArrowRight, Microscope, Search } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import styled from 'styled-components'

import { PriButton, usePriToast } from '@batuda/ui/pri'

import {
	applyProposalAtom,
	type PendingProposal,
	pendingProposalsAtom,
	rejectProposalAtom,
	researchListAtom,
	resolveProposalsBatchAtom,
} from '#/atoms/research-atoms'
import {
	type ProposalOutcome,
	trustTier,
	verdictRank,
} from '#/components/research/proposal-logic'
import { OutcomeBadge } from '#/components/research/proposal-outcome'
import { ResearchDialog } from '#/components/research/research-dialog'
import { narrowResearch } from '#/components/research/run-shapes'
import { TrustBadge } from '#/components/research/trust-badge'
import { BatudaApiAtom } from '#/lib/batuda-api-atom'
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

/** Run statuses that demand a human even without a pending proposal. */
const ATTENTION_STATUSES = new Set(['failed', 'no_reliable_data'])

type SubjectFilter = 'all' | 'companies' | 'contacts'

type ResolveState = {
	readonly outcome: ProposalOutcome
	readonly reason: string | null
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

export function ResearchInbox() {
	const { t } = useLingui()
	const toast = usePriToast()
	const navigate = useNavigate()
	const [discoveryOpen, setDiscoveryOpen] = useState(false)

	const proposalsResult = useAtomValue(inboxPendingProposalsAtom())
	const refreshProposals = useAtomRefresh(inboxPendingProposalsAtom())
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

	const apply = useAtomSet(applyProposalAtom, { mode: 'promiseExit' })
	const reject = useAtomSet(rejectProposalAtom, { mode: 'promiseExit' })
	const resolveBatch = useAtomSet(resolveProposalsBatchAtom, {
		mode: 'promiseExit',
	})

	const [subject, setSubject] = useState<SubjectFilter>('all')
	const [results, setResults] = useState<Record<string, ResolveState>>({})
	const [busy, setBusy] = useState<Record<string, boolean>>({})
	const [batchBusy, setBatchBusy] = useState(false)

	const proposals = useMemo<ReadonlyArray<PendingProposal>>(
		() =>
			AsyncResult.isSuccess(proposalsResult) ? [...proposalsResult.value] : [],
		[proposalsResult],
	)
	const runs = useMemo(
		() =>
			AsyncResult.isSuccess(runsResult) ? narrowResearch(runsResult.value) : [],
		[runsResult],
	)
	const paidSpendCents = useMemo(
		() =>
			AsyncResult.isSuccess(spendResult) ? sumSpend(spendResult.value) : 0,
		[spendResult],
	)

	const visible = useMemo(
		() =>
			subject === 'all'
				? proposals
				: proposals.filter(p => p.subjectTable === subject),
		[proposals, subject],
	)

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
		() => runs.filter(r => ATTENTION_STATUSES.has(r.status)),
		[runs],
	)

	const resolvedCount = Object.keys(results).length
	const pendingCount = Math.max(0, proposals.length - resolvedCount)
	const recentRuns = runs.length

	const isLoading = AsyncResult.isInitial(proposalsResult)
	const isFailure = AsyncResult.isFailure(proposalsResult)

	async function resolveOne(
		p: PendingProposal,
		decision: 'apply' | 'reject',
	): Promise<void> {
		if (p.proposedUpdateId === null) return
		const key = rowKey(p)
		setBusy(b => ({ ...b, [key]: true }))
		const run = decision === 'apply' ? apply : reject
		const exit = await run({
			params: { id: p.researchId, puId: p.proposedUpdateId },
		})
		setBusy(b => ({ ...b, [key]: false }))
		if (exit._tag === 'Success') {
			setResults(r => ({
				...r,
				[key]: {
					outcome: exit.value.outcome,
					reason: exit.value.reason ?? null,
				},
			}))
		} else {
			toast.add({ title: t`Could not resolve this proposal.`, type: 'error' })
		}
	}

	async function applyAllVerified(): Promise<void> {
		const items = trustworthy
			.filter(
				p => p.proposedUpdateId !== null && results[rowKey(p)] === undefined,
			)
			.map(p => ({
				research_id: p.researchId,
				proposed_update_id: p.proposedUpdateId as string,
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
					next[`${r.research_id}::${r.proposed_update_id}`] = {
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

	const verifiedToApply = trustworthy.filter(
		p => p.proposedUpdateId !== null && results[rowKey(p)] === undefined,
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
					<TileValue>
						{pendingCount >= INBOX_PROPOSAL_LIMIT ? '100+' : pendingCount}
					</TileValue>
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
					<TileValue>{formatCents(paidSpendCents)}</TileValue>
					<TileLabel>
						<Trans>Paid spend this month</Trans>
					</TileLabel>
				</Tile>
			</Counters>

			<Toolbar>
				<Segmented role='group' aria-label={t`Filter by subject`}>
					<SegButton
						type='button'
						aria-pressed={subject === 'all'}
						$active={subject === 'all'}
						onClick={() => setSubject('all')}
					>
						<Trans>All</Trans>
					</SegButton>
					<SegButton
						type='button'
						aria-pressed={subject === 'companies'}
						$active={subject === 'companies'}
						onClick={() => setSubject('companies')}
					>
						<Trans>Companies</Trans>
					</SegButton>
					<SegButton
						type='button'
						aria-pressed={subject === 'contacts'}
						$active={subject === 'contacts'}
						onClick={() => setSubject('contacts')}
					>
						<Trans>Contacts</Trans>
					</SegButton>
				</Segmented>
				<PriButton
					type='button'
					$variant='filled'
					disabled={verifiedToApply === 0 || batchBusy}
					onClick={() => void applyAllVerified()}
					data-testid='research-inbox-apply-all'
				>
					{batchBusy
						? t`Applying…`
						: t`Apply all verified (${verifiedToApply})`}
				</PriButton>
				<RefreshLink
					type='button'
					onClick={() => {
						setResults({})
						refreshProposals()
					}}
				>
					<Trans>Refresh</Trans>
				</RefreshLink>
			</Toolbar>

			{isLoading ? (
				<Empty role='status'>
					<Trans>Loading the review queue…</Trans>
				</Empty>
			) : isFailure ? (
				<Empty role='alert'>
					<Trans>Could not load the review queue.</Trans>
				</Empty>
			) : (
				<>
					{attention.length > 0 ? (
						<Section data-testid='research-inbox-attention'>
							<SectionTitle>
								<Trans>Attention needed</Trans>
							</SectionTitle>
							<Rows>
								{attention.map(run => (
									<AttentionRow key={run.id}>
										<RowMain>
											<RowQuery>{run.query}</RowQuery>
											<RowMeta>
												{run.status === 'no_reliable_data' ? (
													<Trans>No reliable data found</Trans>
												) : (
													<Trans>Run failed</Trans>
												)}
											</RowMeta>
										</RowMain>
										<OpenRunLink id={run.id} label={t`Open run: ${run.query}`}>
											<Trans>Open</Trans>
											<ArrowRight size={14} aria-hidden />
										</OpenRunLink>
									</AttentionRow>
								))}
							</Rows>
						</Section>
					) : null}

					<ProposalSection
						testId='research-inbox-trustworthy'
						title={t`Ready to apply`}
						hint={t`Verified emails and grounded values — safe to apply in one click.`}
						proposals={trustworthy}
						results={results}
						busy={busy}
						onResolve={resolveOne}
					/>

					<ProposalSection
						testId='research-inbox-needs-review'
						title={t`Needs your review`}
						hint={t`Free-text, low-confidence or unverified — read before applying.`}
						proposals={needsReview}
						results={results}
						busy={busy}
						onResolve={resolveOne}
					/>

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
	busy,
	onResolve,
}: {
	readonly testId: string
	readonly title: string
	readonly hint: string
	readonly proposals: ReadonlyArray<PendingProposal>
	readonly results: Record<string, ResolveState>
	readonly busy: Record<string, boolean>
	readonly onResolve: (
		p: PendingProposal,
		decision: 'apply' | 'reject',
	) => Promise<void>
}) {
	if (proposals.length === 0) return null
	return (
		<Section data-testid={testId}>
			<SectionTitle>{title}</SectionTitle>
			<SectionHint>{hint}</SectionHint>
			<Rows>
				{proposals.map(p => (
					<ProposalRow
						key={rowKey(p)}
						proposal={p}
						result={results[rowKey(p)]}
						busy={busy[rowKey(p)] === true}
						onResolve={onResolve}
					/>
				))}
			</Rows>
		</Section>
	)
}

function ProposalRow({
	proposal,
	result,
	busy,
	onResolve,
}: {
	readonly proposal: PendingProposal
	readonly result: ResolveState | undefined
	readonly busy: boolean
	readonly onResolve: (
		p: PendingProposal,
		decision: 'apply' | 'reject',
	) => Promise<void>
}) {
	const { t } = useLingui()
	const subjectLabel =
		proposal.subjectTable !== null
			? proposal.subjectId !== null
				? `${proposal.subjectTable} · ${proposal.subjectId.slice(0, 8)}`
				: proposal.subjectTable
			: proposal.runQuery

	return (
		<Row data-testid='research-inbox-row'>
			<RowMain>
				<RowHead>
					<Operation>{proposal.operation}</Operation>
					<RowQuery>{subjectLabel}</RowQuery>
				</RowHead>
				{proposal.reason !== null ? (
					<RowReason>{proposal.reason}</RowReason>
				) : null}
				<RowBadges>
					<TrustBadge
						verification={proposal.verification}
						confidence={proposal.confidence}
						machineCheckable={proposal.machineCheckable}
					/>
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
					<OutcomeBadge outcome={result.outcome} reason={result.reason} />
				) : (
					<>
						<PriButton
							type='button'
							$variant='filled'
							aria-label={t`Apply ${subjectLabel}`}
							disabled={busy || proposal.proposedUpdateId === null}
							onClick={() => void onResolve(proposal, 'apply')}
							data-testid='research-inbox-apply'
						>
							{busy ? t`Working…` : t`Apply`}
						</PriButton>
						<PriButton
							type='button'
							$variant='outlined'
							aria-label={t`Reject ${subjectLabel}`}
							disabled={busy || proposal.proposedUpdateId === null}
							onClick={() => void onResolve(proposal, 'reject')}
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

function sumSpend(rows: ReadonlyArray<unknown>): number {
	let total = 0
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const amount = (row as Record<string, unknown>)['amountCents']
		if (typeof amount === 'number') total += amount
	}
	return total
}

function formatCents(cents: number): string {
	if (cents === 0) return '€0.00'
	return `€${(cents / 100).toFixed(2)}`
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

const Segmented = styled.div`
	display: inline-flex;
	gap: var(--space-2xs);
	flex: 1;
`

const SegButton = styled.button.withConfig({
	shouldForwardProp: prop => prop !== '$active',
})<{ $active: boolean }>`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	padding: var(--space-2xs) var(--space-sm);
	border-radius: var(--shape-2xs);
	border: 1px solid
		${p =>
			p.$active
				? 'var(--color-primary)'
				: 'color-mix(in oklab, var(--color-on-surface) 12%, transparent)'};
	background: ${p =>
		p.$active
			? 'color-mix(in oklab, var(--color-primary) 16%, transparent)'
			: 'transparent'};
	color: ${p =>
		p.$active ? 'var(--color-primary)' : 'var(--color-on-surface-variant)'};
	cursor: pointer;
`

const RefreshLink = styled.button`
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
