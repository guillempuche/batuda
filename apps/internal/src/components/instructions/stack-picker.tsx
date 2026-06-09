import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from '@dnd-kit/core'
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useLingui } from '@lingui/react/macro'
import { ClientOnly } from '@tanstack/react-router'
import { GripVertical, Plus, X } from 'lucide-react'
import styled from 'styled-components'

import { brushedMetalPlate } from '#/lib/workshop-mixins'
import { InstructionIconButton, OwnerBadge } from './instruction-chrome'

export type StackOption = {
	readonly id: string
	readonly name: string
	readonly ownerUserId: string | null
}

// Accessible reorderable multi-select: pick templates into an ordered stack and
// reorder them by dragging (mouse, touch, or keyboard). The order is the prompt
// order, so position matters. Drag-and-drop can't run during server rendering,
// so only the reorderable list is client-only — the server emits a static
// read-only list and the client swaps in the draggable one once it mounts.
export function StackPicker({
	options,
	selectedIds,
	onChange,
}: {
	readonly options: ReadonlyArray<StackOption>
	readonly selectedIds: ReadonlyArray<string>
	readonly onChange: (ids: ReadonlyArray<string>) => void
}) {
	const { t } = useLingui()
	const byId = new Map(options.map(o => [o.id, o]))
	const selected = selectedIds
		.map(id => byId.get(id))
		.filter((o): o is StackOption => o !== undefined)
	const available = options.filter(o => !selectedIds.includes(o.id))

	// Press-and-hold before a drag begins so a touch scroll of the list isn't
	// mistaken for a drag; tolerance is how far a finger may drift while holding.
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { delay: 250, tolerance: 5 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	)

	const onDragEnd = (event: DragEndEvent) => {
		const { active, over } = event
		if (!over || active.id === over.id) return
		const from = selectedIds.indexOf(String(active.id))
		const to = selectedIds.indexOf(String(over.id))
		if (from < 0 || to < 0) return
		onChange(arrayMove([...selectedIds], from, to))
	}

	const remove = (id: string) => onChange(selectedIds.filter(x => x !== id))

	const ownerLabel = (o: StackOption) =>
		o.ownerUserId === null ? t`Org` : t`Mine`

	// Server-rendered placeholder: same rows, no drag handles or remove buttons.
	const staticList = (
		<SelectedList>
			{selected.map((o, i) => (
				<SelectedRow key={o.id} data-testid={`stack-row-${o.id}`}>
					<Position aria-hidden>{i + 1}</Position>
					<RowName>{o.name}</RowName>
					<RowBadge>{ownerLabel(o)}</RowBadge>
				</SelectedRow>
			))}
		</SelectedList>
	)

	return (
		<Wrap data-testid='instruction-stack-picker'>
			{selected.length === 0 ? (
				<EmptyNote>{t`No templates added yet.`}</EmptyNote>
			) : (
				<ClientOnly fallback={staticList}>
					<DndContext
						sensors={sensors}
						collisionDetection={closestCenter}
						onDragEnd={onDragEnd}
					>
						<SortableContext
							items={[...selectedIds]}
							strategy={verticalListSortingStrategy}
						>
							<SelectedList>
								{selected.map((o, i) => (
									<SortableRow
										key={o.id}
										id={o.id}
										position={i + 1}
										name={o.name}
										ownerLabel={ownerLabel(o)}
										dragLabel={t`Drag ${o.name} to reorder`}
										removeLabel={t`Remove ${o.name}`}
										onRemove={() => remove(o.id)}
									/>
								))}
							</SelectedList>
						</SortableContext>
					</DndContext>
				</ClientOnly>
			)}

			{available.length > 0 ? (
				<AddArea>
					<AddLabel>{t`Add a template`}</AddLabel>
					<AddList>
						{available.map(o => (
							<AddChip
								key={o.id}
								type='button'
								data-testid={`stack-add-${o.id}`}
								aria-label={t`Add ${o.name}`}
								onClick={() => onChange([...selectedIds, o.id])}
							>
								<Plus size={12} aria-hidden />
								<span>{o.name}</span>
								<OwnerBadge>{ownerLabel(o)}</OwnerBadge>
							</AddChip>
						))}
					</AddList>
				</AddArea>
			) : null}
		</Wrap>
	)
}

function SortableRow({
	id,
	position,
	name,
	ownerLabel,
	dragLabel,
	removeLabel,
	onRemove,
}: {
	readonly id: string
	readonly position: number
	readonly name: string
	readonly ownerLabel: string
	readonly dragLabel: string
	readonly removeLabel: string
	readonly onRemove: () => void
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id })

	return (
		<SelectedRow
			ref={setNodeRef}
			data-testid={`stack-row-${id}`}
			style={{
				transform: CSS.Transform.toString(transform),
				transition,
				opacity: isDragging ? 0.5 : 1,
			}}
		>
			<DragHandle
				type='button'
				ref={setActivatorNodeRef}
				aria-label={dragLabel}
				data-testid={`stack-drag-${id}`}
				{...attributes}
				{...listeners}
			>
				<GripVertical size={14} aria-hidden />
			</DragHandle>
			<Position aria-hidden>{position}</Position>
			<RowName>{name}</RowName>
			<RowBadge>{ownerLabel}</RowBadge>
			<InstructionIconButton
				type='button'
				data-testid={`stack-remove-${id}`}
				aria-label={removeLabel}
				onClick={onRemove}
			>
				<X size={14} aria-hidden />
			</InstructionIconButton>
		</SelectedRow>
	)
}

const Wrap = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
`

const EmptyNote = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const SelectedList = styled.ol`
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const SelectedRow = styled.li`
	${brushedMetalPlate}
	display: flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-sm);
	border-radius: var(--shape-2xs);
	/* Dark text on the metal plate keeps small labels above the 4.5:1 ratio. */
	color: var(--color-on-surface);
`

const DragHandle = styled.button`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	/* A comfortable finger-sized target so touch dragging is easy to grab. */
	min-width: 2rem;
	min-height: 2rem;
	padding: var(--space-3xs);
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

const Position = styled.span`
	font-family: var(--font-mono, ui-monospace, monospace);
	font-size: var(--typescale-body-small-size);
	font-variant-numeric: tabular-nums;
	color: var(--color-on-surface);
	min-width: 1.25rem;
`

const RowName = styled.span`
	flex: 1 1 auto;
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

// The owner tag on the dark metal row needs the darker on-surface ink to stay
// legible; the shared badge defaults to the lighter variant for paper surfaces.
const RowBadge = styled(OwnerBadge)`
	color: var(--color-on-surface);
`

const AddArea = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const AddLabel = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const AddList = styled.div`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-2xs);
`

const AddChip = styled.button`
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
	padding: var(--space-3xs) var(--space-2xs);
	border: 1px solid color-mix(in oklab, var(--color-on-surface) 14%, transparent);
	border-radius: var(--shape-2xs);
	background: transparent;
	color: var(--color-on-surface);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	cursor: pointer;

	&:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`
