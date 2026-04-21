import { useLingui } from '@lingui/react/macro'
import { Bot, Check, ChevronRight, Pencil, Plus } from 'lucide-react'
import { motion } from 'motion/react'
import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react'
import styled from 'styled-components'

import { PriCheckbox, PriInput, PriPopover, PriTooltip } from '@batuda/ui/pri'

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
 *
 * Dashboard callers only pass the required read-only fields; the tasks
 * inbox additionally wires `priority`, `source`, and the `onEdit*`
 * callbacks to light up inline edit + badge chrome.
 */
export type TaskPriorityLabel = 'low' | 'normal' | 'high'
export type TaskSourceLabel = 'user' | 'agent' | 'webhook' | 'email' | 'booking'

export type TaskItemData = {
	readonly id: string
	readonly title: string
	readonly dueAt?: Date | string | null
	readonly companyName: string
	readonly companyId: string
	readonly companySlug?: string
	readonly priority?: TaskPriorityLabel
	readonly source?: TaskSourceLabel
}

export function TaskItem({
	task,
	completed,
	overdue = false,
	onToggle,
	onLogInteraction,
	onEditTitle,
	onEditDue,
	onOpenDetail,
}: {
	task: TaskItemData
	completed: boolean
	overdue?: boolean
	onToggle: (nextCompleted: boolean) => void
	onLogInteraction?: () => void
	onEditTitle?: (nextTitle: string) => void | Promise<void>
	onEditDue?: (nextDue: Date | null) => void | Promise<void>
	onOpenDetail?: () => void
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
			{task.priority !== undefined && <PriorityMark priority={task.priority} />}
			<Body>
				<Company>{task.companyName}</Company>
				{onEditTitle ? (
					<InlineTitleEditor
						value={task.title}
						completed={completed}
						onSave={onEditTitle}
					/>
				) : (
					<Title $completed={completed}>{task.title}</Title>
				)}
			</Body>
			<Meta>
				{onEditDue ? (
					<DueEditor value={task.dueAt ?? null} onSave={onEditDue} />
				) : (
					<RelativeDate value={task.dueAt ?? null} fallback={t`no date`} />
				)}
			</Meta>
			{task.source !== undefined && <SourceBadge source={task.source} />}
			{onOpenDetail && (
				<DetailButton
					type='button'
					onClick={onOpenDetail}
					aria-label={t`Open task details`}
				>
					<ChevronRight size={14} />
				</DetailButton>
			)}
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

// ── Inline title editor ──────────────────────────────────────────

function InlineTitleEditor({
	value,
	completed,
	onSave,
}: {
	value: string
	completed: boolean
	onSave: (next: string) => void | Promise<void>
}) {
	const { t } = useLingui()
	const [editing, setEditing] = useState(false)
	const [draft, setDraft] = useState(value)
	const [pending, setPending] = useState(false)
	const cancelledRef = useRef(false)
	const inputRef = useRef<HTMLInputElement | null>(null)

	useEffect(() => {
		if (!editing) setDraft(value)
	}, [editing, value])

	useEffect(() => {
		if (!editing) return
		const el = inputRef.current
		if (el === null) return
		el.focus()
		el.select()
	}, [editing])

	const commit = useCallback(async () => {
		if (cancelledRef.current) {
			cancelledRef.current = false
			return
		}
		const next = draft.trim()
		if (next.length === 0 || next === value) {
			setEditing(false)
			return
		}
		setPending(true)
		try {
			await onSave(next)
			setEditing(false)
		} finally {
			setPending(false)
		}
	}, [draft, value, onSave])

	const cancel = useCallback(() => {
		cancelledRef.current = true
		setDraft(value)
		setEditing(false)
	}, [value])

	const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Escape') {
			e.preventDefault()
			cancel()
			return
		}
		if (e.key === 'Enter') {
			e.preventDefault()
			void commit()
		}
	}

	if (editing) {
		return (
			<InlineInput
				ref={inputRef}
				value={draft}
				onChange={e => setDraft(e.target.value)}
				onBlur={() => void commit()}
				onKeyDown={handleKey}
				disabled={pending}
				aria-label={t`Task title`}
			/>
		)
	}

	return (
		<TitleTrigger
			type='button'
			onClick={() => setEditing(true)}
			$completed={completed}
			aria-label={t`Edit task title`}
		>
			<TitleText>{value}</TitleText>
			<PencilMark aria-hidden>
				<Pencil size={12} />
			</PencilMark>
		</TitleTrigger>
	)
}

// ── Due-date popover editor ──────────────────────────────────────

