import { useAtomRefresh, useAtomValue } from '@effect/atom-react'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { AsyncResult } from 'effect/unstable/reactivity'
import { RefreshCw } from 'lucide-react'
import type { ComponentType } from 'react'
import styled from 'styled-components'

import {
	RESEARCH_REASON_CODES,
	type ReasonCode,
	type SchemaName,
} from '@batuda/research'
import { PriButton } from '@batuda/ui/pri'

import { researchDetailAtom } from '#/atoms/research-atoms'
import { MarkdownView } from '#/components/markdown/markdown-view'
import { CompanyEnrichmentView } from '#/components/research/findings/company-enrichment-view'
import { CompetitorScanView } from '#/components/research/findings/competitor-scan-view'
import { ContactDiscoveryView } from '#/components/research/findings/contact-discovery-view'
import { FreeformView } from '#/components/research/findings/freeform-view'
import { ProspectScanView } from '#/components/research/findings/prospect-scan-view'
import { ResearchRunIdProvider } from '#/components/research/research-run-context'
import { ProposedUpdatesReview } from '#/components/research/review/proposed-updates-review'
import { RunActions } from '#/components/research/run-actions'
import { RunProgress } from '#/components/research/run-progress'
import { TargetCorrection } from '#/components/research/target-correction'
import { ErrorState } from '#/components/shared/error-state'
import { useResearchEvents } from '#/hooks/use-research-events'
import {
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

// `Record<SchemaName, …>` keeps the dispatch table exhaustive against the schema registry.
type FindingsViewProps = { readonly findings: never }
const FINDINGS_VIEWS: Record<SchemaName, ComponentType<FindingsViewProps>> = {
	freeform: FreeformView,
	company_enrichment_v1: CompanyEnrichmentView,
	competitor_scan_v1: CompetitorScanView,
	contact_discovery_v1: ContactDiscoveryView,
	prospect_scan_v1: ProspectScanView,
}

// Localized sentence for each terminal failure reason, keyed by the run's
// reason_code so the backend stays language-free — it returns the code, the UI
// translates it. Exhaustive against ReasonCode.
const REASON_LABEL: Record<ReasonCode, MessageDescriptor> = {
	entity_mismatch: msg`The pages I found were about a different company, so I didn't save anything.`,
	weak_no_official_site: msg`I couldn't confirm the company's own website, so the findings weren't reliable enough to keep.`,
	site_unreadable: msg`I couldn't read the company's website, so there was nothing to work from.`,
	name_too_generic: msg`The name matched too many companies to tell them apart.`,
	no_sources: msg`I couldn't find any usable pages for this company.`,
	internal_error: msg`Something went wrong while running this research.`,
}

type ResearchRunDetail = {
	readonly id: string
	readonly query: string
	readonly schemaName: string | null
	readonly status: string
	readonly templateNames: readonly string[]
	readonly briefMd: string | null
	readonly findings: unknown
	readonly errorMessage?: string | null
	readonly reasonCode?: ReasonCode | null
	// Carried so "Run again" can re-target the same subjects.
	readonly context: unknown
}

export function RunDetail({ researchId }: { readonly researchId: string }) {
	const { t } = useLingui()
	const result = useAtomValue(researchDetailAtom(researchId))
	const refreshRun = useAtomRefresh(researchDetailAtom(researchId))

	// Narrow up front so the live-progress hook (a Hook, so it can't sit behind
	// an early return) knows whether the run is still in flight.
	const run = AsyncResult.isSuccess(result) ? narrowRun(result.value) : null
	const isRunning = run?.status === 'running' || run?.status === 'queued'
	const { progress, failed, stalled } = useResearchEvents(researchId, {
		enabled: isRunning,
	})

	if (AsyncResult.isInitial(result) || AsyncResult.isWaiting(result)) {
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
					title={t`Run shape unrecognised.`}
				/>
			</Panel>
		)
	}

	return (
		<ResearchRunIdProvider value={run.id}>
			<Panel data-testid='research-run-detail'>
				<Header>
					<Heading>{run.query}</Heading>
					<HeaderMeta>
						<StatusText
							$status={run.status}
							data-testid={`research-run-status-${run.id}`}
						>
							{run.status}
						</StatusText>
						{run.schemaName !== null ? (
							<SchemaText>{run.schemaName}</SchemaText>
						) : null}
					</HeaderMeta>
					<ShapedBy templateNames={run.templateNames} />
					<RunActions run={run} />
				</Header>

				{isRunning && !failed && !stalled ? (
					<RunProgress progress={progress} />
				) : null}

				{isRunning && (failed || stalled) ? (
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
							onClick={() => refreshRun()}
						>
							<RefreshCw size={14} aria-hidden />
							<Trans>Refresh</Trans>
						</PriButton>
					</StalledNotice>
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
				(run.status === 'no_reliable_data' || run.status === 'succeeded') ? (
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

				{isRunning ? null : <ProposedUpdatesReview researchId={run.id} />}

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
	const key = (schemaName ?? 'freeform') as SchemaName
	const View = FINDINGS_VIEWS[key]
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
		context: r['context'] ?? null,
	}
}

const Panel = styled.aside`
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

const Heading = styled.h3`
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
	shouldForwardProp: prop => prop !== '$status',
})<{ $status: string }>`
	font-family: var(--font-display);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: ${p =>
		p.$status === 'failed' ? 'var(--color-error)' : 'var(--color-on-surface)'};
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

const SectionTitle = styled.h4`
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
	background: color-mix(in oklab, var(--color-surface) 60%, black 6%);
	padding: var(--space-sm);
	border-radius: var(--shape-2xs);
	margin: 0;
`
