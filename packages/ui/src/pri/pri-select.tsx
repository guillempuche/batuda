import { Select } from '@base-ui/react/select'
import type { ComponentProps } from 'react'
import styled from 'styled-components'

/**
 * Workshop-styled wrapper around Base UI's Select.
 */

const PriTrigger = styled(Select.Trigger).withConfig({
	displayName: 'PriSelectTrigger',
})`
	position: relative;
	display: inline-flex;
	align-items: center;
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
	transition:
		box-shadow 140ms ease,
		transform 140ms ease;

	&::before {
		content: '';
		position: absolute;
		inset: 0;
		background: var(--texture-brushed-metal);
		pointer-events: none;
		border-radius: inherit;
	}

	& > * {
		position: relative;
		z-index: 1;
	}

	&:hover:not(:disabled) {
		box-shadow: var(--elevation-workshop-md);
	}

	&:active:not(:disabled) {
		transform: translateY(1px);
		box-shadow: var(--elevation-workshop-sm);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const PriPopup = styled(Select.Popup).withConfig({
	displayName: 'PriSelectPopup',
})`
	position: relative;
	/* Never narrower than the selector, or the options read as belonging to
	 * something else; never wider than the screen has room for, or the longest
	 * option would open off the edge. */
	min-width: var(--anchor-width);
	max-width: var(--available-width);
	box-sizing: border-box;
	background-color: var(--color-metal);
	background-image:
		var(--texture-brushed-metal),
		linear-gradient(
			145deg,
			var(--color-metal-light) 0%,
			var(--color-metal) 55%,
			var(--color-metal-dark) 100%
		);
	border: 1px solid var(--color-metal-edge);
	border-radius: var(--shape-2xs);
	padding: var(--space-2xs);
	box-shadow: var(--elevation-workshop-lg);
	transform-origin: var(--transform-origin);
	transition:
		transform 160ms ease,
		opacity 160ms ease;

	&::before {
		content: '';
		position: absolute;
		top: 5px;
		left: 5px;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: radial-gradient(
			circle at 35% 35%,
			var(--color-metal-light),
			var(--color-metal-deep)
		);
		box-shadow: inset 0 -1px 0 var(--shadow-color-deep);
		pointer-events: none;
	}

	&::after {
		content: '';
		position: absolute;
		top: 5px;
		right: 5px;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: radial-gradient(
			circle at 35% 35%,
			var(--color-metal-light),
			var(--color-metal-deep)
		);
		box-shadow: inset 0 -1px 0 var(--shadow-color-deep);
		pointer-events: none;
	}

	&[data-starting-style],
	&[data-ending-style] {
		opacity: 0;
		transform: scale(0.96);
	}
`

const PriItem = styled(Select.Item).withConfig({
	displayName: 'PriSelectItem',
})`
	position: relative;
	z-index: 1;
	display: flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-sm);
	/* Only the chosen option carries a tick, so the room for one is kept on
	 * every row — otherwise the names would not line up. */
	padding-inline-start: calc(var(--space-sm) + 1rem + var(--space-2xs));
	border-radius: var(--shape-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-medium-size);
	font-weight: var(--font-weight-medium);
	letter-spacing: 0.05em;
	text-transform: uppercase;
	color: var(--color-on-surface);
	text-shadow: var(--text-shadow-emboss);
	cursor: pointer;
	user-select: none;
	outline: none;
	/* Let a long option (a member name, an industry) grow the popup instead of
	 * wrapping to two cramped lines. */
	white-space: nowrap;

	&[data-highlighted] {
		background: color-mix(in srgb, var(--color-highlight-amber), transparent);
		box-shadow: var(--glow-active);
	}
`

const PriItemIndicator = styled(Select.ItemIndicator).withConfig({
	displayName: 'PriSelectItemIndicator',
})`
	/* Sits in the room the row keeps for it, outside the row's own layout, so
	 * only the name decides how wide the list opens. */
	position: absolute;
	inset-inline-start: var(--space-sm);
	top: 0;
	bottom: 0;
	width: 1rem;
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--color-primary);
`

// Base UI only makes a select scroll when it draws the popup over the trigger.
// `PriOptions` opens below it instead, where nothing bounds the height, so a
// long list runs off the bottom of the screen with its last items out of reach.
// Capping the list rather than the frame keeps the frame's corners where they
// are while the items scroll.
const PriList = styled(Select.List).withConfig({
	displayName: 'PriSelectList',
})`
	display: block;
	max-height: min(20rem, var(--available-height));
	overflow-y: auto;
	overscroll-behavior: contain;
