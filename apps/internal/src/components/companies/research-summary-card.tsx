import type { MessageDescriptor } from '@lingui/core'
import { Trans, useLingui } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import { Microscope, Plus } from 'lucide-react'
import styled from 'styled-components'

import { isSucceededResearchStatus } from '@batuda/domain'
import { PriButton } from '@batuda/ui/pri'

import { statusLabel } from '#/components/research/run-labels'
import type { ResearchRunRow } from '#/components/research/run-shapes'
import { RelativeDate } from '#/components/shared/relative-date'
import { formatMoneyCents } from '#/lib/format-money'
import {
	agedPaperSurface,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

export function ResearchSummaryCard({
	runs,
	lastEnrichedAt,
	onRunNew,
}: {
	readonly runs: ReadonlyArray<ResearchRunRow>
	/** When research findings were last accepted onto this company. */
	readonly lastEnrichedAt: string | null
	readonly onRunNew: () => void
}) {
	const { t } = useLingui()
	const latest = runs[0] ?? null
	// While the newest run carries nothing usable — still working, or failed — the
	// last one that did find something stands in beside it, so the card does not
	// read as if research never worked for this company.
	const fallbackRunWithFindings =
		latest !== null && !isSucceededResearchStatus(latest.status)
			? (runs.find(run => isSucceededResearchStatus(run.status)) ?? null)
			: null

	return (
		<Card data-testid='company-research-summary-card'>
			<Header>
				<Heading>
					<Microscope size={14} aria-hidden />
					<Trans>Research</Trans>
					{/* How current the company's researched facts are — a run that was
					    never applied does not make the row any fresher. */}
					{lastEnrichedAt !== null ? (
						<Freshness data-testid='company-research-freshness'>
							<Trans>
								updated{' '}
								<RelativeDate value={lastEnrichedAt} fallback={t`recently`} />
							</Trans>
						</Freshness>
					) : null}
				</Heading>
				<PriButton
					type='button'
					$variant='outlined'
					onClick={onRunNew}
					data-testid='company-research-summary-run-new'
				>
					<Plus size={14} aria-hidden />
					<span>
						<Trans>Run new</Trans>
					</span>
				</PriButton>
			</Header>
			{latest === null ? (
				<Empty>
					<Trans>No research yet.</Trans>
				</Empty>
			) : (
				<>
					<RunRow run={latest} />
					{fallbackRunWithFindings !== null ? (
						<RunRow
							run={fallbackRunWithFindings}
							label={t`Last run with findings`}
						/>
					) : null}
				</>
			)}
		</Card>
	)
}

function RunRow({
	run,
	label,
}: {
	readonly run: ResearchRunRow
	readonly label?: string | undefined
}) {
	const { i18n, t } = useLingui()
	return (
		<Link
			to='/research/$id'
			params={{ id: run.id }}
			data-testid={`company-research-summary-row-${run.id}`}
		>
			<LatestRow>
				{label !== undefined ? <FallbackLabel>{label}</FallbackLabel> : null}
				<Query title={run.query}>{run.query}</Query>
				<Meta>
					<Status>{runStatusText(run.status, i18n)}</Status>
					<Dot>·</Dot>
					<RelativeDate value={run.createdAt} fallback={t`unknown`} />
					{/* A run still queued has spent nothing, and printing a zero there
					    reads as "this was free" rather than "not yet billed". */}
					{run.costCents > 0 ? (
						<>
							<Dot>·</Dot>
							<span>
								{formatMoneyCents(run.costCents, { locale: i18n.locale })}
							</span>
						</>
					) : null}
				</Meta>
			</LatestRow>
		</Link>
	)
}

/**
 * The run's state in the reader's own language. The stored word is shown only
 * when it is one the vocabulary does not know, so a reader never faces a raw
 * value like "succeeded_low_confidence".
 */
function runStatusText(
	status: string,
	i18n: { _: (descriptor: MessageDescriptor) => string },
): string {
	const label = statusLabel(status)
	return label ? i18n._(label) : status
}

const Card = styled.section.withConfig({
	displayName: 'ResearchSummaryCard',
})`
	${agedPaperSurface}
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md);
`

const Header = styled.header.withConfig({
	displayName: 'ResearchSummaryCardHeader',
})`
	${rulerUnderRule}
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	padding-bottom: var(--space-2xs);
`

const Heading = styled.h3.withConfig({
	displayName: 'ResearchSummaryCardHeading',
})`
	${stenciledTitle}
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	margin: 0;
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
`

const LatestRow = styled.div.withConfig({
	displayName: 'ResearchSummaryCardLatestRow',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	color: inherit;
	text-decoration: none;
	border-radius: var(--shape-3xs);

	a:hover & {
		text-decoration: underline;
	}

	a:focus-visible & {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const FallbackLabel = styled.span.withConfig({
	displayName: 'ResearchSummaryCardFallbackLabel',
})`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const Query = styled.span.withConfig({
	displayName: 'ResearchSummaryCardQuery',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	min-width: 0;
`

const Meta = styled.span.withConfig({
	displayName: 'ResearchSummaryCardMeta',
})`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const Status = styled.span.withConfig({
	displayName: 'ResearchSummaryCardStatus',
})`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const Dot = styled.span.withConfig({
	displayName: 'ResearchSummaryCardDot',
})`
	color: var(--color-on-surface-variant);
`

const Empty = styled.p.withConfig({
	displayName: 'ResearchSummaryCardEmpty',
})`
	margin: 0;
	font-family: var(--font-body);
	font-style: italic;
	color: var(--color-on-surface-variant);
`

const Freshness = styled.span.withConfig({
	displayName: 'ResearchSummaryCardFreshness',
})`
	font-weight: var(--font-weight-regular);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
`
