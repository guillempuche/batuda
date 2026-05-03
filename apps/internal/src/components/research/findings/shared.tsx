import { Trans } from '@lingui/react/macro'
import styled from 'styled-components'

import { brushedMetalPlate, stenciledTitle } from '#/lib/workshop-mixins'

/**
 * Shared UI primitives + cross-cutting sections for every research
 * finding view. The typed schema components (company-enrichment,
 * competitor-scan, contact-discovery, prospect-scan) each render their
 * own typed entities above these common sections; the freeform view
 * uses them too. Citation rendering is identical across schemas — they
 * all share the `{sourceId, quote?, confidence?}` shape.
 *
 * Findings are stored as JSONB with snake_case keys (the LLM agent
 * fills in the schema verbatim). The Pg client's transformResultNames
 * walks JSONB recursively (transformJson defaults to true), so by the
 * time the wire response leaves the server every key is camelCase —
 * including nested keys inside `findings`. The frontend types here
 * mirror that wire shape.
 */

export type Citation = {
	readonly sourceId: string
	readonly quote?: string
	readonly confidence?: number
}

export type ProposedUpdate = {
	readonly subjectTable: string
	readonly subjectId?: string
	readonly fields?: Readonly<Record<string, unknown>>
	readonly reason?: string
	readonly citations?: ReadonlyArray<Citation>
}

export type PendingPaidAction = {
	readonly tool: string
	readonly args?: Readonly<Record<string, unknown>>
	readonly estimatedCents?: number
	readonly reason?: string
}

export type DiscoveredExisting = {
	readonly subjectTable: string
	readonly subjectId: string
	readonly name: string
}

export type CommonFindings = {
	readonly proposedUpdates?: ReadonlyArray<ProposedUpdate>
	readonly pendingPaidActions?: ReadonlyArray<PendingPaidAction>
	readonly discoveredExisting?: ReadonlyArray<DiscoveredExisting>
}

export function stableKey(parts: ReadonlyArray<string>): string {
	return parts.join('|')
}

export function CitationList({
	citations,
}: {
	readonly citations: ReadonlyArray<Citation> | undefined
}) {
	if (!citations || citations.length === 0) return null
	return (
		<CitationsUl>
			{citations.map(c => (
				<CitationLi key={stableKey(['cit', c.sourceId, c.quote ?? ''])}>
					<CitationKey>{c.sourceId}</CitationKey>
					{c.quote !== undefined ? (
						<CitationQuote>“{c.quote}”</CitationQuote>
					) : null}
					{c.confidence !== undefined ? (
						<CitationConfidence>
							{Math.round(c.confidence * 100)}%
						</CitationConfidence>
					) : null}
				</CitationLi>
			))}
		</CitationsUl>
	)
}

export function ProposedUpdatesSection({
	updates,
}: {
	readonly updates: ReadonlyArray<ProposedUpdate>
}) {
	if (updates.length === 0) return null
	return (
		<Section data-testid='research-proposed-updates'>
			<SectionTitle>
				<Trans>Proposed updates</Trans>
			</SectionTitle>
			<List>
				{updates.map(u => {
					const key = stableKey([
						'pu',
						u.subjectTable,
						u.subjectId ?? '',
						u.reason ?? '',
						u.fields ? JSON.stringify(u.fields) : '',
					])
					return (
						<ListItem key={key}>
							<RowHead>
								<Pill>{u.subjectTable}</Pill>
								{u.subjectId !== undefined ? (
									<SubjectId>{u.subjectId}</SubjectId>
								) : null}
							</RowHead>
							{u.fields !== undefined ? (
								<FieldsTable>
									{Object.entries(u.fields).map(([k, v]) => (
										<FieldRow key={k}>
											<FieldKey>{k}</FieldKey>
											<FieldValue>
												{typeof v === 'string' ? v : JSON.stringify(v)}
											</FieldValue>
										</FieldRow>
									))}
								</FieldsTable>
							) : null}
							{u.reason !== undefined ? <Reason>{u.reason}</Reason> : null}
							<CitationList citations={u.citations} />
						</ListItem>
					)
				})}
			</List>
		</Section>
	)
}