function DueEditor({
	value,
	onSave,
}: {
	value: Date | string | null
	onSave: (next: Date | null) => void | Promise<void>
}) {
	const { t } = useLingui()
	const [open, setOpen] = useState(false)
	const [pending, setPending] = useState(false)
	const currentIso =
		value === null
			? ''
			: value instanceof Date
				? value.toISOString().slice(0, 10)
				: new Date(value).toISOString().slice(0, 10)

	const save = async (next: Date | null) => {
		setPending(true)
		try {
			await onSave(next)
			setOpen(false)
		} finally {
			setPending(false)
		}
	}

	return (
		<PriPopover.Root open={open} onOpenChange={setOpen}>
			<PriPopover.Trigger
				render={
					<DueTrigger
						type='button'
						aria-label={t`Edit due date`}
						disabled={pending}
					>
						<RelativeDate value={value} fallback={t`no date`} />
					</DueTrigger>
				}
			/>
			<PriPopover.Portal>
				<PriPopover.Positioner side='bottom' sideOffset={6}>
					<PriPopover.Popup>
						<DueForm>
							<DueLabel>{t`Due`}</DueLabel>
							<DueDateInput
								type='date'
								value={currentIso}
								onChange={e => {
									const raw = e.target.value
									if (raw === '') return
									const [y, m, d] = raw.split('-').map(Number)
									if (!y || !m || !d) return
									void save(new Date(Date.UTC(y, m - 1, d)))
								}}
								disabled={pending}
								aria-label={t`Due date`}
							/>
							{value !== null && (
								<ClearDue
									type='button'
									onClick={() => void save(null)}
									disabled={pending}
								>
									{t`Clear`}
								</ClearDue>
							)}
						</DueForm>
					</PriPopover.Popup>
				</PriPopover.Positioner>
			</PriPopover.Portal>
		</PriPopover.Root>
	)
}

// ── Priority + source badges ─────────────────────────────────────

function PriorityMark({ priority }: { priority: TaskPriorityLabel }) {
	const { t } = useLingui()
	const label =
		priority === 'high'
			? t`High priority`
			: priority === 'low'
				? t`Low priority`
				: t`Normal priority`
	return (
		<PriTooltip.Provider delay={400}>
			<PriTooltip.Root>
				<PriTooltip.Trigger
					render={
						<PriorityRivet $priority={priority} role='img' aria-label={label} />
					}
				/>
				<PriTooltip.Portal>
					<PriTooltip.Positioner side='top' sideOffset={6}>
						<PriTooltip.Popup>{label}</PriTooltip.Popup>
					</PriTooltip.Positioner>
				</PriTooltip.Portal>
			</PriTooltip.Root>
		</PriTooltip.Provider>
	)
}

function SourceBadge({ source }: { source: TaskSourceLabel }) {
	const { t } = useLingui()
	if (source === 'user') return null
	const label =
		source === 'agent'
			? t`Created by agent`
			: source === 'email'
				? t`From email`
				: source === 'booking'
					? t`From booking`
					: t`From webhook`
	const char =
		source === 'agent'
			? 'A'
			: source === 'email'
				? 'E'
				: source === 'booking'
					? 'B'
					: 'W'
	return (
		<PriTooltip.Provider delay={400}>
			<PriTooltip.Root>
				<PriTooltip.Trigger
					render={
						<Badge $source={source} role='img' aria-label={label}>
							{source === 'agent' ? <Bot size={10} aria-hidden /> : char}
						</Badge>
					}
				/>
				<PriTooltip.Portal>
					<PriTooltip.Positioner side='top' sideOffset={6}>
						<PriTooltip.Popup>{label}</PriTooltip.Popup>
					</PriTooltip.Positioner>
				</PriTooltip.Portal>
			</PriTooltip.Root>
		</PriTooltip.Provider>
	)
}

// ── Styles ────────────────────────────────────────────────────────

const Row = styled(motion.div).withConfig({
	displayName: 'TaskItemRow',
	shouldForwardProp: prop => !prop.startsWith('$'),
})<{ $overdue: boolean; $completed: boolean }>`
	${agedPaperRow}
	${ruledLedgerRow}
	position: relative;
	display: grid;
	grid-template-columns: auto auto 1fr auto auto auto auto;
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

const TitleTrigger = styled.button.withConfig({
	displayName: 'TaskItemTitleTrigger',
	shouldForwardProp: prop => prop !== '$completed',
})<{ $completed: boolean }>`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	background: transparent;
	border: 1px dashed transparent;
	border-radius: var(--shape-2xs);
	padding: var(--space-3xs) var(--space-2xs);
	margin: calc(var(--space-3xs) * -1) calc(var(--space-2xs) * -1);
	color: inherit;
	font: inherit;
	cursor: text;
	text-align: left;
	min-width: 0;
	transition: border-color 140ms ease, background 140ms ease;

	&:hover,
	&:focus-visible {
		border-color: color-mix(in srgb, var(--color-on-surface) 25%, transparent);
		background: color-mix(in srgb, var(--color-paper-fibre-a) 45%, transparent);
		outline: none;
	}
