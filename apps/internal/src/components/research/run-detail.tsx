import { useAtomRefresh, useAtomValue } from '@effect/atom-react'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import { RefreshCw } from 'lucide-react'
import type { ComponentType } from 'react'
import styled from 'styled-components'

import { isActiveResearchStatus } from '@batuda/domain'
import type { SchemaName } from '@batuda/research'
// Straight from the domain file rather than the package entry point: that entry
// point also reaches the services that talk to the database and the outside
// world, and pulling those into the browser breaks this page outright.
import {
	RESEARCH_REASON_CODES,
	type ReasonCode,
} from '@batuda/research/domain/types'
import { PriButton } from '@batuda/ui/pri'

import { researchDetailAtom } from '#/atoms/research-atoms'
import { MarkdownView } from '#/components/markdown/markdown-view'
import { Badge, type Tone, toneColor } from '#/components/research/badge'
import { CompanyEnrichmentView } from '#/components/research/findings/company-enrichment-view'
import { CompetitorScanView } from '#/components/research/findings/competitor-scan-view'
import { ContactDiscoveryView } from '#/components/research/findings/contact-discovery-view'
import { FreeformView } from '#/components/research/findings/freeform-view'
import { ProspectScanView } from '#/components/research/findings/prospect-scan-view'
import { ResearchRunIdProvider } from '#/components/research/research-run-context'
import { ProposedUpdatesReview } from '#/components/research/review/proposed-updates-review'
import { RunActions } from '#/components/research/run-actions'
import { statusLabel, statusTone } from '#/components/research/run-labels'
import { phaseMessage, RunProgress } from '#/components/research/run-progress'
import { TargetCorrection } from '#/components/research/target-correction'
import { ErrorState } from '#/components/shared/error-state'
import { SrOnly } from '#/components/shared/sr-only'
import { useResearchEvents } from '#/hooks/use-research-events'
import {
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

// Keyed by the schema registry's own names, so retiring or renaming one there
// fails the build here until this table follows.
type FindingsViewProps = { readonly findings: never }
const FINDINGS_VIEWS: Record<SchemaName, ComponentType<FindingsViewProps>> = {
	freeform: FreeformView,
	company_enrichment_v1: CompanyEnrichmentView,
	competitor_scan_v1: CompetitorScanView,
	contact_discovery_v1: ContactDiscoveryView,
	prospect_scan_v1: ProspectScanView,
}

// The same table, looked up by whatever name a run row happens to carry — which
// is a plain string, and on a run from a newer bundle may name no view here.
const findingsViewFor: Record<
	string,
	ComponentType<FindingsViewProps> | undefined
> = FINDINGS_VIEWS

// Localized sentence for each terminal failure reason, keyed by the run's
// reason_code so the backend stays language-free — it returns the code, the UI
// translates it. Exhaustive against ReasonCode.
const REASON_LABEL: Record<ReasonCode, MessageDescriptor> = {
	entity_mismatch: msg`The pages I found were about a different company, so I didn't save anything.`,
	weak_no_official_site: msg`I couldn't confirm the company's own website, so the findings weren't reliable enough to keep.`,
	site_unreadable: msg`I couldn't read the company's website, so there was nothing to work from.`,
	name_too_generic: msg`The name matched too many companies to tell them apart.`,
	no_sources: msg`I couldn't find any usable pages for this company.`,
	subject_unavailable: msg`The company this research was pinned to isn't here any more, so I stopped rather than research the wrong one.`,
	internal_error: msg`Something went wrong while running this research.`,
}

/** One run in a batch, as listed on the batch that started it. */
type ChildRun = {
	readonly id: string
	readonly query: string
	readonly status: string
}

type ResearchRunDetail = {
	readonly id: string
	readonly query: string
	readonly schemaName: string | null
	readonly status: string
	// A batch fans work out to one run per company; `children` are those runs.
	readonly kind: string
	readonly children: ReadonlyArray<ChildRun>
	// How thorough the run was, and the instruction templates that shaped it,
	// both carried so running it again repeats the same run.
	readonly mode: string | null
	readonly templateIds: ReadonlyArray<string>
	readonly templateNames: readonly string[]
	readonly briefMd: string | null
	readonly findings: unknown
	readonly errorMessage?: string | null
	readonly reasonCode?: ReasonCode | null
	// Rounds the run reports having got through, so a page opened partway in
	// still shows the real count.
	readonly progressSteps: number | null
	// How clearly the run's evidence was about the company asked for, so the
	// notice can name the doubt instead of only saying there is one.
	readonly entityMatch?: string | null
	// Carried so "Run again" can re-target the same subjects.
	readonly context: unknown
}

// The companies a run was asked about, read back off the request it was started
// with. A company the run merely mentioned is not one of these, and its notes are
// left alone, so only these are worth warning anybody about.
const subjectCompanyIds = (context: unknown): ReadonlySet<string> => {
	const subjects = (context as { subjects?: unknown } | null)?.subjects
	if (!Array.isArray(subjects)) return new Set()
	const ids = subjects
		.filter(
			(subject): subject is { table: string; id: string } =>
				typeof subject === 'object' &&
				subject !== null &&
				(subject as { table?: unknown }).table === 'companies' &&
				typeof (subject as { id?: unknown }).id === 'string',
		)
		.map(subject => subject.id)
	return new Set(ids)
}

export function RunDetail({ researchId }: { readonly researchId: string }) {
	const { t, i18n } = useLingui()
	const result = useAtomValue(researchDetailAtom(researchId))
	const refreshRun = useAtomRefresh(researchDetailAtom(researchId))

	// Narrow up front so the live-progress hook (a Hook, so it can't sit behind
	// an early return) knows whether the run is still in flight.
	const run = AsyncResult.isSuccess(result) ? narrowRun(result.value) : null
	const isRunning = run !== null && isActiveResearchStatus(run.status)
	// A batch hands its work to one run per company and does none itself, so it
	// never reports progress. Listening to it returned nothing and then announced
	// itself as stalled, on a page that showed no sign of the runs doing the work.
	const isBatch = run?.kind === 'group'
	// The raw token was being shown, so a reader saw "succeeded_low_confidence".
	const runStatusLabel = run !== null ? statusLabel(run.status) : null
	const { progress, done, failed, stalled, retry } = useResearchEvents(
		researchId,
		{ enabled: isRunning && !isBatch },
	)

	// One short sentence about where the run is, said only when it changes. The
	// progress panel itself is silent: announcing it re-read every figure in it on
	// every poll. This lives outside the panel so it is still on the page when the
	// run finishes, which is the moment most worth hearing about — a region that
	// appears at the same time as its text is not announced at all.
	const runLive = isBatch
		? null
		: done
			? t`This run has finished.`
			: stalled || failed
				? t`Live updates have stopped. The run may still be working.`
				: isRunning
					? i18n._(phaseMessage(progress.phase))
					: null

	// Only a first load has nothing to show. Treating a refresh as "loading" threw
	// the whole panel away and rebuilt it, which cut short the few seconds a
	// reader has to take back a change they just approved.
	if (AsyncResult.isInitial(result)) {
		return (
			<Panel data-testid='research-run-detail'>
				<Loading>
					<Trans>Loading run…</Trans>
				</Loading>
			</Panel>
		)
	}

	if (AsyncResult.isFailure(result)) {
		return (
			<Panel data-testid='research-run-detail'>
				<ErrorState
					variant='inline'
					data-testid='research-run-error'
					title={t`Could not load this run.`}
					onRetry={refreshRun}
				/>
			</Panel>
		)
	}

	if (run === null) {
		return (
			<Panel data-testid='research-run-detail'>
				<ErrorState
					variant='inline'
					data-testid='research-run-shape-error'
					title={t`This run can't be displayed.`}
					description={t`The run arrived in a form this page cannot read. Go back to the run list and open it again; report it if it keeps happening.`}
				/>
			</Panel>
		)
	}

	return (
		<ResearchRunIdProvider value={run.id}>
			<Panel data-testid='research-run-detail'>
				{runLive !== null ? (
					<SrOnly role='status' data-testid='research-run-live'>
						{runLive}
					</SrOnly>
				) : null}

				<Header>
					<Heading>{run.query}</Heading>
					<HeaderMeta>
						<StatusText
							$tone={statusTone(run.status)}
							data-testid={`research-run-status-${run.id}`}
						>
							{runStatusLabel ? i18n._(runStatusLabel) : run.status}
						</StatusText>
						{run.schemaName !== null ? (
							<SchemaText>{run.schemaName}</SchemaText>
						) : null}
					</HeaderMeta>
					<ShapedBy templateNames={run.templateNames} />
					<RunActions run={run} />
				</Header>

				{isRunning && !isBatch && !failed && !stalled ? (
					<RunProgress progress={progress} steps={run.progressSteps} />
				) : null}

				{isRunning && !isBatch && (failed || stalled) ? (
					<StalledNotice role='status' data-testid='research-run-stalled'>
						<span>
							<Trans>
								Live updates paused. This run may still be working — refresh to
								check its latest status.
							</Trans>
						</span>
						<PriButton
							type='button'
							$variant='outlined'
							data-testid='research-run-refresh'
							onClick={() => {
								retry()
								refreshRun()
							}}
						>
							<RefreshCw size={14} aria-hidden />
							<Trans>Refresh</Trans>
						</PriButton>
					</StalledNotice>
				) : null}

				{run.status === 'succeeded_low_confidence' ? (
					<ReviewNotice
						role='status'
						data-testid={`research-run-review-${run.id}`}
					>
						<strong>
							<Trans>Read this before you use it</Trans>
						</strong>
						{isBatch ? (
							// A batch carries the mark up from whichever of its results
							// earned it, so the reason belongs to that result, not here.
							<Trans>
								At least one of these results needs reading before it is used.
								Open the ones marked below.
							</Trans>
						) : run.entityMatch === 'weak' ? (
							<Trans>
								I found pages that mention this company but never clearly landed
								on its own website, so I can't be sure these findings are about
								the right one.
							</Trans>
						) : (
							<Trans>I found less to go on here than usual.</Trans>
						)}
					</ReviewNotice>
				) : null}

				{run.status === 'failed' || run.status === 'no_reliable_data' ? (
					<ErrorBlock
						role='alert'
						data-testid={`research-run-failure-${run.id}`}
					>
						<strong>
							{run.status === 'no_reliable_data' ? (
								<Trans>No reliable data found</Trans>
							) : (
								<Trans>Run failed</Trans>
							)}
						</strong>
						{run.reasonCode != null ? (
							<FailureReason reasonCode={run.reasonCode} />
						) : null}
					</ErrorBlock>
				) : null}

				{!isRunning &&
				(run.status === 'no_reliable_data' ||
					run.status === 'succeeded' ||
					run.status === 'succeeded_low_confidence') ? (
					<TargetCorrection researchId={run.id} />
				) : null}

				{run.briefMd !== null && run.briefMd !== '' ? (
					<Section data-testid='research-run-brief'>
						<SectionTitle>
							<Trans>Brief</Trans>
						</SectionTitle>
						<MarkdownView source={run.briefMd} />
					</Section>
				) : null}

				{run.children.length > 0 ? <BatchRuns runs={run.children} /> : null}

				{isRunning ? null : (
					<ProposedUpdatesReview
						researchId={run.id}
						briefMd={run.briefMd}
						subjectCompanyIds={subjectCompanyIds(run.context)}
					/>
				)}

				<Section data-testid='research-run-findings'>
					<SectionTitle>
						<Trans>Findings</Trans>
					</SectionTitle>
					<FindingsView schemaName={run.schemaName} findings={run.findings} />
				</Section>
			</Panel>
		</ResearchRunIdProvider>
	)
}

/**
 * The runs a batch handed its work to. Without this a batch showed nothing at
 * all — no progress, no findings, and no way to reach any of the runs it
 * started, which is where all of the actual results live.
 */
function BatchRuns({ runs }: { readonly runs: ReadonlyArray<ChildRun> }) {
	const { i18n } = useLingui()
	return (
		<Section data-testid='research-run-children'>
			<SectionTitle>
				<Trans>Runs in this batch</Trans>
			</SectionTitle>
			<ChildList>
				{runs.map(child => {
					const label = statusLabel(child.status)
					return (
						<ChildRow key={child.id}>
							<ChildLinkChrome>
								<Link to='/research/$id' params={{ id: child.id }}>
									{child.query === '' ? child.id : child.query}
								</Link>
							</ChildLinkChrome>
							<Badge $tone={statusTone(child.status)}>
								{label ? i18n._(label) : child.status}
							</Badge>
						</ChildRow>
					)
				})}
			</ChildList>
		</Section>
	)
}

function FindingsView({
	schemaName,
	findings,
}: {
	readonly schemaName: string | null
	readonly findings: unknown
}) {
	if (findings === null || findings === undefined) {
		return (
			<EmptyHint>
				<Trans>No structured findings.</Trans>
			</EmptyHint>
		)
	}
	if (
		typeof findings === 'object' &&
		!Array.isArray(findings) &&
		Object.keys(findings as object).length === 0
	) {
		return (
			<EmptyHint>
				<Trans>No structured findings.</Trans>
			</EmptyHint>
		)
	}
	// `null` predates the schemaName column; treat as freeform.
	const View = findingsViewFor[schemaName ?? 'freeform']
	if (View) {
		return <View findings={findings as never} />
	}
	// Unknown schema (newer than this bundle) — render JSON so data isn't dropped.
	return <Pre>{JSON.stringify(findings, null, 2)}</Pre>
}

// Show which standing instructions shaped this result, by name. The names are
// frozen onto the run when it is created, so they display for any viewer — even
// a teammate who can't read another member's personal template — and survive
// the template being renamed or deleted.
function ShapedBy({
	templateNames,
}: {
	readonly templateNames: readonly string[]
}) {
	if (templateNames.length === 0) return null
	return (
		<Provenance data-testid='research-run-provenance'>
			<ProvenanceLabel>
				<Trans>Shaped by</Trans>
			</ProvenanceLabel>
			<span>{templateNames.join(' · ')}</span>
		</Provenance>
	)
}

// A failed / no_reliable_data run's reason as a localized sentence keyed off the
// structured reason_code. A run predating the column (reasonCode null) shows only
// the generic heading above, never a raw English sentence.
function FailureReason({ reasonCode }: { readonly reasonCode: ReasonCode }) {
	const { i18n } = useLingui()
	return <span>{i18n._(REASON_LABEL[reasonCode])}</span>
}

function narrowChildren(raw: unknown): ReadonlyArray<ChildRun> {
	if (!Array.isArray(raw)) return []
	const out: Array<ChildRun> = []
	for (const row of raw) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		out.push({
			id: r['id'],
			query: typeof r['query'] === 'string' ? r['query'] : '',
			status: typeof r['status'] === 'string' ? r['status'] : 'queued',
		})
	}
	return out
}

