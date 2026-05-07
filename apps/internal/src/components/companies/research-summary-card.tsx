import { Trans, useLingui } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import { Microscope, Plus } from 'lucide-react'
import styled from 'styled-components'

import { PriButton } from '@batuda/ui/pri'

import type { ResearchRunRow } from '#/components/research/run-list'
import { RelativeDate } from '#/components/shared/relative-date'
import {
	agedPaperSurface,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

export function ResearchSummaryCard({
	runs,
	onRunNew,
}: {
	readonly runs: ReadonlyArray<ResearchRunRow>
	readonly onRunNew: () => void
}) {
	const { t } = useLingui()
	const latest = runs[0] ?? null

	return (
		<Card data-testid='company-research-summary-card'>
			<Header>
				<Heading>
					<Microscope size={14} aria-hidden />
					<Trans>Research</Trans>
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
				<Link
					to='/research/$id'
					params={{ id: latest.id }}
					data-testid={`company-research-summary-row-${latest.id}`}
				>
					<LatestRow>
						<Query title={latest.query}>{latest.query}</Query>
						<Meta>
							<Status>{latest.status}</Status>
							<Dot>·</Dot>
							<RelativeDate value={latest.createdAt} fallback={t`unknown`} />
						</Meta>
					</LatestRow>
				</Link>
			)}
		</Card>
	)
}

const Card = styled.section`
	${agedPaperSurface}
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md);
`

const Header = styled.header`
	${rulerUnderRule}
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	padding-bottom: var(--space-2xs);
`

const Heading = styled.h3`
	${stenciledTitle}
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	margin: 0;
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
`

const LatestRow = styled.div`
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

const Query = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	min-width: 0;
`

const Meta = styled.span`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const Status = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const Dot = styled.span`
	color: var(--color-on-surface-variant);
`

const Empty = styled.p`
	margin: 0;
	font-family: var(--font-body);
	font-style: italic;
	color: var(--color-on-surface-variant);
`