`

const PriItemText = styled(Select.ItemText).withConfig({
	displayName: 'PriSelectItemText',
})`
	/* Once the list has grown as wide as it may, a name too long for it trails
	 * off; the zero minimum is what lets it shrink inside the row at all. */
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
`

const PriGroupLabel = styled(Select.GroupLabel).withConfig({
	displayName: 'PriSelectGroupLabel',
})`
	padding: var(--space-3xs) var(--space-sm);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
	text-shadow: var(--text-shadow-emboss);
	border-bottom: 1px solid color-mix(in srgb, var(--color-on-surface) 18%, transparent);
`

const PriSeparator = styled(Select.Separator).withConfig({
	displayName: 'PriSelectSeparator',
})`
	height: 1px;
	margin: var(--space-3xs) 0;
	background: linear-gradient(
		to right,
		transparent 0%,
		color-mix(in srgb, var(--color-on-surface) 22%, transparent) 50%,
		transparent 100%
	);
	border: none;
`

// Hidden until Base UI sets `data-visible`; consumer slots in the icon.
const PriScrollUpArrow = styled(Select.ScrollUpArrow).withConfig({
	displayName: 'PriSelectScrollUpArrow',
})`
	position: absolute;
	top: 0;
	left: 0;
	right: 0;
	z-index: 2;
	display: none;
	align-items: center;
	justify-content: center;
	height: 1.5rem;
	color: var(--color-on-surface-variant);
	background: linear-gradient(
		to bottom,
		var(--color-metal-light) 0%,
		var(--color-metal) 60%,
		transparent 100%
	);
	pointer-events: none;

	&[data-visible] {
		display: flex;
		pointer-events: auto;
	}
`

const PriScrollDownArrow = styled(Select.ScrollDownArrow).withConfig({
	displayName: 'PriSelectScrollDownArrow',
})`
	position: absolute;
	bottom: 0;
	left: 0;
	right: 0;
	z-index: 2;
	display: none;
	align-items: center;
	justify-content: center;
	height: 1.5rem;
	color: var(--color-on-surface-variant);
	background: linear-gradient(
		to top,
		var(--color-metal-light) 0%,
		var(--color-metal) 60%,
		transparent 100%
	);
	pointer-events: none;

	&[data-visible] {
		display: flex;
		pointer-events: auto;
	}
`

// Drawn here rather than pulled from an icon set: this package ships to other
// projects, and one tick is not worth making every one of them install a
// library for.
function CheckMark() {
	return (
		<svg
			width='12'
			height='12'
			viewBox='0 0 24 24'
			fill='none'
			stroke='currentColor'
			strokeWidth='2'
			strokeLinecap='round'
			strokeLinejoin='round'
			aria-hidden='true'
		>
			<path d='M20 6 9 17l-5-5' />
		</svg>
	)
}

/**
 * The list half of a dropdown: the portal, the positioning, the popup and the
 * options inside it, which are the same everywhere and are the part that gets
 * copied when a new selector is written.
 *
 * A selector whose options need their own look keeps composing the pieces by
 * hand — this covers the ordinary case, not every case.
 */
function PriOptions<T extends string>({
	items,
	optionTestId,
	...positioner
}: ComponentProps<typeof Select.Positioner> & {
	readonly items: ReadonlyArray<{ readonly value: T; readonly label: string }>
	// Each option needs its own hook for tests to press, since a popup that
	// lives outside the trigger cannot be driven the way a plain select is.
	readonly optionTestId?: (value: T) => string
}) {
	return (
		<Select.Portal>
			<Select.Positioner
				alignItemWithTrigger={false}
				sideOffset={6}
				{...positioner}
			>
				<PriPopup>
					<PriList>
						{items.map(item => (
							<PriItem
								key={item.value}
								value={item.value}
								{...(optionTestId
									? { 'data-testid': optionTestId(item.value) }
									: {})}
							>
								<PriItemIndicator>
									<CheckMark />
								</PriItemIndicator>
								<PriItemText>{item.label}</PriItemText>
							</PriItem>
						))}
					</PriList>
				</PriPopup>
			</Select.Positioner>
		</Select.Portal>
	)
}

export const PriSelect = {
	Root: Select.Root,
	Options: PriOptions,
	Portal: Select.Portal,
	Backdrop: Select.Backdrop,
	Positioner: Select.Positioner,
	Popup: PriPopup,
	Arrow: Select.Arrow,
	ScrollUpArrow: PriScrollUpArrow,
	ScrollDownArrow: PriScrollDownArrow,
	Trigger: PriTrigger,
	Value: Select.Value,
	Icon: Select.Icon,
	Label: Select.Label,
	List: PriList,
	Group: Select.Group,
	GroupLabel: PriGroupLabel,
	Separator: PriSeparator,
	Item: PriItem,
	ItemText: PriItemText,
	ItemIndicator: PriItemIndicator,
}