function narrowRun(raw: unknown): ResearchRunDetail | null {
	if (!raw || typeof raw !== 'object') return null
	const r = raw as Record<string, unknown>
	if (typeof r['id'] !== 'string') return null
	if (typeof r['query'] !== 'string') return null
	if (typeof r['status'] !== 'string') return null
	return {
		id: r['id'],
		query: r['query'],
		schemaName: typeof r['schemaName'] === 'string' ? r['schemaName'] : null,
		status: r['status'],
		kind: typeof r['kind'] === 'string' ? r['kind'] : 'leaf',
		children: narrowChildren(r['children']),
		mode: typeof r['mode'] === 'string' ? r['mode'] : null,
		templateIds: Array.isArray(r['templateIds'])
			? r['templateIds'].filter((x): x is string => typeof x === 'string')
			: [],
		templateNames: Array.isArray(r['templateNames'])
			? r['templateNames'].filter((x): x is string => typeof x === 'string')
			: [],
		briefMd: typeof r['briefMd'] === 'string' ? r['briefMd'] : null,
		findings: r['findings'] ?? null,
		errorMessage:
			typeof r['errorMessage'] === 'string' ? r['errorMessage'] : null,
		reasonCode:
			typeof r['reasonCode'] === 'string' &&
			(RESEARCH_REASON_CODES as readonly string[]).includes(r['reasonCode'])
				? (r['reasonCode'] as ReasonCode)
				: null,
		progressSteps:
			typeof r['progressSteps'] === 'number' ? r['progressSteps'] : null,
		entityMatch: typeof r['entityMatch'] === 'string' ? r['entityMatch'] : null,
		context: r['context'] ?? null,
	}
}

