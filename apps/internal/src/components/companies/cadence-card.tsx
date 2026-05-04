import { Trans, useLingui } from '@lingui/react/macro'
import { Plus, Radio } from 'lucide-react'
import styled from 'styled-components'

import { PriButton } from '@batuda/ui/pri'

import { RelativeDate } from '#/components/shared/relative-date'
import {
	agedPaperSurface,
	ruledLedgerRow,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

/**
 * Cadence card — when this deal last got a touch and when the next
 * scheduled event is. When all four signals are absent the card collapses
 * to a single "No contact yet" affordance with a Log-interaction CTA so
 * fresh companies don't waste 200 px on four "never" rows.
 *
 * The 4-row dl reflows from one column to two via container query, so
 * the layout responds to the card's own width (it lives inside a
 * Switcher / Sidebar) rather than the viewport.
 */
export function CadenceCard({
	lastEmailAt,
	lastCallAt,
	lastMeetingAt,
	nextCalendarEventAt,
	onLogInteraction,
}: {
	readonly lastEmailAt: string | null
	readonly lastCallAt: string | null
	readonly lastMeetingAt: string | null
	readonly nextCalendarEventAt: string | null
	readonly onLogInteraction: () => void
}) {
	const { t } = useLingui()
	const allEmpty =
		lastEmailAt === null &&
		lastCallAt === null &&
		lastMeetingAt === null &&
		nextCalendarEventAt === null

	if (allEmpty) {
		return (
			<Card data-testid='company-cadence-card' data-empty='true'>
				<Header>
					<Heading>
						<Radio size={14} aria-hidden />
						<Trans>Cadence</Trans>
					</Heading>
				</Header>
				<EmptyState>
					<EmptyText>
						<Trans>No contact yet.</Trans>
					</EmptyText>
					<PriButton
						type='button'
						$variant='outlined'
						onClick={onLogInteraction}
					>
						<Plus size={14} aria-hidden />
						<span>
							<Trans>Log first interaction</Trans>
						</span>
					</PriButton>
				</EmptyState>
			</Card>
		)
	}

	return (
		<Card data-testid='company-cadence-card'>
			<Header>
				<Heading>
					<Radio size={14} aria-hidden />
					<Trans>Cadence</Trans>
				</Heading>
			</Header>
			<Grid>
				<Row>
					<Label>
						<Trans>Last email</Trans>
					</Label>
					<RelativeDate value={lastEmailAt} fallback={t`never`} />
				</Row>
				<Row>
					<Label>
						<Trans>Last call</Trans>
					</Label>
					<RelativeDate value={lastCallAt} fallback={t`never`} />
				</Row>
				<Row>
					<Label>
						<Trans>Last meet</Trans>
					</Label>
					<RelativeDate value={lastMeetingAt} fallback={t`never`} />
				</Row>
				<Row>
					<Label>
						<Trans>Next event</Trans>
					</Label>
					<RelativeDate
						value={nextCalendarEventAt}
						fallback={t`none scheduled`}
					/>
				</Row>
			</Grid>
		</Card>
	)
}

const Card = styled.section`
	${agedPaperSurface}
	container-type: inline-size;
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md);
`

const Header = styled.header`
	${rulerUnderRule}
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

const Grid = styled.dl`
	display: grid;
	grid-template-columns: 1fr;
	margin: 0;

	@container (min-width: 32rem) {
		grid-template-columns: 1fr 1fr;
		column-gap: var(--space-lg);
	}
`

const Row = styled.div`
	${ruledLedgerRow}
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--space-sm);
	padding: var(--space-xs) 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface-variant);

	&:first-child {
		border-top: none;
	}

	@container (min-width: 32rem) {
		&:nth-child(2) {
			border-top: none;
		}
	}
`

const Label = styled.dt`
	${stenciledTitle}
	margin: 0;
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.08em;
	color: var(--color-on-surface-variant);
`

const EmptyState = styled.div`
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--space-sm);
`

const EmptyText = styled.p`
	margin: 0;
	font-family: var(--font-body);
	font-style: italic;
	color: var(--color-on-surface-variant);
`
