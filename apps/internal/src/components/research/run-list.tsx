import { Trans, useLingui } from '@lingui/react/macro'
import styled from 'styled-components'

import { brushedMetalPlate } from '#/lib/workshop-mixins'

export type ResearchRunRow = {
	readonly id: string
	readonly query: string
	readonly schemaName: string | null
	readonly kind: string
	readonly status: string
	readonly costCents: number
	readonly createdAt: string
}

export function RunList({
	runs,
	selectedId,
	onSelect,
}: {
	readonly runs: ReadonlyArray<ResearchRunRow>
	readonly selectedId: string | null
	readonly onSelect: (id: string) => void
}) {
	const { t } = useLingui()
	if (runs.length === 0) {
		return (
			<Empty>
				<Trans>No research runs yet for this company.</Trans>
			</Empty>
		)
	}
	return (
		<List data-testid='research-run-list'>
			{runs.map(run => (
				<Row
					key={run.id}
					type='button'
					$selected={run.id === selectedId}
					onClick={() => {
						onSelect(run.id)
					}}
					aria-label={t`Open research run ${run.query}`}
					data-testid={`research-run-row-${run.id}`}
				>
					<Query>{run.query}</Query>
					<MetaLine>
						<StatusBadge $status={run.status}>{run.status}</StatusBadge>
						{run.schemaName !== null ? (
							<SchemaPill>{run.schemaName}</SchemaPill>
						) : (
							<SchemaPillMuted>
								<Trans>(no schema)</Trans>
							</SchemaPillMuted>
						)}
						<KindPill>{run.kind}</KindPill>
						<Cost>{formatCents(run.costCents)}</Cost>
						<Created>{new Date(run.createdAt).toLocaleString()}</Created>
					</MetaLine>
				</Row>
			))}
		</List>
	)
}

function formatCents(cents: number): string {
	if (cents === 0) return '€0.00'
	const euros = cents / 100
	return `€${euros.toFixed(2)}`
}

const List = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const Row = styled.button.withConfig({
	shouldForwardProp: prop => prop !== '$selected',
})<{ $selected: boolean }>`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	align-items: flex-start;
	padding: var(--space-sm) var(--space-md);
	border-radius: var(--shape-2xs);
	border: 1px solid
		${p =>
			p.$selected
				? 'var(--color-primary)'
				: 'color-mix(in oklab, var(--color-on-surface) 10%, transparent)'};
	background: var(--color-surface);
	color: var(--color-on-surface);
	cursor: pointer;
	text-align: left;
	transition: border-color 160ms ease;

	&:hover {
		border-color: var(--color-primary);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const Query = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
`

const MetaLine = styled.span`
	display: inline-flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-2xs);
`

const StatusBadge = styled.span.withConfig({
	shouldForwardProp: prop => prop !== '$status',
})<{ $status: string }>`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	padding: var(--space-3xs) var(--space-2xs);
	border-radius: var(--shape-3xs);
	background: ${p => statusColor(p.$status)};
	color: var(--color-on-primary);
`

function statusColor(status: string): string {
	switch (status) {
		case 'succeeded':
			return 'color-mix(in oklab, var(--color-primary) 60%, white)'
		case 'failed':
			return 'color-mix(in oklab, var(--color-error, #c6664b) 70%, white)'
		case 'running':
		case 'queued':
			return 'color-mix(in oklab, var(--color-primary) 30%, white)'
		case 'cancelled':
		case 'deleted':
			return 'color-mix(in oklab, var(--color-on-surface) 24%, transparent)'
		default:
			return 'color-mix(in oklab, var(--color-on-surface) 20%, transparent)'
	}
}

const SchemaPill = styled.span`
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
`

const SchemaPillMuted = styled(SchemaPill)`
	font-style: italic;
`

const KindPill = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const Cost = styled.span`
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const Created = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const Empty = styled.p`
	font-family: var(--font-body);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`
