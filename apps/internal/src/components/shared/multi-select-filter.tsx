import { Trans, useLingui } from '@lingui/react/macro'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

import { PriCheckbox, PriInput, PriPopover } from '@batuda/ui/pri'

import { SrOnly } from '#/components/shared/sr-only'

export type MultiSelectOption = {
	readonly value: string
	readonly label: string
	// Absent where nothing counts the values — a list of colleagues, say, rather
	// than a menu built from the companies themselves.
	readonly count?: number
}

/**
 * A filter whose values are picked several at a time, from a list the server
 * counted.
 *
 * A dropdown could not do this — it gives back one value — and the stage strip
 * could not either: nine stages are a fixed vocabulary that fits on a line,
 * while tags are written by the organisation and there is no number of them
 * that is too many. So the list lives in a popover, with a box to narrow it once
 * there are more than a screenful.
 *
 * `countsStandAlone` says whether a number still means anything once its value is
 * ticked. For tags it does not — a ticked tag reports the whole current list,
 * every time — so those are hidden rather than shown as noise.
 */
export function MultiSelectFilter({
	label,
	options,
	selected,
	onToggle,
	onClear,
	testId,
	describeCount,
	countsStandAlone = false,
}: {
	readonly label: string
	readonly options: ReadonlyArray<MultiSelectOption>
	readonly selected: ReadonlyArray<string>
	// The value that was ticked, not the list it produces. Working out the next
	// list here would read the current one from this render, and two ticks inside
	// one navigation window would then both be built on the same stale list, so
	// the second would quietly undo the first.
	readonly onToggle: (value: string) => void
	readonly onClear: () => void
	readonly testId: string
	// The row's label names the checkbox, so the number beside it is read out
	// as part of that name, and a loose digit lands there attached to nothing.
	// The caller says what its numbers count, in one piece a translator can
	// reorder.
	readonly describeCount: (count: number) => string
	readonly countsStandAlone?: boolean
}) {
	const { t } = useLingui()
	const [filterText, setFilterText] = useState('')
	const [open, setOpen] = useState(false)

	// Which rows are shown, and in what order, is held still for as long as the
	// panel is open: ticking one value re-counts the rest, and under "all of them
	// have to match" most of those counts fall to zero, so the list would lose
	// most of itself and reorder the survivors under the reader's hand.
	//
	// Only the order is held, never the numbers — those are read from the live
	// list every render. Freezing them too would leave a reader ticking a tag
	// that says 3 and landing on 2, which is the one thing the counts are for.
	const frozenOrder = useRef<ReadonlyArray<string> | undefined>(undefined)
	// Written after the render is committed, never during it, so a render React
	// throws away cannot leave an order behind that nobody ever saw. An empty
	// list is not worth holding: the counts simply have not arrived yet, and
	// holding that would show "nothing matches" until the panel was reopened.
	useEffect(() => {
		if (!open) {
			setFilterText('')
			frozenOrder.current = undefined
			return
		}
		if (frozenOrder.current === undefined && options.length > 0)
			frozenOrder.current = options.map(option => option.value)
	}, [open, options])

	// The single chosen value, if there is exactly one, named as its menu names
	// it rather than as it is stored — a country code is not a country.
	const onlyChosen = useMemo(() => {
		if (selected.length !== 1) return undefined
		const value = selected[0] as string
		return (
			options.find(option => option.value === value) ?? { value, label: value }
		)
	}, [options, selected])

	const heldOptions = useMemo(() => {
		const order = open ? frozenOrder.current : undefined
		if (order === undefined) return options
		const live = new Map(options.map(option => [option.value, option]))
		// A value that has since gone from the counts keeps its place, reading
		// zero, rather than leaving a gap where the reader last saw it.
		return order.map(
			value => live.get(value) ?? { value, label: value, count: 0 },
		)
	}, [open, options])

	// A box to narrow the list is worth its own row only once the list is long
	// enough to scroll; below that it is one more thing between the reader and
	// the tag they can already see.
	const searchable = heldOptions.length > 8
	const visibleOptions = useMemo(() => {
		const term = filterText.trim().toLowerCase()
		if (term === '') return heldOptions
		return heldOptions.filter(option =>
			option.label.toLowerCase().includes(term),
		)
	}, [heldOptions, filterText])

	return (
		<PriPopover.Root open={open} onOpenChange={setOpen}>
			<Trigger data-testid={testId}>
				<TriggerLabel>
					{/* One value takes the control's place, several are counted beside it.
					 * These sit several to a line, so there is room for the name of the
					 * control or the name of one value but not both — and which value is
					 * narrowing the list is the more useful of the two. The control keeps
					 * its own name for anyone listening. */}
					{onlyChosen !== undefined ? (
						<>
							<SrOnly>{label}</SrOnly>
							<TriggerValue>{onlyChosen.label}</TriggerValue>
						</>
					) : (
						<>
							{label}
							{selected.length > 1 ? (
								<>
									{/* A bare digit beside a word reads as nothing at all when
									 * spoken; the sentence beside it is what a listener gets. */}
									<Badge aria-hidden>{selected.length}</Badge>
									<SrOnly>{t`${selected.length} selected`}</SrOnly>
								</>
							) : null}
						</>
					)}
				</TriggerLabel>
				<ChevronsUpDown size={14} aria-hidden />
			</Trigger>
			<PriPopover.Portal>
				<PriPopover.Positioner sideOffset={6}>
					{/* Named, because the panel is a dialog and would otherwise be
					 * announced as an unlabelled one. */}
					<PriPopover.Popup aria-label={label}>
						<Panel>
							{searchable ? (
								<SearchWrap>
									<SearchIcon>
										<Search size={14} aria-hidden />
									</SearchIcon>
									{/* Deliberately not a search box: Escape in one of those
									 * clears the field and closes the panel in the same press,
									 * so the key would mean two things at once. */}
									<PriInput
										type='text'
										value={filterText}
										onChange={event => setFilterText(event.target.value)}
										placeholder={t`Narrow this list…`}
										// Not "narrow the list of ${label}": the panel around it already
										// carries that name, and dropping a translated noun into an
										// English frame leaves a translator no room for gender or order.
										aria-label={t`Narrow this list`}
										style={{
											paddingLeft: 'calc(var(--space-xs) * 2 + 14px)',
										}}
										data-testid={`${testId}-search`}
									/>
								</SearchWrap>
							) : null}
							{visibleOptions.length === 0 ? (
								<Empty>{t`Nothing matches`}</Empty>
							) : (
								<List>
									{visibleOptions.map(option => {
										const isChosen = selected.includes(option.value)
										return (
											// One control per row, not a checkbox beside a button:
											// the checkbox draws its name from this label, and a
											// second control would be a nameless tab stop next to a
											// stateless one — twice the keys, half the meaning.
											<Row key={option.value}>
												<PriCheckbox.Root
													checked={isChosen}
													onCheckedChange={() => onToggle(option.value)}
													data-testid={`${testId}-option-${option.value}`}
												>
													<PriCheckbox.Indicator>
														<Check size={12} aria-hidden />
													</PriCheckbox.Indicator>
												</PriCheckbox.Root>
												<RowName>{option.label}</RowName>
												{option.count !== undefined &&
												(countsStandAlone || !isChosen) ? (
													<>
														{/* The label names the checkbox, so every word inside
														 * it is read out as part of that name. A loose "14"
														 * lands there as a number with nothing attached;
														 * these words say what it counts. */}
														<RowCount aria-hidden>{option.count}</RowCount>
														<SrOnly>{describeCount(option.count)}</SrOnly>
													</>
												) : null}
											</Row>
										)
									})}
								</List>
							)}
							{selected.length > 0 ? (
								<ClearRow>
									<ClearButton
										type='button'
										onClick={onClear}
										data-testid={`${testId}-clear`}
									>
										<Trans>Clear</Trans>
									</ClearButton>
								</ClearRow>
							) : null}
						</Panel>
					</PriPopover.Popup>
				</PriPopover.Positioner>
			</PriPopover.Portal>
		</PriPopover.Root>
	)
}