`

const TitleText = styled.span.withConfig({ displayName: 'TaskItemTitleText' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	color: var(--color-on-surface-variant);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const PencilMark = styled.span.withConfig({
	displayName: 'TaskItemPencilMark',
})`
	flex-shrink: 0;
	display: inline-flex;
	align-items: center;
	color: var(--color-on-surface-variant);
	opacity: 0;
	transition: opacity 140ms ease;

	${TitleTrigger}:hover &,
	${TitleTrigger}:focus-visible & {
		opacity: 0.7;
	}
`

const InlineInput = styled(PriInput).withConfig({
	displayName: 'TaskItemInlineInput',
})`
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	padding: var(--space-3xs) var(--space-xs);
`

const Meta = styled.span.withConfig({ displayName: 'TaskItemMeta' })`
	display: inline-flex;
	align-items: center;
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
	font-style: italic;
`

const DueTrigger = styled.button.withConfig({
	displayName: 'TaskItemDueTrigger',
})`
	background: transparent;
	border: 1px dashed transparent;
	border-radius: var(--shape-2xs);
	padding: var(--space-3xs) var(--space-2xs);
	margin: calc(var(--space-3xs) * -1) calc(var(--space-2xs) * -1);
	cursor: pointer;
	color: inherit;
	font: inherit;
	transition: border-color 140ms ease, background 140ms ease;

	&:hover,
	&:focus-visible {
		border-color: color-mix(in srgb, var(--color-on-surface) 25%, transparent);
		background: color-mix(in srgb, var(--color-paper-fibre-a) 45%, transparent);
		outline: none;
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
`

const DueForm = styled.div.withConfig({ displayName: 'TaskItemDueForm' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	min-width: 10rem;
`

const DueLabel = styled.span.withConfig({ displayName: 'TaskItemDueLabel' })`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	text-shadow: var(--text-shadow-emboss);
`

const DueDateInput = styled.input.withConfig({
	displayName: 'TaskItemDueDateInput',
})`
	padding: var(--space-2xs) var(--space-xs);
	background: #f0e8d0;
	border: 1px solid rgba(0, 0, 0, 0.35);
	border-radius: var(--shape-2xs);
	color: var(--color-on-surface);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);

	&:focus-visible {
		outline: none;
		border-color: var(--color-primary);
	}
`

const ClearDue = styled.button.withConfig({ displayName: 'TaskItemClearDue' })`
	${brushedMetalPlate}
	padding: var(--space-3xs) var(--space-xs);
	border-radius: var(--shape-2xs);
	color: var(--color-on-surface);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	cursor: pointer;

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
`

const PriorityRivet = styled.span.withConfig({
	displayName: 'TaskItemPriorityRivet',
	shouldForwardProp: prop => prop !== '$priority',
})<{ $priority: TaskPriorityLabel }>`
	display: inline-block;
	width: 10px;
	height: 10px;
	flex-shrink: 0;
	border-radius: 50%;
	background: radial-gradient(
		circle at 35% 35%,
		var(--color-metal-light),
		var(--color-metal) 55%,
		var(--color-metal-deep) 100%
	);
	border: 1px solid rgba(0, 0, 0, 0.45);
	box-shadow:
		inset 0 -1px 0 rgba(0, 0, 0, 0.35),
		inset 0 1px 0 rgba(255, 255, 255, 0.35),
		${p =>
			p.$priority === 'high'
				? '0 0 6px 0 var(--color-error), 0 0 0 1px rgba(233, 84, 32, 0.5)'
				: p.$priority === 'low'
					? '0 1px 2px rgba(0, 0, 0, 0.15)'
					: '0 1px 2px rgba(0, 0, 0, 0.3)'};
	opacity: ${p => (p.$priority === 'low' ? 0.55 : 1)};
`

const Badge = styled.span.withConfig({
	displayName: 'TaskItemSourceBadge',
	shouldForwardProp: prop => prop !== '$source',
})<{ $source: TaskSourceLabel }>`
	${brushedMetalPlate}
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.25rem;
	height: 1.25rem;
	border-radius: var(--shape-2xs);
	font-family: var(--font-display);
	font-size: 10px;
	font-weight: var(--font-weight-bold);
	letter-spacing: 0;
	color: var(--color-on-surface);
	text-shadow: var(--text-shadow-emboss);
	flex-shrink: 0;

	${p =>
		p.$source === 'agent' &&
		`
			background: linear-gradient(
				145deg,
				color-mix(in srgb, var(--color-primary) 35%, var(--color-metal-light)) 0%,
				var(--color-metal) 50%,
				var(--color-metal-dark) 100%
			);
		`}
`

const DetailButton = styled.button.withConfig({
	displayName: 'TaskItemDetailButton',
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
