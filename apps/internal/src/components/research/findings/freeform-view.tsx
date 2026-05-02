import { Trans } from '@lingui/react/macro'
import styled from 'styled-components'

import { brushedMetalPlate, stenciledTitle } from '#/lib/workshop-mixins'

/**
 * Renders a `freeform` research finding. The schema (per
 * `packages/research/src/application/schemas/freeform.ts`) carries two
 * action-centric arrays — proposed CRM updates and pending paid actions
 * — plus inline citations on each leaf. C1 surfaces both as collapsible
 * sections; the typed schema-aware components for company-enrichment,
 * competitor-scan, contact-discovery, and prospect-scan ship in C2.
 */

type Citation = {
	readonly source_id: string
	readonly quote?: string
	readonly confidence?: number
}

type ProposedUpdate = {
	readonly subject_table: string
	readonly subject_id?: string
	readonly fields?: Readonly<Record<string, unknown>>
	readonly reason?: string
	readonly citations?: ReadonlyArray<Citation>
}

type PendingPaidAction = {
	readonly tool: string
	readonly args?: Readonly<Record<string, unknown>>
	readonly estimated_cents?: number
	readonly reason?: string
}

type FreeformFindings = {
	readonly proposed_updates?: ReadonlyArray<ProposedUpdate>
	readonly pending_paid_actions?: ReadonlyArray<PendingPaidAction>
}

export function FreeformView({
	findings,
}: {
	readonly findings: FreeformFindings | null | undefined
}) {
	const proposed = findings?.proposed_updates ?? []
	const paid = findings?.pending_paid_actions ?? []

	if (proposed.length === 0 && paid.length === 0) {
		return (
			<EmptyHint>
				<Trans>
					The run finished without proposed updates or paid actions.
				</Trans>
			</EmptyHint>
		)
	}

	return (
		<Sections>
			{proposed.length > 0 ? (
				<Section data-testid='research-proposed-updates'>
					<SectionTitle>
						<Trans>Proposed updates</Trans>
					</SectionTitle>
					<List>
						{proposed.map(u => {
							const key = stableKey([
								'pu',
								u.subject_table,
								u.subject_id ?? '',
								u.reason ?? '',
								u.fields ? JSON.stringify(u.fields) : '',
							])
							return (
								<ListItem key={key}>
									<RowHead>
										<Pill>{u.subject_table}</Pill>
										{u.subject_id !== undefined ? (
											<SubjectId>{u.subject_id}</SubjectId>
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
									{u.citations !== undefined && u.citations.length > 0 ? (
										<CitationList>
											{u.citations.map(c => (
												<CitationItem
													key={stableKey(['cit', c.source_id, c.quote ?? ''])}
												>
													{c.source_id}
													{c.quote !== undefined ? `: “${c.quote}”` : null}
												</CitationItem>
											))}
										</CitationList>
									) : null}
								</ListItem>
							)
						})}
					</List>
				</Section>
			) : null}

			{paid.length > 0 ? (
				<Section data-testid='research-pending-paid-actions'>
					<SectionTitle>
						<Trans>Pending paid actions</Trans>
					</SectionTitle>
					<List>
						{paid.map(a => {
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
										{a.estimated_cents !== undefined ? (
											<Cost>{`€${(a.estimated_cents / 100).toFixed(2)}`}</Cost>
										) : null}
									</RowHead>
									{a.reason !== undefined ? <Reason>{a.reason}</Reason> : null}
								</ListItem>
							)
						})}
					</List>
				</Section>
			) : null}
		</Sections>
	)
}

function stableKey(parts: ReadonlyArray<string>): string {
	return parts.join('|')
}

const Sections = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
`

const Section = styled.section`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md);
	border-radius: var(--shape-2xs);
`

const SectionTitle = styled.h3`
	${stenciledTitle}
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
	margin: 0;
`

const EmptyHint = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const List = styled.ul`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	margin: 0;
	padding: 0;
	list-style: none;
`

const ListItem = styled.li`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding: var(--space-sm);
	border: 1px solid color-mix(in oklab, var(--color-on-surface) 8%, transparent);
	border-radius: var(--shape-2xs);
`

const RowHead = styled.div`
	display: flex;
	align-items: center;
	gap: var(--space-2xs);
`

const Pill = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	background: color-mix(in oklab, var(--color-primary) 12%, transparent);
	color: var(--color-primary);
	padding: var(--space-3xs) var(--space-2xs);
	border-radius: var(--shape-3xs);
`

const SubjectId = styled.span`
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const Cost = styled.span`
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const Reason = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const FieldsTable = styled.dl`
	display: grid;
	grid-template-columns: max-content 1fr;
	gap: var(--space-3xs) var(--space-sm);
	margin: 0;
`

const FieldRow = styled.div`
	display: contents;
`

const FieldKey = styled.dt`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const FieldValue = styled.dd`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
	margin: 0;
	overflow-wrap: anywhere;
`

const CitationList = styled.ul`
	margin: 0;
	padding-left: var(--space-md);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const CitationItem = styled.li`
	margin: var(--space-3xs) 0;
`