// ── Styles ───────────────────────────────────────────────────────

// Shaped after PriSelect's trigger so the filter bar reads as one row of
// controls rather than a dropdown next to something else.
const Trigger = styled(PriPopover.Trigger).withConfig({
	displayName: 'MultiSelectFilterTrigger',
})`
	position: relative;
	display: inline-flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-sm);
	background: linear-gradient(
		145deg,
		var(--color-metal-light) 0%,
		var(--color-metal) 50%,
		var(--color-metal-dark) 100%
	);
	border: 1px solid var(--color-metal-edge);
	border-radius: var(--shape-2xs);
	box-shadow: var(--elevation-workshop-sm);
	font-family: var(--font-display);
	font-size: var(--typescale-label-large-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface);
	text-shadow: var(--text-shadow-emboss);
	cursor: pointer;

	&:hover:not(:disabled) {
		box-shadow: var(--elevation-workshop-md);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const TriggerLabel = styled.span`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

// The chosen value, standing where the control's name would be.
const TriggerValue = styled.span.withConfig({
	displayName: 'MultiSelectFilterTriggerValue',
})`
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--color-primary);
`

const Badge = styled.span`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 1.25rem;
	padding: 0 var(--space-3xs);
	background: var(--color-primary);
	color: var(--color-on-primary);
	border-radius: var(--shape-full);
	font-size: var(--typescale-label-small-size);
`

const Panel = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	min-width: 14rem;
	max-width: 20rem;
`

const SearchWrap = styled.div`
	position: relative;
	display: flex;
	align-items: center;
`

const SearchIcon = styled.span`
	position: absolute;
	left: var(--space-xs);
	display: inline-flex;
	color: var(--color-on-surface-variant);
	pointer-events: none;
	z-index: 2;
`

const List = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	max-height: 16rem;
	overflow-y: auto;
`

// A real <label> wrapping the checkbox: that is where the checkbox takes its
// name from, and it makes the whole row the target rather than a 20px square.
const Row = styled.label`
	display: flex;
	align-items: center;
	gap: var(--space-xs);
	padding: var(--space-3xs) 0;
	min-height: 1.5rem;
	cursor: pointer;
`

const RowName = styled.span`
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font: var(--type-body-medium);
	color: var(--color-on-surface);
`

// Full-strength ink, not the muted variant: at this size, against the darkest
// corner of the panel's metal gradient, the muted one measures 3.6:1 and misses
// the 4.5:1 a small label has to meet.
const RowCount = styled.span`
	flex: 0 0 auto;
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface);
	font-variant-numeric: tabular-nums;
`

const ClearRow = styled.div`
	display: flex;
	justify-content: flex-end;
	padding-top: var(--space-3xs);
	border-top: 1px solid var(--color-outline-variant);
`

// Undoing five tags one at a time is five toggles, each re-counting the rest.
const ClearButton = styled.button`
	padding: var(--space-3xs) var(--space-2xs);
	background: none;
	border: none;
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-primary);
	cursor: pointer;

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const Empty = styled.p`
	margin: 0;
	padding: var(--space-2xs) 0;
	font: var(--type-body-small);
	color: var(--color-on-surface-variant);
`
