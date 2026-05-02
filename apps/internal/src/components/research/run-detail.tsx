import { useAtomValue } from '@effect/atom-react'
import { Trans } from '@lingui/react/macro'
import { AsyncResult } from 'effect/unstable/reactivity'
import styled from 'styled-components'

import { researchDetailAtom } from '#/atoms/research-atoms'
import { MarkdownView } from '#/components/markdown/markdown-view'
import { FreeformView } from '#/components/research/findings/freeform-view'
import {
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

type ResearchRunDetail = {
	readonly id: string
	readonly query: string
	readonly schemaName: string | null
	readonly status: string
	readonly briefMd: string | null
	readonly findings: unknown
	readonly errorMessage?: string | null
}

export function RunDetail({ researchId }: { readonly researchId: string }) {
	const result = useAtomValue(researchDetailAtom(researchId))

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
				<ErrorBlock role='alert'>
					<Trans>Could not load this run.</Trans>
				</ErrorBlock>
			</Panel>
		)
	}

	const run = narrowRun(result.value)
	if (run === null) {
		return (
			<Panel data-testid='research-run-detail'>
				<ErrorBlock role='alert'>
					<Trans>Run shape unrecognised.</Trans>
				</ErrorBlock>
			</Panel>
		)
	}

	const isRunning = run.status === 'running' || run.status === 'queued'

	return (
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
			</Header>

			{isRunning ? (
				<RunningBanner data-testid='research-run-running'>
					<Trans>Run in progress — events stream as they arrive.</Trans>
				</RunningBanner>
			) : null}

			{run.status === 'failed' ? (
				<ErrorBlock role='alert' data-testid={`research-run-failure-${run.id}`}>
					<strong>
						<Trans>Run failed</Trans>
					</strong>
					{run.errorMessage !== undefined && run.errorMessage !== null ? (
						<span>{run.errorMessage}</span>
					) : null}
				</ErrorBlock>
			) : null}

			{run.briefMd !== null && run.briefMd !== '' ? (
				<Section data-testid='research-run-brief'>
					<SectionTitle>
						<Trans>Brief</Trans>
					</SectionTitle>
					<MarkdownView source={run.briefMd} />
				</Section>
			) : null}

			<Section data-testid='research-run-findings'>
				<SectionTitle>
					<Trans>Findings</Trans>
				</SectionTitle>
				{run.schemaName === 'freeform' ? (
					<FreeformView findings={run.findings as never} />
				) : (
					<GenericFindings value={run.findings} />
				)}
			</Section>
		</Panel>
	)
}

function GenericFindings({ value }: { readonly value: unknown }) {
	if (value === null || value === undefined) {
		return (
			<EmptyHint>
				<Trans>No structured findings.</Trans>
			</EmptyHint>
		)
	}
	if (typeof value === 'object' && Object.keys(value).length === 0) {
		return (
			<EmptyHint>
				<Trans>No structured findings.</Trans>
			</EmptyHint>
		)
	}
	return <Pre>{JSON.stringify(value, null, 2)}</Pre>
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
		briefMd: typeof r['briefMd'] === 'string' ? r['briefMd'] : null,
		findings: r['findings'] ?? null,
		errorMessage:
			typeof r['errorMessage'] === 'string' ? r['errorMessage'] : null,
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

const StatusText = styled.span.withConfig({
	shouldForwardProp: prop => prop !== '$status',
})<{ $status: string }>`
	font-family: var(--font-display);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: ${p =>
		p.$status === 'failed'
			? 'var(--color-error, #c6664b)'
			: 'var(--color-on-surface)'};
`

const SchemaText = styled.span`
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
`

const RunningBanner = styled.div`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
`

const ErrorBlock = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	padding: var(--space-sm);
	border: 1px solid var(--color-error, #c6664b);
	border-radius: var(--shape-2xs);
	color: var(--color-error, #c6664b);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
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
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
	font-size: var(--typescale-body-small-size);
	white-space: pre-wrap;
	word-wrap: break-word;
	background: color-mix(in oklab, var(--color-surface) 60%, black 6%);
	padding: var(--space-sm);
	border-radius: var(--shape-2xs);
	margin: 0;
`
