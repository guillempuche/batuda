import { useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import { Mail } from 'lucide-react'
import { useMemo, useState } from 'react'
import styled from 'styled-components'

import { PriButton } from '@batuda/ui/pri'

import { calendarEventsByCompanyAtom } from '#/atoms/calendar-atoms'
import { RelativeDate } from '#/components/shared/relative-date'
import {
	agedPaperSurface,
	ruledLedgerRow,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

export type InteractionRow = {
	readonly id: string
	readonly channel: string
	readonly summary: string | null
	readonly occurredAt: string
}

export type ThreadRow = {
	readonly id: string
	readonly subject: string | null
	readonly status: 'open' | 'closed' | 'archived'
	readonly updatedAt: string
	readonly messageCount: number
}

export type CalendarRow = {
	readonly id: string
	readonly title: string
	readonly startAt: string
	readonly status: string
}

export type TaskRow = {
	readonly id: string
	readonly title: string
	readonly dueAt: string | null
	readonly completedAt: string | null
}

type ConvKind = 'interaction' | 'email' | 'calendar' | 'task'

type UnifiedRow =
	| {
			readonly kind: 'interaction'
			readonly date: string
			readonly row: InteractionRow
	  }
	| { readonly kind: 'email'; readonly date: string; readonly row: ThreadRow }
	| {
			readonly kind: 'calendar'
			readonly date: string
			readonly row: CalendarRow
	  }
	| { readonly kind: 'task'; readonly date: string; readonly row: TaskRow }

const ALL_KINDS: ReadonlyArray<ConvKind> = [
	'interaction',
	'email',
	'calendar',
	'task',
]

/**
 * Conversations tab — a single date-desc feed that merges interactions,
 * email threads, upcoming calendar events, and tasks for one company.
 * Replaces the four separate tabs (Emails, Tasks, Calendar) plus the
 * timeline-on-overview surface for users who want a chronological view.
 *
 * Filter chips toggle which kinds are visible; the timeline lives on
 * the Overview, this tab is the chronological deep-dive.
 *
 * URL persistence of the chip set is a Slice-5 polish step; today the
 * filter is component-local.
 */
export function ConversationsTab({
	companyId,
	interactions,
	threads,
	tasks,
	onCompose,
}: {
	readonly companyId: string
	readonly interactions: ReadonlyArray<InteractionRow>
	readonly threads: ReadonlyArray<ThreadRow>
	readonly tasks: ReadonlyArray<TaskRow>
	readonly onCompose: () => void
}) {
	const { t } = useLingui()
	const [enabled, setEnabled] = useState<ReadonlySet<ConvKind>>(
		() => new Set<ConvKind>(ALL_KINDS),
	)

	// Subscribe to calendar events here rather than threading them
	// through the parent — keeps the parent's prop contract small and
	// matches what the dashboard's UpcomingMeetingsCard already does
	// for its own slice of calendar data.
	const calendarAtom = useMemo(
		() => calendarEventsByCompanyAtom({ companyId, limit: 50 }),
		[companyId],
	)
	const calendarResult = useAtomValue(calendarAtom)
	const calendar = useMemo<ReadonlyArray<CalendarRow>>(
		() =>
			AsyncResult.isSuccess(calendarResult)
				? narrowCalendar(calendarResult.value)
				: [],
		[calendarResult],
	)

	const toggle = (kind: ConvKind) => {
		setEnabled(prev => {
			const next = new Set(prev)
			if (next.has(kind)) next.delete(kind)
			else next.add(kind)
			// All-off is the same as all-on — interpreting empty as "show
			// nothing" hides every row and looks broken.
			if (next.size === 0) return new Set<ConvKind>(ALL_KINDS)
			return next
		})
	}

	const merged = useMemo<ReadonlyArray<UnifiedRow>>(() => {
		const out: Array<UnifiedRow> = []
		for (const row of interactions) {
			out.push({ kind: 'interaction', date: row.occurredAt, row })
		}
		for (const row of threads) {
			out.push({ kind: 'email', date: row.updatedAt, row })
		}
		for (const row of calendar) {
			out.push({ kind: 'calendar', date: row.startAt, row })
		}
		for (const row of tasks) {
			const date = row.completedAt ?? row.dueAt ?? new Date(0).toISOString()
			out.push({ kind: 'task', date, row })
		}
		return out.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
	}, [interactions, threads, calendar, tasks])

	const visible = useMemo(
		() => merged.filter(row => enabled.has(row.kind)),
		[merged, enabled],
	)

	// Lingui's `t` is a tagged-template macro: it's transformed at the
	// call site, so passing `t` into a helper would compile to no-ops
	// and render empty strings. Build the label/title maps here, in JSX
	// scope, then read them by kind.
	const KIND_LABEL: Record<ConvKind, string> = {
		interaction: t`Interaction`,
		email: t`Email`,
		calendar: t`Calendar`,
		task: t`Task`,
	}
	const NO_SUMMARY = t`(no summary)`
	const NO_SUBJECT = t`(no subject)`
	const FALLBACK_DATE = t`unknown`

	const titleFor = (item: UnifiedRow): string => {
		switch (item.kind) {
			case 'interaction':
				return item.row.summary ?? NO_SUMMARY
			case 'email':
				return item.row.subject?.trim() || NO_SUBJECT
			case 'calendar':
				return item.row.title
			case 'task':
				return item.row.title
		}
	}

	return (
		<Wrap data-testid='company-conversations-tab'>
			<Toolbar>
				<Chips role='group' aria-label={t`Filter conversations`}>
					{ALL_KINDS.map(kind => (
						<Chip
							key={kind}
							type='button'
							onClick={() => toggle(kind)}
							$active={enabled.has(kind)}
							aria-pressed={enabled.has(kind)}
							data-testid={`company-conversations-chip-${kind}`}
						>
							{KIND_LABEL[kind]}
						</Chip>
					))}
				</Chips>
				<PriButton
					type='button'
					$variant='outlined'
					onClick={onCompose}
					data-testid='company-conversations-compose'
				>
					<Mail size={14} aria-hidden />
					<span>
						<Trans>Compose</Trans>
					</span>
				</PriButton>
			</Toolbar>
			{visible.length === 0 ? (
				<Empty>
					<Trans>No conversations yet.</Trans>
				</Empty>
			) : (
				<List>
					{visible.map(item => {
						const subtitle = rowSubtitle(item)
						const body = (
							<>
								<RowMain>
									<RowKind>{KIND_LABEL[item.kind]}</RowKind>
									<RowTitle>{titleFor(item)}</RowTitle>
									{subtitle ? <RowSubtitle>{subtitle}</RowSubtitle> : null}
								</RowMain>
								<RowMeta>
									<RelativeDate value={item.date} fallback={FALLBACK_DATE} />
								</RowMeta>
							</>
						)
						const key = `${item.kind}-${item.row.id}`
						return (
							<Row key={key} data-kind={item.kind}>
								{item.kind === 'email' ? (
									<Link
										to='/emails/$threadId'
										params={{ threadId: item.row.id }}
									>
										{body}
									</Link>
								) : (
									body
								)}
							</Row>
						)
					})}
				</List>
			)}
		</Wrap>
	)
}

function narrowCalendar(
	rows: ReadonlyArray<unknown>,
): ReadonlyArray<CalendarRow> {
	const out: Array<CalendarRow> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		if (typeof r['title'] !== 'string') continue
		if (typeof r['startAt'] !== 'string') continue
		out.push({
			id: r['id'],
			title: r['title'],
			startAt: r['startAt'],
			status: typeof r['status'] === 'string' ? r['status'] : 'confirmed',
		})
	}
	return out
}

function rowSubtitle(item: UnifiedRow): string | null {
	switch (item.kind) {
		case 'interaction':
			return item.row.channel
		case 'email':
			return `${item.row.messageCount} · ${item.row.status}`
		case 'calendar':
			return item.row.status
		case 'task':
			return item.row.completedAt !== null ? 'completed' : 'open'
	}
}

const Wrap = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
	padding: var(--space-md);
	${agedPaperSurface}
`

const Toolbar = styled.header`
	${rulerUnderRule}
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	padding-bottom: var(--space-2xs);
`

const Chips = styled.div`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-2xs);
`

const Chip = styled.button.withConfig({
	shouldForwardProp: prop => prop !== '$active',
})<{ $active: boolean }>`
	${stenciledTitle}
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
	padding: var(--space-3xs) var(--space-sm);
	background: ${p => (p.$active ? 'var(--color-primary)' : 'transparent')};
	color: ${p =>
		p.$active ? 'var(--color-on-primary)' : 'var(--color-on-surface-variant)'};
	border: 1px
		${p => (p.$active ? 'solid' : 'dashed')}
		${p => (p.$active ? 'var(--color-primary)' : 'var(--color-outline)')};
	border-radius: var(--shape-2xs);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	cursor: pointer;

	&:hover:not(:disabled) {
		border-color: var(--color-primary);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const List = styled.ul`
	display: flex;
	flex-direction: column;
	gap: 0;
	margin: 0;
	padding: 0;
	list-style: none;
`

const Row = styled.li`
	${ruledLedgerRow}
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	padding: var(--space-sm) 0;

	&:first-child {
		border-top: none;
	}

	/* Email rows wrap their body in a TanStack Link so the row is
	 * tappable. Stretch the link to fill the row and reset the default
	 * underline styling. */
	& > a {
		display: flex;
		flex: 1 1 auto;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-sm);
		color: inherit;
		text-decoration: none;
	}

	& > a:hover {
		color: var(--color-primary);
	}

	& > a:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
		border-radius: var(--shape-2xs);
	}
`

const RowMain = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	min-width: 0;
`

const RowKind = styled.span`
	${stenciledTitle}
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.08em;
	color: var(--color-on-surface-variant);
`

const RowTitle = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	min-width: 0;
`

const RowSubtitle = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const RowMeta = styled.span`
	${stenciledTitle}
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	color: var(--color-on-surface-variant);
	flex-shrink: 0;
`

const Empty = styled.p`
	margin: 0;
	font-family: var(--font-body);
	font-style: italic;
	color: var(--color-on-surface-variant);
`
