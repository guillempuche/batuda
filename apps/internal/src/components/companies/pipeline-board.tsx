import {
	closestCorners,
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	PointerSensor,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from '@dnd-kit/core'
import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { useLingui as useLinguiBase } from '@lingui/react'
import { useLingui } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import { Check, GripVertical, MoveRight } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriCheckbox, PriMenu, usePriToast } from '@batuda/ui/pri'

import {
	COMPANIES_PAGE_SIZE,
	type CompaniesSearch,
	canonicalSearchKey,
	companiesSearchAtom,
} from '#/atoms/companies-atoms'
import { pipelineAtom } from '#/atoms/pipeline-atoms'
import { ErrorState } from '#/components/shared/error-state'
import { InfiniteListFooter } from '#/components/shared/infinite-list-footer'
import { PriorityDot } from '#/components/shared/priority-dot'
import {
	type CompanyStatus,
	STATUS_ORDER,
	StatusBadge,
	statusLabels,
} from '#/components/shared/status-badge'
import { useBulkSelection } from '#/hooks/use-bulk-selection'
import { useCompanyIndustries } from '#/hooks/use-company-industries'
import { useInfiniteList } from '#/hooks/use-infinite-list'
import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import { CompanyOwnerControl } from './company-owner-control'

// Stable mutation-atom identity for company updates (status + owner).
const companyUpdateAtom = BatudaApiAtom.mutation('companies', 'update')

/** A lead as the board needs it — narrowed from the `companies.list` rows. */
export type BoardCardData = {
	readonly id: string
	readonly slug: string
	readonly name: string
	readonly status: string
	readonly industry: string | null
	readonly priority: number | null
	readonly ownerId: string | null
}

function narrowCards(
	rows: ReadonlyArray<unknown>,
): ReadonlyArray<BoardCardData> {
	const out: Array<BoardCardData> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		if (typeof r['slug'] !== 'string') continue
		if (typeof r['name'] !== 'string') continue
		if (typeof r['status'] !== 'string') continue
		out.push({
			id: r['id'],
			slug: r['slug'],
			name: r['name'],
			status: r['status'],
			industry: typeof r['industry'] === 'string' ? r['industry'] : null,
			priority: typeof r['priority'] === 'number' ? r['priority'] : null,
			ownerId: typeof r['ownerId'] === 'string' ? r['ownerId'] : null,
		})
	}
	return out
}

type OptimisticMove = {
	readonly toStatus: string
	readonly card: BoardCardData
}

/**
 * The pipeline board: one column per stage. Each column is its own status-filtered,
 * paged query; the column header count is the authoritative server total from the
 * pipeline snapshot. Cards drag between columns (touch via a press-delay pointer
 * sensor); every card also has a non-drag "move to stage" menu — the accessible,
 * touch-primary path. A single move is optimistic (the card jumps immediately,
 * rendered from the data captured at drag/menu time) and rolls back on a failed
 * save. Multi-select drives a bulk toolbar (set stage, release owner).
 */