// A section, not an aside: this holds the page's own content, and landmark
// navigation announced the entire run as something off to the side.
const Panel = styled.section`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
	padding: var(--space-md);
	border-radius: var(--shape-2xs);
`

const Header = styled.header`
	${rulerUnderRule}
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	padding-bottom: var(--space-xs);
`

const Heading = styled.h2`
	${stenciledTitle}
	font-size: var(--typescale-title-large-size);
	line-height: var(--typescale-title-large-line);
	margin: 0;
`

const HeaderMeta = styled.div`
	display: inline-flex;
	gap: var(--space-2xs);
	align-items: baseline;
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const Provenance = styled.div`
	display: inline-flex;
	gap: var(--space-2xs);
	align-items: baseline;
	flex-wrap: wrap;
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const ProvenanceLabel = styled.span`
	font-family: var(--font-display);
	letter-spacing: 0.06em;
	text-transform: uppercase;
`

const StatusText = styled.span.withConfig({
	shouldForwardProp: prop => prop !== '$tone',
})<{ $tone: Tone }>`
	font-family: var(--font-display);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: ${p => toneColor(p.$tone)};
`

const SchemaText = styled.span`
	font-family: var(--font-mono);
`

const ErrorBlock = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	padding: var(--space-sm);
	border: 1px solid var(--color-error);
	border-radius: var(--shape-2xs);
	color: var(--color-error);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
