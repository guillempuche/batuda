import { Trans, useLingui } from '@lingui/react/macro'
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

/**
 * Research summary card — shows the most recent research run for this
 * company plus a primary "Run new research" CTA. The full list of runs
 * stays accessible via the Conversations tab and direct
 * `/research/:id` deep-links; this card is the at-a-glance entry.
 *
 * Renders inside a `<form>` so the React-19 form-action replay buffer
 * keeps the button tappable before the dialog state is wired up — same
 * rationale as the existing Research-tab button.
 */
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
				<form
					action={() => {
						onRunNew()
					}}
				>
					<PriButton
						type='submit'
						$variant='outlined'
						data-testid='company-research-summary-run-new'
					>
						<Plus size={14} aria-hidden />
						<span>
							<Trans>Run new</Trans>
						</span>
					</PriButton>
				</form>
			</Header>
			{latest === null ? (
				<Empty>
					<Trans>No research yet.</Trans>
				</Empty>
			) : (
				<LatestRow>
					<Query title={latest.query}>{latest.query}</Query>
					<Meta>
						<Status>{latest.status}</Status>
						<Dot>·</Dot>
						<RelativeDate value={latest.createdAt} fallback={t`unknown`} />
					</Meta>
				</LatestRow>
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