export function PipelineBoard({
	search,
}: {
	readonly search: CompaniesSearch
}) {
	const { t } = useLingui()
	const toast = usePriToast()
	const searchKey = canonicalSearchKey(search)

	const pipelineResult = useAtomValue(pipelineAtom)
	const refreshPipeline = useAtomRefresh(pipelineAtom)
	const statusCounts = useMemo<Record<string, number>>(() => {
		if (!AsyncResult.isSuccess(pipelineResult)) return {}
		const value = pipelineResult.value as {
			statusCounts?: Record<string, number>
		}
		return value.statusCounts ?? {}
	}, [pipelineResult])

	const updateCompany = useAtomSet(companyUpdateAtom, { mode: 'promiseExit' })

	// Optimistic single moves; reset when the filters change (fresh server data).
	const [moved, setMoved] = useState<ReadonlyMap<string, OptimisticMove>>(
		() => new Map(),
	)
	// Which stages have to read the board again once a mutation has landed.
	// Only the stages a card left and arrived at can have changed, so the other
	// columns are left alone rather than all re-reading — and a reader who had
	// scrolled one of them keeps their place.
	// The tick rises with every mutation so moving the same card the same way
	// twice still asks the affected columns to read again — naming the stages
	// alone would look unchanged the second time.
	const [stale, setStale] = useState<{
		readonly tick: number
		readonly stages: ReadonlySet<string>
	}>(() => ({ tick: 0, stages: new Set() }))
	const markStale = useCallback((...stages: ReadonlyArray<string>) => {
		setStale(prev => ({ tick: prev.tick + 1, stages: new Set(stages) }))
	}, [])
	useEffect(() => {
		setMoved(new Map())
	}, [searchKey])

	const moveCard = useCallback(
		async (card: BoardCardData, toStatus: string) => {
			if (toStatus === card.status) return
			setMoved(prev => new Map(prev).set(card.id, { toStatus, card }))
			const exit = await updateCompany({
				params: { id: card.id },
				payload: { status: toStatus },
			} as never)
			if (exit._tag === 'Success') {
				refreshPipeline()
				markStale(card.status, toStatus)
				return
			}
			setMoved(prev => {
				const next = new Map(prev)
				next.delete(card.id)
				return next
			})
			toast.add({ title: t`Could not move the lead`, type: 'error' })
		},
		[updateCompany, refreshPipeline, toast, t],
	)

	// ── Drag ────────────────────────────────────────────────────
	const sensors = useSensors(
		useSensor(PointerSensor, {
			// Press-and-hold before a drag begins so a touch scroll of the board
			// isn't hijacked; tolerance is the finger drift allowed while holding.
			activationConstraint: { delay: 200, tolerance: 6 },
		}),
	)
	const [dragging, setDragging] = useState<BoardCardData | null>(null)
	const onDragStart = useCallback((event: DragStartEvent) => {
		setDragging(
			(event.active.data.current?.['card'] as BoardCardData | undefined) ??
				null,
		)
	}, [])
	const onDragEnd = useCallback(
		(event: DragEndEvent) => {
			setDragging(null)
			const { active, over } = event
			if (!over) return
			const card = active.data.current?.['card'] as BoardCardData | undefined
			if (card) void moveCard(card, String(over.id))
		},
		[moveCard],
	)

	// ── Bulk selection over every rendered card ─────────────────
	const [idsByStatus, setIdsByStatus] = useState<
		Record<string, ReadonlyArray<string>>
	>({})
	const registerColumnIds = useCallback(
		(status: string, ids: ReadonlyArray<string>) => {
			setIdsByStatus(prev => ({ ...prev, [status]: ids }))
		},
		[],
	)
	const allIds = useMemo(
		() => STATUS_ORDER.flatMap(s => idsByStatus[s] ?? []),
		[idsByStatus],
	)
	const selection = useBulkSelection(allIds)

	const bulkPatch = useCallback(
		async (payload: Record<string, unknown>) => {
			const ids = [...selection.selected]
			selection.clear()
			await Promise.all(
				ids.map(id => updateCompany({ params: { id }, payload } as never)),
			)
			refreshPipeline()
			// A bulk edit can touch any stage, so every column re-reads.
			markStale(...STATUS_ORDER)
		},
		[selection, updateCompany, refreshPipeline, markStale],
	)

	if (AsyncResult.isFailure(pipelineResult)) {
		return (
			<ErrorState
				data-testid='pipeline-error'
				title={t`Could not load the board`}
				description={t`The board could not be fetched. Check that the session is valid, then try again.`}
				onRetry={refreshPipeline}
			/>
		)
	}

	return (
		<Wrap>
			{selection.selectedCount > 0 && (
				<BulkBar role='toolbar' aria-label={t`Bulk actions`}>
					<BulkCount aria-live='polite'>
						{t`${selection.selectedCount} selected`}
					</BulkCount>
					<StagePicker
						testId='board-bulk-move'
						label={t`Move to…`}
						onPick={s => void bulkPatch({ status: s })}
					/>
					<PriButton
						type='button'
						$variant='outlined'
						onClick={() => void bulkPatch({ ownerId: null })}
						data-testid='board-bulk-release'
					>
						{t`Release owner`}
					</PriButton>
					<PriButton
						type='button'
						$variant='text'
						onClick={() => selection.clear()}
						data-testid='board-bulk-clear'
					>
						{t`Clear`}
					</PriButton>
				</BulkBar>
			)}

			<DndContext
				sensors={sensors}
				collisionDetection={closestCorners}
				onDragStart={onDragStart}
				onDragEnd={onDragEnd}
			>
				<Columns>
					{STATUS_ORDER.map(status => (
						<BoardColumn
							key={status}
							status={status}
							search={search}
							total={statusCounts[status] ?? 0}
							moved={moved}
							staleTick={stale.stages.has(status) ? stale.tick : 0}
							selection={selection}
							onMove={moveCard}
							onRegisterIds={registerColumnIds}
						/>
					))}
				</Columns>
				<DragOverlay>
					{dragging ? <DragCard card={dragging} /> : null}
				</DragOverlay>
			</DndContext>
		</Wrap>
	)
}

