import { useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import { ArrowLeft, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'
import styled from 'styled-components'

import { authClient } from '#/lib/auth-client'
import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import {
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

type Range = '30d' | 'month' | 'all'

type SpendBucket = {
	readonly key: string
	readonly amountCents: number
	readonly calls: number
}

const EMPTY: ReadonlyArray<SpendBucket> = []

export const Route = createFileRoute('/settings/organization/spend')({
	component: SpendPage,
})

function SpendPage() {
	const { t } = useLingui()
	const activeMember = authClient.useActiveMember()
	const myRole = activeMember.data?.role ?? null
	const canSeeSpend = myRole === 'owner' || myRole === 'admin'

	const [range, setRange] = useState<Range>('month')

	const providerAtom = useMemo(
		() =>
			BatudaApiAtom.query('research', 'spend', {
				query: { range, groupBy: 'provider' },
			}),
		[range],
	)
	const userAtom = useMemo(
		() =>
			BatudaApiAtom.query('research', 'spend', {
				query: { range, groupBy: 'user' },
			}),
		[range],
	)
	const toolAtom = useMemo(
		() =>
			BatudaApiAtom.query('research', 'spend', {
				query: { range, groupBy: 'tool' },
			}),
		[range],
	)

	const providerResult = useAtomValue(providerAtom)
	const userResult = useAtomValue(userAtom)
	const toolResult = useAtomValue(toolAtom)

	const provider = useMemo<ReadonlyArray<SpendBucket>>(
		() =>
			AsyncResult.isSuccess(providerResult)
				? narrowBuckets(providerResult.value)
				: EMPTY,
		[providerResult],
	)
	const byUser = useMemo<ReadonlyArray<SpendBucket>>(
		() =>
			AsyncResult.isSuccess(userResult)
				? narrowBuckets(userResult.value)
				: EMPTY,
		[userResult],
	)
	const byTool = useMemo<ReadonlyArray<SpendBucket>>(
		() =>
			AsyncResult.isSuccess(toolResult)
				? narrowBuckets(toolResult.value)
				: EMPTY,
		[toolResult],
	)

	const total = provider.reduce((sum, b) => sum + b.amountCents, 0)
	const maxBucket = provider.reduce((max, b) => Math.max(max, b.amountCents), 0)

	if (!canSeeSpend) {
		return (
			<Page>
				<Intro>
					<Heading>
						<Trans>Spend</Trans>
					</Heading>
					<Subtitle>
						<Trans>You don't have permission to see this page.</Trans>
					</Subtitle>
				</Intro>
			</Page>
		)
	}

	return (
		<Page>
			<BackLink to='/settings/organization'>
				<ArrowLeft size={14} aria-hidden />
				<span>
					<Trans>Back to organization</Trans>
				</span>
			</BackLink>

			<Intro>
				<Heading>
					<Wallet size={20} aria-hidden />
					<Trans>Spend</Trans>
				</Heading>
				<Subtitle>
					<Trans>Paid research API calls billed to this organization.</Trans>
				</Subtitle>
			</Intro>

			<Toolbar role='radiogroup' aria-label={t`Time range`}>
				<RangePill
					$active={range === 'month'}
					type='button'
					data-testid='settings-spend-range-month'
					onClick={() => {
						setRange('month')
					}}
				>
					<Trans>This month</Trans>
				</RangePill>
				<RangePill
					$active={range === '30d'}
					type='button'
					data-testid='settings-spend-range-30d'
					onClick={() => {
						setRange('30d')
					}}
				>
					<Trans>Last 30 days</Trans>
				</RangePill>
				<RangePill
					$active={range === 'all'}
					type='button'
					data-testid='settings-spend-range-all'
					onClick={() => {
						setRange('all')
					}}
				>
					<Trans>All time</Trans>
				</RangePill>
			</Toolbar>

			<TotalCard data-testid='settings-spend-total'>
				<TotalLabel>{rangeLabel(range, t)}</TotalLabel>
				<TotalValue>{formatCents(total)}</TotalValue>
				<TotalMeta>
					<Trans>across {provider.length} providers</Trans>
				</TotalMeta>
			</TotalCard>

			<Section data-testid='settings-spend-by-provider'>
				<SectionTitle>
					<Trans>By provider</Trans>
				</SectionTitle>
				{provider.length === 0 ? (
					<Empty>
						<Trans>No paid calls in this range.</Trans>
					</Empty>
				) : (
					<BarList>
						{provider.map(b => {
							const pct =
								maxBucket === 0
									? 0
									: Math.round((b.amountCents / maxBucket) * 100)
							return (
								<BarRow key={b.key}>
									<BarLabel>{b.key}</BarLabel>
									<BarTrack>
										<BarFill style={{ width: `${pct}%` }} />
									</BarTrack>
									<BarAmount>{formatCents(b.amountCents)}</BarAmount>
									<BarCalls>
										{b.calls === 1 ? (
											<Trans>1 call</Trans>
										) : (
											<Trans>{b.calls} calls</Trans>
										)}
									</BarCalls>
								</BarRow>
							)
						})}
					</BarList>
				)}
			</Section>

			<Section data-testid='settings-spend-by-user'>
				<SectionTitle>
					<Trans>By user</Trans>
				</SectionTitle>
				<BreakdownTable rows={byUser} />
			</Section>

			<Section data-testid='settings-spend-by-tool'>
				<SectionTitle>
					<Trans>By tool</Trans>
				</SectionTitle>
				<BreakdownTable rows={byTool} />
			</Section>
		</Page>
	)
}

function BreakdownTable({
	rows,
}: {
	readonly rows: ReadonlyArray<SpendBucket>
}) {
	if (rows.length === 0) {
		return (
			<Empty>
				<Trans>Nothing to show in this range.</Trans>
			</Empty>
		)
	}
	return (
		<Table>
			<thead>
				<tr>
					<th>
						<Trans>Key</Trans>
					</th>
					<th>
						<Trans>Spend</Trans>
					</th>
					<th>
						<Trans>Calls</Trans>
					</th>
				</tr>
			</thead>
			<tbody>
				{rows.map(r => (
					<tr key={r.key}>
						<td>{r.key}</td>
						<td>{formatCents(r.amountCents)}</td>
						<td>{r.calls}</td>
					</tr>
				))}
			</tbody>
		</Table>
	)
}

function narrowBuckets(
	rows: ReadonlyArray<unknown>,
): ReadonlyArray<SpendBucket> {
	const out: Array<SpendBucket> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		const key = typeof r['key'] === 'string' ? r['key'] : null
		const amount = typeof r['amountCents'] === 'number' ? r['amountCents'] : 0
		const calls = typeof r['calls'] === 'number' ? r['calls'] : 0
		if (key === null) continue
		out.push({ key, amountCents: amount, calls })
	}
	return out
}

function formatCents(cents: number): string {
	if (cents === 0) return '€0.00'
	return `€${(cents / 100).toFixed(2)}`
}

function rangeLabel(
	range: Range,
	t: (s: TemplateStringsArray) => string,
): string {
	if (range === 'month') return t`This month`
	if (range === '30d') return t`Last 30 days`
	return t`All time`
}

const Page = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`

const BackLink = styled(Link)`
	display: inline-flex;
	gap: var(--space-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-medium-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
	text-decoration: none;

	&:hover {
		color: var(--color-on-surface);
	}
`

const Intro = styled.div`
	${rulerUnderRule}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-bottom: var(--space-xs);
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

const Toolbar = styled.div`
	display: inline-flex;
	gap: var(--space-2xs);
`

const RangePill = styled.button.withConfig({
	shouldForwardProp: prop => prop !== '$active',
})<{ $active: boolean }>`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	padding: var(--space-2xs) var(--space-sm);
	border-radius: var(--shape-3xs);
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

const TotalCard = styled.div`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding: var(--space-md);
	border-radius: var(--shape-2xs);
`

const TotalLabel = styled.span`
	${stenciledTitle}
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const TotalValue = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-display-medium-size);
	line-height: var(--typescale-display-medium-line);
	font-variant-numeric: tabular-nums;
	color: var(--color-on-surface);
`

const TotalMeta = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
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

const BarList = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const BarRow = styled.div`
	display: grid;
	grid-template-columns: minmax(6rem, 10rem) 1fr 4.5rem 4.5rem;
	align-items: center;
	gap: var(--space-sm);
`

const BarLabel = styled.span`
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface);
	overflow: hidden;
	text-overflow: ellipsis;
`

const BarTrack = styled.div`
	height: 8px;
	border-radius: var(--shape-3xs);
	background: color-mix(in oklab, var(--color-on-surface) 8%, transparent);
	overflow: hidden;
`

const BarFill = styled.div`
	height: 100%;
	background: var(--color-primary);
	transition: width 200ms ease;
`

const BarAmount = styled.span`
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
	font-size: var(--typescale-body-small-size);
	font-variant-numeric: tabular-nums;
	color: var(--color-on-surface);
	text-align: right;
`

const BarCalls = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const Empty = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Table = styled.table`
	width: 100%;
	border-collapse: collapse;
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);

	th,
	td {
		text-align: left;
		padding: var(--space-2xs) var(--space-sm);
		border-bottom: 1px solid color-mix(in oklab, var(--color-on-surface) 6%, transparent);
	}

	th {
		${stenciledTitle}
		font-size: var(--typescale-label-small-size);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-on-surface-variant);
	}

	td:nth-child(2),
	td:nth-child(3) {
		font-variant-numeric: tabular-nums;
	}
`
