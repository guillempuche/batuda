import { Trans, useLingui } from '@lingui/react/macro'
import { CheckCircle } from 'lucide-react'
import styled from 'styled-components'

import { RelativeDate } from '#/components/shared/relative-date'
import {
	agedPaperSurface,
	ruledLedgerRow,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

export type OpenTaskRow = {
	readonly id: string
	readonly title: string
	readonly dueAt: string | null
}

/**
 * Open-tasks card — top 3 open tasks for this company, oldest-due
 * first. The card surfaces the "what's next" signal on the Overview so
 * the user doesn't have to switch tabs to see it. Adding tasks goes
 * through the dedicated create flow in Slice 3 (no UI exposed yet).
 */
export function OpenTasksCard({
	tasks,
}: {
	readonly tasks: ReadonlyArray<OpenTaskRow>
}) {
	const { t } = useLingui()
	const top = tasks.slice(0, 3)
	const remaining = tasks.length - top.length

	return (
		<Card data-testid='company-open-tasks-card'>
			<Header>
				<Heading>
					<CheckCircle size={14} aria-hidden />
					<Trans>Open tasks</Trans>
					<Count>({tasks.length})</Count>
				</Heading>
			</Header>
			{top.length === 0 ? (
				<Empty>
					<Trans>No open tasks.</Trans>
				</Empty>
			) : (
				<List>
					{top.map(task => (
						<Row key={task.id} data-testid={`company-open-task-${task.id}`}>
							<Title>{task.title}</Title>
							<Meta>
								<RelativeDate value={task.dueAt} fallback={t`no due date`} />
							</Meta>
						</Row>
					))}
					{remaining > 0 ? (
						<More>
							<Trans>+{remaining} more</Trans>
						</More>
					) : null}
				</List>
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

const Count = styled.span`
	font-family: var(--font-body);
	font-weight: normal;
	letter-spacing: 0;
	text-transform: none;
	color: var(--color-on-surface-variant);
	margin-left: var(--space-2xs);
`

const List = styled.ul`
	display: flex;
	flex-direction: column;
	gap: 0;
	list-style: none;
	margin: 0;
	padding: 0;
`

const Row = styled.li`
	${ruledLedgerRow}
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	padding: var(--space-xs) 0;

	&:first-child {
		border-top: none;
	}
`

const Title = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	min-width: 0;
`

const Meta = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
	flex-shrink: 0;
`

const More = styled.li`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	padding-top: var(--space-xs);
`

const Empty = styled.p`
	margin: 0;
	font-family: var(--font-body);
	font-style: italic;
	color: var(--color-on-surface-variant);
`