// ── Column ─────────────────────────────────────────────────────

function BoardColumn({
	status,
	search,
	total,
	moved,
	staleTick,
	selection,
	onMove,
	onRegisterIds,
}: {
	readonly status: CompanyStatus
	readonly search: CompaniesSearch
	readonly total: number
	readonly moved: ReadonlyMap<string, OptimisticMove>
	readonly staleTick: number
	readonly selection: ReturnType<typeof useBulkSelection>
	readonly onMove: (card: BoardCardData, toStatus: string) => void
	readonly onRegisterIds: (status: string, ids: ReadonlyArray<string>) => void
}) {
	const { t } = useLingui()
	const columnSearch = useMemo<CompaniesSearch>(
		() => ({ ...search, status }),
		[search, status],
	)
	const list = useInfiniteList({
		// Prefixed so a column cannot inherit the place the reader had reached
		// on the companies list: filtering that list to one stage produces the
		// very same filters this column reads, and the two are different screens.
		resetKey: `board:${canonicalSearchKey(columnSearch)}`,
		pageSize: COMPANIES_PAGE_SIZE,
		// Uncounted: the number above each column comes from the board's own
		// snapshot, and its footer stays quiet, so counting every stage on every
		// board load — and twice more each time a card moves — would be paid for
		// by nobody.
		atomFor: page => companiesSearchAtom(columnSearch, page),
	})

	// After a card moves, every column has to read the board again. Asking the
	// list to start over is what actually refetches: naming the column
	// differently would only reset which rows are held, and the answer already
	// in hand would come straight back unchanged.
	const refreshColumn = list.refresh
	useEffect(() => {
		if (staleTick === 0) return
		refreshColumn()
	}, [staleTick, refreshColumn])

	const serverCards = useMemo(() => narrowCards(list.items), [list.items])

	// Apply optimistic moves: drop cards that moved OUT of this stage, add cards
	// that moved IN (rendered from the data captured at move time).
	const cards = useMemo(() => {
		const remaining = serverCards.filter(c => {
			const mv = moved.get(c.id)
			return !mv || mv.toStatus === status
		})
		const seen = new Set(remaining.map(c => c.id))
		const movedIn: Array<BoardCardData> = []
		for (const m of moved.values()) {
			if (m.toStatus === status && !seen.has(m.card.id)) {
				movedIn.push({ ...m.card, status })
			}
		}
		return [...remaining, ...movedIn]
	}, [serverCards, moved, status])

	// A stable string key so ids publish to the parent only when the set of
	// cards changes, not on every new array identity (which would re-fire the
	// effect every render).
	const idsKey = cards.map(c => c.id).join(',')
	useEffect(() => {
		onRegisterIds(status, idsKey ? idsKey.split(',') : [])
	}, [idsKey, status, onRegisterIds])

	const { setNodeRef, isOver } = useDroppable({ id: status })
	const loaded = cards.length

	return (
		<Column
			ref={setNodeRef}
			$over={isOver}
			data-testid={`board-column-${status}`}
		>
			<ColumnHeader>
				<StatusBadge status={status} size='lg' />
				<ColumnCount data-testid={`board-count-${status}`}>{total}</ColumnCount>
			</ColumnHeader>
			<ColumnBody>
				{/* A column still loading has nothing in it yet either, and one whose
				    request failed knows nothing at all — either read as "no work at
				    this stage", which is the one thing they do not mean. */}
				{loaded === 0
					? !list.isLoadingFirstPage &&
						(list.isError ? (
							<ColumnFailed
								type='button'
								onClick={list.refresh}
								data-testid={`board-error-${status}`}
							>
								{t`Could not load — retry`}
							</ColumnFailed>
						) : (
							<ColumnEmpty>{t`Empty`}</ColumnEmpty>
						))
					: cards.map(card => (
							<DraggableCard
								key={card.id}
								card={card}
								selected={selection.isSelected(card.id)}
								onToggleSelect={() => selection.toggle(card.id)}
								onMove={onMove}
							/>
						))}
				<InfiniteListFooter
					list={list}
					testId={`board-${status}`}
					announce={false}
				/>
			</ColumnBody>
		</Column>
	)
}

// ── Card ───────────────────────────────────────────────────────