`

// The same box the failure block uses, in the caution accent: nothing went
// wrong here, so it must not read as an error — only as something to read.
const ReviewNotice = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	padding: var(--space-sm);
	border: 1px solid var(--color-primary);
	border-radius: var(--shape-2xs);
	color: var(--color-primary);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
`

const StalledNotice = styled.div`
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	padding: var(--space-sm);
	border: 1px solid var(--color-outline);
	border-radius: var(--shape-2xs);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
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

const Loading = styled.p`
	font-family: var(--font-body);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const EmptyHint = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Pre = styled.pre`
	font-family: var(--font-mono);
	font-size: var(--typescale-body-small-size);
	white-space: pre-wrap;
	word-wrap: break-word;
	/* A surface token rather than a mix toward black: darkening the surface again
	   made this near-invisible against the plate it sits on in a dark theme. */
	background: var(--color-surface-container-lowest);
	padding: var(--space-sm);
	border-radius: var(--shape-2xs);
	margin: 0;
`

const ChildList = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const ChildRow = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	padding: var(--space-2xs) var(--space-xs);
	border: 1px solid var(--color-outline-variant);
	border-radius: var(--shape-2xs);
`

// Styling `Link` directly erases TanStack's typed `params` inference, so the
// chrome lives on a wrapper and the real Link stays plain.
const ChildLinkChrome = styled.span`
	min-width: 0;

	& > a {
		font-family: var(--font-body);
		font-size: var(--typescale-body-small-size);
		color: var(--color-primary);
		text-decoration: underline;
	}

	& > a:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
		border-radius: var(--shape-3xs);
	}
`
