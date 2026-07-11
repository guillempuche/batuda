import { useAtomRefresh, useAtomSet } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import styled from 'styled-components'

import { PriButton, usePriToast } from '@batuda/ui/pri'

import {
	approvePaidActionAtom,
	researchDetailAtom,
	skipPaidActionAtom,
} from '#/atoms/research-atoms'
import {
	DEFAULT_TRUST_THRESHOLD,
	normalizeConfidence,
} from '#/components/research/proposal-logic'
import { useResearchRunId } from '#/components/research/research-run-context'
import { formatMoneyCents } from '#/lib/format-money'
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
	// Stamped onto each action when the run stores it, so a human can approve or
	// skip that exact entry. Absent on runs from before the id stamp.
	readonly id?: string
	readonly status?: string
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
			{citations.map(c => {
				// Route confidence through the one shared 0–100 normalizer: a raw
				// model score arrives as a 0–1 fraction, so the old ×100 turned an
				// already-0–100 value into "8500%".
				const confidence = normalizeConfidence(c.confidence)
				// Below the trust threshold reads as a caution: the critic keeps a
				// value it could not vouch for but could not rule out, marking it
				// shaky — so a reader tells a confirmed value from a kept-but-uncertain
				// one at a glance (the low % plus a warning mark).
				const low = confidence !== null && confidence < DEFAULT_TRUST_THRESHOLD
				return (
					<CitationLi key={stableKey(['cit', c.sourceId, c.quote ?? ''])}>
						<CitationKey>{c.sourceId}</CitationKey>
						{c.quote !== undefined ? (
							<CitationQuote>“{c.quote}”</CitationQuote>
						) : null}
						{confidence !== null ? (
							<CitationConfidence $low={low} data-low={low}>
								{low ? <AlertTriangle size={11} aria-hidden /> : null}
								{confidence}%
							</CitationConfidence>
						) : null}
					</CitationLi>
				)
			})}
		</CitationsUl>
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
					return <PaidActionRow key={key} action={a} />
				})}
			</List>
		</Section>
	)
}

// One paid action, with approve/skip controls when it is still pending and the
// run id is in context. Resolving refreshes the run so the row's status flips.
function PaidActionRow({ action }: { readonly action: PendingPaidAction }) {
	const { t, i18n } = useLingui()
	const toast = usePriToast()
	const runId = useResearchRunId()
	const approve = useAtomSet(approvePaidActionAtom, { mode: 'promiseExit' })
	const skip = useAtomSet(skipPaidActionAtom, { mode: 'promiseExit' })
	// A hook must run every render, so stand in a placeholder id when there is no
	// run; refresh only ever fires after a resolve, which requires a real id.
	const refreshRun = useAtomRefresh(researchDetailAtom(runId ?? '__no_run__'))
	const [busy, setBusy] = useState(false)

	const canResolve =
		runId !== null &&
		action.id !== undefined &&
		(action.status === undefined || action.status === 'pending')

	const resolve = async (decision: 'approve' | 'skip') => {
		if (runId === null || action.id === undefined) return
		setBusy(true)
		const call = decision === 'approve' ? approve : skip
		const exit = await call({
			params: { id: runId, paId: action.id },
		} as never)
		setBusy(false)
		if (exit._tag === 'Success') {
			refreshRun()
			toast.add({
				title:
					decision === 'approve'
						? t`Paid action approved`
						: t`Paid action skipped`,
				type: 'success',
			})
		} else {
			toast.add({ title: t`Could not update the paid action`, type: 'error' })
		}
	}

	return (
		<ListItem>
			<RowHead>
				<Pill>{action.tool}</Pill>
				{action.estimatedCents !== undefined ? (
					<Cost>
						{formatMoneyCents(action.estimatedCents, { locale: i18n.locale })}
					</Cost>
				) : null}
				{action.status !== undefined && action.status !== 'pending' ? (
					<ResolvedTag data-testid='paid-action-resolved'>
						{action.status}
					</ResolvedTag>
				) : null}
			</RowHead>
			{action.reason !== undefined ? <Reason>{action.reason}</Reason> : null}
			{canResolve ? (
				<PaidActions>
					<PriButton
						type='button'
						$variant='filled'
						data-testid='paid-action-approve'
						disabled={busy}
						onClick={() => void resolve('approve')}
					>
						<Trans>Approve</Trans>
					</PriButton>
					<PriButton
						type='button'
						$variant='text'
						data-testid='paid-action-skip'
						disabled={busy}
						onClick={() => void resolve('skip')}
					>
						<Trans>Skip</Trans>
					</PriButton>
				</PaidActions>
			) : null}
		</ListItem>
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
	// Proposed updates and already-in-CRM matches are shown by the actionable
	// review on the run page, so the read-only findings block only keeps the
	// pending paid actions.
	const paid = findings?.pendingPaidActions ?? []
	if (paid.length === 0) {
		return null
	}
	return <PendingPaidActionsSection actions={paid} />
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

const PaidActions = styled.div`
	display: flex;
	gap: var(--space-2xs);
	margin-top: var(--space-2xs);
`

const ResolvedTag = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--color-secondary);
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

const CitationConfidence = styled.span<{ $low?: boolean }>`
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
	font-variant-numeric: tabular-nums;
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
	color: ${p => (p.$low ? 'var(--color-error, #c6664b)' : 'var(--color-primary)')};
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