function DraggableCard({
	card,
	selected,
	onToggleSelect,
	onMove,
}: {
	readonly card: BoardCardData
	readonly selected: boolean
	readonly onToggleSelect: () => void
	readonly onMove: (card: BoardCardData, toStatus: string) => void
}) {
	const { t } = useLingui()
	// The row carries the trade's web-address form; the name is what to read.
	const { labelFor } = useCompanyIndustries()
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: card.id,
		data: { card, fromStatus: card.status },
	})
	const industry = labelFor(card.industry)

	return (
		<CardShell
			ref={setNodeRef}
			$selected={selected}
			$dragging={isDragging}
			data-testid={`board-card-${card.slug}`}
		>
			<CardTop>
				<PriCheckbox.Root
					checked={selected}
					onCheckedChange={() => onToggleSelect()}
					aria-label={t`Select ${card.name}`}
				>
					<PriCheckbox.Indicator>
						<Check size={12} aria-hidden />
					</PriCheckbox.Indicator>
				</PriCheckbox.Root>
				<CardNameArea>
					<Link to='/companies/$slug' params={{ slug: card.slug }}>
						{card.name}
					</Link>
				</CardNameArea>
				<PriorityDot priority={card.priority} />
				<DragHandle
					type='button'
					aria-label={t`Drag ${card.name}`}
					data-testid={`board-drag-${card.slug}`}
					{...attributes}
					{...listeners}
				>
					<GripVertical size={14} aria-hidden />
				</DragHandle>
			</CardTop>
			{industry !== null && <CardIndustry>{industry}</CardIndustry>}
			<CardBottom>
				<CompanyOwnerControl companyId={card.id} ownerId={card.ownerId} />
				<StagePicker
					testId={`board-move-${card.slug}`}
					label={t`Move`}
					value={card.status}
					onPick={s => {
						if (s !== card.status) onMove(card, s)
					}}
				/>
			</CardBottom>
		</CardShell>
	)
}

function DragCard({ card }: { readonly card: BoardCardData }) {
	return (
		<CardShell $selected={false} $dragging>
			<CardTop>
				<DragName>{card.name}</DragName>
				<PriorityDot priority={card.priority} />
			</CardTop>
		</CardShell>
	)
}

/** A stage-picker menu (localized labels) — the non-drag "move to stage" path,
 * reused for a single card and the bulk toolbar. */
function StagePicker({
	label,
	value,
	testId,
	onPick,
}: {
	readonly label: string
	readonly value?: string
	readonly testId: string
	readonly onPick: (status: CompanyStatus) => void
}) {
	const { i18n } = useLinguiBase()
	return (
		<PriMenu.Root>
			<PriMenu.Trigger
				render={props => (
					<MoveTrigger
						type='button'
						$variant='outlined'
						data-testid={testId}
						aria-label={label}
						{...props}
					>
						<MoveRight size={13} aria-hidden />
						<span>{label}</span>
					</MoveTrigger>
				)}
			/>
			<PriMenu.Portal>
				<PriMenu.Positioner sideOffset={6}>
					<PriMenu.Popup>
						{STATUS_ORDER.map(s => (
							<PriMenu.Item
								key={s}
								data-testid={`${testId}-option-${s}`}
								onClick={() => onPick(s)}
							>
								<Check
									size={12}
									aria-hidden
									style={{ opacity: value === s ? 1 : 0 }}
								/>
								<span>{i18n._(statusLabels[s])}</span>
							</PriMenu.Item>
						))}
					</PriMenu.Popup>
				</PriMenu.Positioner>
			</PriMenu.Portal>
		</PriMenu.Root>
	)
}

// ── Styles ─────────────────────────────────────────────────────

