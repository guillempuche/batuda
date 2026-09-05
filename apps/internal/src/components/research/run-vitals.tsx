import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { styled } from 'next-yak'

import type { ResearchRunLive } from '@batuda/controllers'
import { isTerminalResearchStatus } from '@batuda/domain'
import type { SchemaName } from '@batuda/research'
// Straight from the schemas file rather than the package entry point: that entry
// point also reaches the services that talk to the database and the outside
// world, and pulling those into the browser breaks this page outright.
import {
	countFoundRows,
	countPendingProposals,
} from '@batuda/research/application/schemas'

import { formatMoneyCents } from '#/lib/format-money'

/**
 * What a run has cost and what it has turned up, side by side, kept current by
 * the run's live stream.
 *
 * Spend is the figure worth watching while a run is going — it is the only one
 * that can be regretted — so it leads. What was found and what is waiting on a
 * decision follow, because they are what the run is for.
 */

// What each kind of run goes looking for, in the words a reader would use for
// them. `null` is a kind that hunts for no list of its own, and loses the tile
// with it: an enrichment fills in one company already on file, so "0 found"
// would be a wrong answer to a question nobody asked.
//
// Keyed by the schema registry's own names, so adding a kind fails the build
// here until it is given a word. Left as a loose string map it compiled fine
// with a name missing, and the tile simply never appeared — the run found its
// companies and the page quietly declined to say so.
const FOUND_LABEL: Record<SchemaName, MessageDescriptor | null> = {
	freeform: null,
	company_enrichment_v1: null,
	prospect_scan_v1: msg`Leads found`,
	contact_discovery_v1: msg`People found`,
	competitor_scan_v1: msg`Competitors found`,
}

// The same table read by whatever name a run row happens to carry, which is a
// plain string and on a run from a newer bundle may name no kind here.
const foundLabelFor: Record<string, MessageDescriptor | null | undefined> =
	FOUND_LABEL

// Shown where a figure has no answer yet, rather than a zero that would read as
// one. An em dash rather than a word, so it needs no translating.
const NOT_YET = '—'

export function RunVitals({
	vitals,
	schemaName,
	live,
}: {
	readonly vitals: ResearchRunLive
	readonly schemaName: string | null
	// Whether these figures are being kept current, so a reader can tell a run
	// that has gone quiet from one whose page has.
	readonly live: boolean
}) {
	const { i18n } = useLingui()
	const foundLabel = schemaName === null ? null : foundLabelFor[schemaName]
	const spent = vitals.costCents + vitals.paidCostCents
	const budget = vitals.budgetCents + vitals.paidBudgetCents

	return (
		<Wrap data-testid='research-run-vitals' $live={live}>
			<Tile data-testid='research-run-spend'>
				<TileLabel>
					<Trans>Spent</Trans>
				</TileLabel>
				<TileValue>
					{formatMoneyCents(spent, { locale: i18n.locale })}
				</TileValue>
				{budget > 0 ? (
					<TileNote>
						<Trans>
							of {formatMoneyCents(budget, { locale: i18n.locale })} allowed
						</Trans>
					</TileNote>
				) : null}
				{vitals.paidCostCents > 0 ? (
					<TileNote data-testid='research-run-paid-spend'>
						<Trans>
							includes{' '}
							{formatMoneyCents(vitals.paidCostCents, { locale: i18n.locale })}{' '}
							on paid lookups
						</Trans>
					</TileNote>
				) : null}
			</Tile>

			{foundLabel ? (
				<Tile data-testid='research-run-found'>
					<TileLabel>{i18n._(foundLabel)}</TileLabel>
					{/* A run that has not written down what it found yet has no number
					    to give. Zero would say it looked and found none. */}
					<TileValue>{vitals.foundCount ?? NOT_YET}</TileValue>
				</Tile>
			) : null}

			<Tile data-testid='research-run-pending'>
				<TileLabel>
					<Trans>To review</Trans>
				</TileLabel>
				<TileValue>{vitals.pendingProposalCount ?? NOT_YET}</TileValue>
				{vitals.pendingProposalCount !== null &&
				vitals.pendingProposalCount > 0 ? (
					<TileNote>
						<Trans>changes waiting on you</Trans>
					</TileNote>
				) : null}
			</Tile>
		</Wrap>
	)
}

/**
 * The same figures read off the run's own row, for the moment before the first
 * frame arrives and for a page whose stream never connects. The row and the
 * stream agree about a finished run; only the stream keeps up with a live one.
 */
export function vitalsFromRun(run: {
	readonly status: string
	readonly phase: number | null
	readonly schemaName: string | null
	readonly findings: unknown
	readonly sourceCount: number | null
	readonly progressSteps: number | null
	readonly costCents: number
	readonly paidCostCents: number
	readonly budgetCents: number
	readonly paidBudgetCents: number
}): ResearchRunLive {
	// Same rule the server's frame follows: nothing written down yet is not a
	// count of none.
	const counted =
		run.findings !== null &&
		typeof run.findings === 'object' &&
		Object.keys(run.findings as object).length > 0
	return {
		status: run.status,
		phase: run.phase,
		// Never recorded on the row — see the run's live handler.
		activeTool: null,
		sourceCount: run.sourceCount,
		progressSteps: run.progressSteps,
		costCents: run.costCents,
		paidCostCents: run.paidCostCents,
		budgetCents: run.budgetCents,
		paidBudgetCents: run.paidBudgetCents,
		foundCount: counted ? countFoundRows(run.schemaName, run.findings) : null,
		pendingProposalCount: counted ? countPendingProposals(run.findings) : null,
		done: isTerminalResearchStatus(run.status),
	}
}

const Wrap = styled.div<{ $live: boolean }>`
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
	gap: var(--space-2xs);

	/* Figures that have stopped being kept current must not read as current.
	   Dimmed rather than hidden: the last thing known is still worth showing. */
	opacity: ${p => (p.$live ? 1 : 0.6)};
	transition: opacity 200ms ease;

	@media (prefers-reduced-motion: reduce) {
		transition: none;
	}
`

const Tile = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	padding: var(--space-2xs) var(--space-xs);
	border: 1px solid var(--color-outline-variant);
	border-radius: var(--shape-2xs);
	background: var(--color-surface-container-lowest);
	min-width: 0;
`

const TileLabel = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	line-height: var(--typescale-label-small-line);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const TileValue = styled.span`
	font-family: var(--font-mono);
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
	color: var(--color-on-surface);
	/* Long money strings must wrap inside their tile rather than widen the row. */
	overflow-wrap: anywhere;
`

const TileNote = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	color: var(--color-on-surface-variant);
`
