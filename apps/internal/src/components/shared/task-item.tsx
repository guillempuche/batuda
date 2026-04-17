import { useLingui } from '@lingui/react/macro'
import { Check, Plus } from 'lucide-react'
import { motion } from 'motion/react'
import styled from 'styled-components'

import { PriCheckbox } from '@engranatge/ui/pri'

import {
	agedPaperRow,
	brushedMetalPlate,
	ruledLedgerRow,
} from '#/lib/workshop-mixins'
import { RelativeDate } from './relative-date'

/**
 * Ruled ledger row. Each entry sits on an aged-paper strip with a thin
 * bottom rule; every fifth row gets a slightly bolder rule so long lists
 * read as a real accounting sheet. Overdue tasks flash a thick terracotta
 * rule on the left with a subtle glow, and completed rows fade to 55% with
 * the title struck through.
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
		<Row
			$overdue={overdue}
			$completed={completed}
			layout
			data-testid={`task-row-${task.id}`}
		>
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
				<Title $completed={completed}>{task.title}</Title>
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

const Row = styled(motion.div).withConfig({
	displayName: 'TaskItemRow',
	shouldForwardProp: prop => !prop.startsWith('$'),
})<{ $overdue: boolean; $completed: boolean }>`
	${agedPaperRow}
	${ruledLedgerRow}
	position: relative;
	display: grid;
	grid-template-columns: auto 1fr auto auto;
	align-items: center;
	gap: var(--space-sm);
	padding: var(--space-sm) var(--space-md);
	opacity: ${p => (p.$completed ? 0.55 : 1)};
	transition: opacity 200ms ease;
	min-width: 0;

	${p =>
		p.$overdue &&
		`
			border-left: 3px solid var(--color-error);
			box-shadow: inset 4px 0 8px -4px color-mix(in srgb, var(--color-error) 60%, transparent);
		`}
`

const Body = styled.div.withConfig({ displayName: 'TaskItemBody' })`
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const Company = styled.span.withConfig({ displayName: 'TaskItemCompany' })`
	font-family: var(--font-display);
	font-size: var(--typescale-label-medium-size);
	line-height: var(--typescale-label-medium-line);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--color-on-surface);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const Title = styled.span.withConfig({
	displayName: 'TaskItemTitle',
	shouldForwardProp: prop => prop !== '$completed',
})<{ $completed: boolean }>`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	color: var(--color-on-surface-variant);
	text-decoration: ${p => (p.$completed ? 'line-through' : 'none')};
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const Meta = styled.span.withConfig({ displayName: 'TaskItemMeta' })`
	display: inline-flex;
	align-items: center;
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
	font-style: italic;
`

const LogButton = styled.button.withConfig({
	displayName: 'TaskItemLogButton',
})`
	${brushedMetalPlate}
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.75rem;
	height: 1.75rem;
	padding: 0;
	border-radius: var(--shape-2xs);
	color: var(--color-on-surface);
	cursor: pointer;

	&:active {
		transform: translateY(1px);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`
