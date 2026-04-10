import { useLingui } from '@lingui/react/macro'
import { Check, Plus } from 'lucide-react'
import styled from 'styled-components'

import { PriCheckbox } from '@engranatge/ui/pri'

import { RelativeDate } from './relative-date'

/**
 * Single task row with a PriCheckbox on the left, company + title +
 * due date in the middle, and a trailing "+ Interacció" icon button
 * that opens Quick Capture pre-filled for the task's company.
 *
 * Overdue variant paints an accent bar on the left using the error
 * token — the company's `dueAt < now` test is the caller's job so
 * the same component renders correctly in both "today" and "overdue"
 * list buckets.
 */
export type TaskItemData = {
	id: string
	title: string
	dueAt?: Date | string | null
	companyName: string
	companyId: string
	companySlug?: string
}

export function TaskItem({
	task,
	completed,
	overdue = false,
	onToggle,
	onLogInteraction,
}: {
	task: TaskItemData
	completed: boolean
	overdue?: boolean
	onToggle: (nextCompleted: boolean) => void
	onLogInteraction?: () => void
}) {
	const { t } = useLingui()
	return (
		<Row $overdue={overdue} $completed={completed}>
			<PriCheckbox.Root
				checked={completed}
				onCheckedChange={next => onToggle(Boolean(next))}
				aria-label={
					completed
						? t`Mark "${task.title}" as pending`
						: t`Mark "${task.title}" as complete`
				}
			>
				<PriCheckbox.Indicator>
					<Check size={14} />
				</PriCheckbox.Indicator>
			</PriCheckbox.Root>
			<Body>
				<Company>{task.companyName}</Company>
				<Title>{task.title}</Title>
			</Body>
			<Meta>
				<RelativeDate value={task.dueAt ?? null} fallback={t`no date`} />
			</Meta>
			{onLogInteraction && (
				<LogButton
					type='button'
					onClick={onLogInteraction}
					aria-label={t`Log an interaction for this task`}
				>
					<Plus size={14} />
				</LogButton>
			)}
		</Row>
	)
}

const Row = styled.div.withConfig({
	displayName: 'TaskItemRow',
	shouldForwardProp: prop => prop !== '$overdue' && prop !== '$completed',
})<{ $overdue: boolean; $completed: boolean }>`
	display: grid;
	grid-template-columns: auto 1fr auto auto;
	align-items: center;
	gap: var(--space-sm);
	padding: var(--space-sm) var(--space-md);
	background: var(--color-surface-container-low);
	border: 1px solid var(--color-outline-variant);
	border-left-width: ${p => (p.$overdue ? '3px' : '1px')};
	border-left-color: ${p =>
		p.$overdue ? 'var(--color-error)' : 'var(--color-outline-variant)'};
	border-radius: var(--shape-sm);
	opacity: ${p => (p.$completed ? 0.55 : 1)};
	transition:
		opacity 200ms ease,
		background 120ms ease;

	&:hover {
		background: var(--color-surface-container);
	}
`

const Body = styled.div.withConfig({ displayName: 'TaskItemBody' })`
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const Company = styled.span.withConfig({ displayName: 'TaskItemCompany' })`
	font-family: var(--font-body);
	font-size: var(--typescale-label-medium-size);
	line-height: var(--typescale-label-medium-line);
	font-weight: var(--font-weight-bold);
	color: var(--color-on-surface);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const Title = styled.span.withConfig({ displayName: 'TaskItemTitle' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	letter-spacing: var(--typescale-body-small-tracking);
	color: var(--color-on-surface-variant);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const Meta = styled.span.withConfig({ displayName: 'TaskItemMeta' })`
	display: inline-flex;
	align-items: center;
`

const LogButton = styled.button.withConfig({
	displayName: 'TaskItemLogButton',
})`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.75rem;
	height: 1.75rem;
	border: 1px solid var(--color-outline-variant);
	border-radius: var(--shape-full);
	background: transparent;
	color: var(--color-on-surface-variant);
	cursor: pointer;
	transition:
		background 120ms ease,
		color 120ms ease,
		border-color 120ms ease;

	&:hover {
		background: var(--color-primary);
		color: var(--color-on-primary);
		border-color: var(--color-primary);
	}

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
`
