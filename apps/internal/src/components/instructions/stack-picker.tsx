import { useLingui } from '@lingui/react/macro'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'

import { brushedMetalPlate } from '#/lib/workshop-mixins'
import { InstructionIconButton, OwnerBadge } from './instruction-chrome'

export type StackOption = {
	readonly id: string
	readonly name: string
	readonly ownerUserId: string | null
}

// Accessible reorderable multi-select: pick templates into an ordered stack and
// reorder them with keyboard-operable up/down buttons (no drag-drop). The order
// is the prompt order, so position matters. A live region narrates each change
// and focus is moved to follow the row a reorder/removal acts on, so a
// keyboard-only user never loses their place.
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
	const wrapRef = useRef<HTMLDivElement | null>(null)
	// After a reorder/removal the focused control changes position or vanishes;
	// remember what to focus once React has rendered the new order so focus is
	// never dropped to <body>.
	const pendingFocus = useRef<{ rowId: string; action: string } | null>(null)
	const [announcement, setAnnouncement] = useState('')

	const byId = new Map(options.map(o => [o.id, o]))
	const selected = selectedIds
		.map(id => byId.get(id))
		.filter((o): o is StackOption => o !== undefined)
	const available = options.filter(o => !selectedIds.includes(o.id))

	// biome-ignore lint/correctness/useExhaustiveDependencies: selectedIds is the intended trigger — the effect restores focus once the reordered list has re-rendered
	useEffect(() => {
		const target = pendingFocus.current
		pendingFocus.current = null
		if (!target || !wrapRef.current) return
		const el = wrapRef.current.querySelector<HTMLButtonElement>(
			`[data-row-id="${target.rowId}"] [data-action="${target.action}"]`,
		)
		el?.focus()
	}, [selectedIds])

	const move = (index: number, delta: number) => {
		const target = index + delta
		const movingId = selectedIds[index]
		const neighborId = selectedIds[target]
		if (movingId === undefined || neighborId === undefined) return
		const next = [...selectedIds]
		next[index] = neighborId
		next[target] = movingId
		const moved = byId.get(movingId)
		pendingFocus.current = {
			rowId: movingId,
			action: delta < 0 ? 'up' : 'down',
		}
		setAnnouncement(
			t`Moved ${moved?.name ?? ''} to position ${target + 1} of ${next.length}`,
		)
		onChange(next)
	}

	const remove = (id: string) => {
		const idx = selectedIds.indexOf(id)
		const next = selectedIds.filter(x => x !== id)
		const removed = byId.get(id)
		// Focus the row sliding into this slot, else the previous row; when the
		// list empties, let focus fall to the add area below.
		const neighbor = next[idx] ?? next[idx - 1] ?? null
		pendingFocus.current = neighbor
			? { rowId: neighbor, action: 'remove' }
			: null
		setAnnouncement(t`Removed ${removed?.name ?? ''}`)
		onChange(next)
	}

	return (
		<Wrap ref={wrapRef} data-testid='instruction-stack-picker'>
			<LiveRegion role='status' aria-live='polite'>
				{announcement}
			</LiveRegion>

			{selected.length === 0 ? (
				<EmptyNote>{t`No templates added yet.`}</EmptyNote>
			) : (
				<SelectedList role='list'>
					{selected.map((o, i) => {
						const atTop = i === 0
						const atBottom = i === selected.length - 1
						return (
							<SelectedRow
								key={o.id}
								data-row-id={o.id}
								aria-label={t`${o.name}, position ${i + 1} of ${selected.length}`}
							>
								<Position aria-hidden>{i + 1}</Position>
								<RowName>{o.name}</RowName>
								<RowBadge>{o.ownerUserId === null ? t`Org` : t`Mine`}</RowBadge>
								<InstructionIconButton
									type='button'
									data-action='up'
									aria-label={t`Move ${o.name} up`}
									aria-disabled={atTop}
									onClick={() => {
										if (!atTop) move(i, -1)
									}}
								>
									<ArrowUp size={14} aria-hidden />
								</InstructionIconButton>
								<InstructionIconButton
									type='button'
									data-action='down'
									aria-label={t`Move ${o.name} down`}
									aria-disabled={atBottom}
									onClick={() => {
										if (!atBottom) move(i, 1)
									}}
								>
									<ArrowDown size={14} aria-hidden />
								</InstructionIconButton>
								<InstructionIconButton
									type='button'
									data-action='remove'
									aria-label={t`Remove ${o.name}`}
									onClick={() => remove(o.id)}
								>
									<X size={14} aria-hidden />
								</InstructionIconButton>
							</SelectedRow>
						)
					})}
				</SelectedList>
			)}

			{available.length > 0 ? (
				<AddArea>
					<AddLabel>{t`Add a template`}</AddLabel>
					<AddList>
						{available.map(o => (
							<AddChip
								key={o.id}
								type='button'
								aria-label={t`Add ${o.name}`}
								onClick={() => onChange([...selectedIds, o.id])}
							>
								<Plus size={12} aria-hidden />
								<span>{o.name}</span>
								<OwnerBadge>
									{o.ownerUserId === null ? t`Org` : t`Mine`}
								</OwnerBadge>
							</AddChip>
						))}
					</AddList>
				</AddArea>
			) : null}
		</Wrap>
	)
}

const Wrap = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
`

// Visually hidden but read by screen readers; narrates reorder/removal.
const LiveRegion = styled.div`
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0 0 0 0);
	white-space: nowrap;
	border: 0;
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