export function PendingPaidActionsSection({
	actions,
}: {
	readonly actions: ReadonlyArray<PendingPaidAction>
}) {
	if (actions.length === 0) return null
	return (
		<Section data-testid='research-pending-paid-actions'>
			<SectionTitle>
				<Trans>Pending paid actions</Trans>
			</SectionTitle>
			<List>
				{actions.map(a => {
					const key = stableKey([
						'pa',
						a.tool,
						a.reason ?? '',
						a.args ? JSON.stringify(a.args) : '',
					])
					return (
						<ListItem key={key}>
							<RowHead>
								<Pill>{a.tool}</Pill>
								{a.estimatedCents !== undefined ? (
									<Cost>{`€${(a.estimatedCents / 100).toFixed(2)}`}</Cost>
								) : null}
							</RowHead>
							{a.reason !== undefined ? <Reason>{a.reason}</Reason> : null}
						</ListItem>
					)
				})}
			</List>
		</Section>
	)
}

export function DiscoveredExistingSection({
	matches,
}: {
	readonly matches: ReadonlyArray<DiscoveredExisting>
}) {
	if (matches.length === 0) return null
	return (
		<Section data-testid='research-discovered-existing'>
			<SectionTitle>
				<Trans>Already in CRM</Trans>
			</SectionTitle>
			<DiscoveredList>
				{matches.map(m => (
					<DiscoveredRow key={stableKey([m.subjectTable, m.subjectId])}>
						<Pill>{m.subjectTable}</Pill>
						<DiscoveredName>{m.name}</DiscoveredName>
						<SubjectId>{m.subjectId}</SubjectId>
					</DiscoveredRow>
				))}
			</DiscoveredList>
		</Section>
	)
}

export function CommonSections({
	findings,
}: {
	readonly findings: CommonFindings | null | undefined
}) {
	const proposed = findings?.proposedUpdates ?? []
	const paid = findings?.pendingPaidActions ?? []
	const existing = findings?.discoveredExisting ?? []
	if (proposed.length === 0 && paid.length === 0 && existing.length === 0) {
		return null
	}
	return (
		<>
			<DiscoveredExistingSection matches={existing} />
			<ProposedUpdatesSection updates={proposed} />
			<PendingPaidActionsSection actions={paid} />
		</>
	)
}

// ── Shared styled primitives ──

export const Sections = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
`

export const Section = styled.section`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md);
	border-radius: var(--shape-2xs);
`

export const SectionTitle = styled.h3`
	${stenciledTitle}
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
	margin: 0;
`

export const EmptyHint = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

export const List = styled.ul`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	margin: 0;
	padding: 0;
	list-style: none;
`

export const ListItem = styled.li`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding: var(--space-sm);
	border: 1px solid color-mix(in oklab, var(--color-on-surface) 8%, transparent);
	border-radius: var(--shape-2xs);
`

export const RowHead = styled.div`
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-2xs);
`

export const Pill = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	background: color-mix(in oklab, var(--color-primary) 12%, transparent);
	color: var(--color-primary);
	padding: var(--space-3xs) var(--space-2xs);
	border-radius: var(--shape-3xs);
`

export const SubjectId = styled.span`
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

export const Cost = styled.span`
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

export const Reason = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

export const FieldsTable = styled.dl`
	display: grid;
	grid-template-columns: max-content 1fr;
	gap: var(--space-3xs) var(--space-sm);
	margin: 0;
`

export const FieldRow = styled.div`
	display: contents;
`

export const FieldKey = styled.dt`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

export const FieldValue = styled.dd`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
	margin: 0;
	overflow-wrap: anywhere;
`

export const Tag = styled.span`
	display: inline-flex;
	align-items: center;
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	background: color-mix(in oklab, var(--color-on-surface) 8%, transparent);
	padding: var(--space-3xs) var(--space-2xs);
	border-radius: var(--shape-3xs);
	color: var(--color-on-surface);
`

export const TagList = styled.div`
	display: inline-flex;
	flex-wrap: wrap;
	gap: var(--space-3xs);
`

const CitationsUl = styled.ul`
	margin: 0;
	padding-left: var(--space-md);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	list-style: disc;
`

const CitationLi = styled.li`
	margin: var(--space-3xs) 0;
	display: inline-flex;
	flex-wrap: wrap;
	gap: var(--space-2xs);
	align-items: baseline;
`

const CitationKey = styled.span`
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
`

const CitationQuote = styled.span`
	font-style: italic;
`

const CitationConfidence = styled.span`
	font-variant-numeric: tabular-nums;
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
	color: var(--color-primary);
`

const DiscoveredList = styled.ul`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	margin: 0;
	padding: 0;
	list-style: none;
`

const DiscoveredRow = styled.li`
	display: inline-flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-2xs);
`

const DiscoveredName = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
`