const Wrap = styled.div.withConfig({ displayName: 'PipelineBoardWrap' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
`

const BulkBar = styled.div.withConfig({ displayName: 'PipelineBoardBulkBar' })`
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-sm);
	padding: var(--space-2xs) var(--space-sm);
	border-radius: var(--shape-2xs);
	background: var(--color-primary);
	color: var(--color-on-primary);
`

const BulkCount = styled.span.withConfig({
	displayName: 'PipelineBoardBulkCount',
})`
	font-family: var(--font-display);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	font-size: var(--typescale-label-small-size);
`

const Columns = styled.div.withConfig({ displayName: 'PipelineBoardColumns' })`
	display: flex;
	gap: var(--space-sm);
	overflow-x: auto;
	padding-bottom: var(--space-sm);
	scroll-snap-type: x proximity;
`

const Column = styled.div.withConfig({
	displayName: 'PipelineBoardColumn',
	shouldForwardProp: prop => prop !== '$over',
})<{ $over: boolean }>`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	flex: 0 0 clamp(15rem, 78vw, 18rem);
	/* Hold every column to the flex basis. Without this a card whose content
	 * can't shrink (a long name, the owner control) would push its column
	 * past the basis — and since the columns don't shrink, that one ends up
	 * visibly wider than the rest. Flooring at 0 lets the cards truncate
	 * instead. */
	min-width: 0;
	min-height: 8rem;
	scroll-snap-align: start;
	padding: var(--space-2xs);
	border-radius: var(--shape-2xs);
	background: ${p =>
		p.$over
			? 'color-mix(in srgb, var(--color-primary) 12%, transparent)'
			: 'color-mix(in srgb, var(--color-on-surface) 4%, transparent)'};
	transition: background 140ms ease;
`

const ColumnHeader = styled.div.withConfig({
	displayName: 'PipelineBoardColumnHeader',
})`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-2xs);
	padding: var(--space-2xs);
`

const ColumnCount = styled.span.withConfig({
	displayName: 'PipelineBoardColumnCount',
})`
	font-family: var(--font-display);
	font-size: var(--typescale-title-small-size);
	font-weight: var(--font-weight-bold);
	color: var(--color-on-surface);
	text-shadow: var(--text-shadow-emboss);
`

const ColumnBody = styled.div.withConfig({
	displayName: 'PipelineBoardColumnBody',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const ColumnEmpty = styled.p.withConfig({
	displayName: 'PipelineBoardColumnEmpty',
})`
	margin: 0;
	padding: var(--space-sm);
	text-align: center;
	font-family: var(--font-body);
	font-style: italic;
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const ColumnFailed = styled.button.withConfig({
	displayName: 'PipelineBoardColumnFailed',
})`
	margin: 0;
	padding: var(--space-sm);
	width: 100%;
	border: 1px dashed var(--color-error);
	border-radius: var(--shape-2xs);
	background: transparent;
	text-align: center;
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-error);
	cursor: pointer;

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const CardShell = styled.div.withConfig({
	displayName: 'PipelineBoardCard',
	shouldForwardProp: prop => prop !== '$selected' && prop !== '$dragging',
})<{ $selected: boolean; $dragging: boolean }>`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	padding: var(--space-2xs) var(--space-sm);
	border-radius: var(--shape-2xs);
	background: var(--color-surface);
	border: 2px solid
		${p => (p.$selected ? 'var(--color-primary)' : 'var(--color-outline)')};
	opacity: ${p => (p.$dragging ? 0.4 : 1)};
	box-shadow: var(--shadow-paper-card);
`

const CardTop = styled.div.withConfig({ displayName: 'PipelineBoardCardTop' })`
	display: flex;
	align-items: center;
	gap: var(--space-2xs);
`

const CardNameArea = styled.div.withConfig({
	displayName: 'PipelineBoardCardNameArea',
})`
	flex: 1 1 auto;
	min-width: 0;

	a {
		display: block;
		font-family: var(--font-display);
		font-size: var(--typescale-label-large-size);
		font-weight: var(--font-weight-bold);
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: var(--color-on-surface);
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	a:hover {
		color: var(--color-primary);
	}
`

const DragName = styled.span.withConfig({
	displayName: 'PipelineBoardDragName',
})`
	flex: 1 1 auto;
	min-width: 0;
	font-family: var(--font-display);
	font-size: var(--typescale-label-large-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.03em;
	text-transform: uppercase;
	color: var(--color-on-surface);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const CardIndustry = styled.span.withConfig({
	displayName: 'PipelineBoardCardIndustry',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
`

const CardBottom = styled.div.withConfig({
	displayName: 'PipelineBoardCardBottom',
})`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-2xs);
`

const DragHandle = styled.button.withConfig({
	displayName: 'PipelineBoardDragHandle',
})`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 1.75rem;
	min-height: 1.75rem;
	border: none;
	background: transparent;
	color: var(--color-on-surface-variant);
	cursor: grab;
	touch-action: none;

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const MoveTrigger = styled(PriButton).withConfig({
	displayName: 'PipelineBoardMoveTrigger',
})`
	gap: var(--space-3xs);
	padding: var(--space-3xs) var(--space-2xs);
	font-size: var(--typescale-label-small-size);
`
