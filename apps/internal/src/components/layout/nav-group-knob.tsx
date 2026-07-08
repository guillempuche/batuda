import { useLingui } from '@lingui/react/macro'
import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import styled from 'styled-components'

import { PriPopover } from '@batuda/ui/pri'

import { MachineButton } from './machine-button'
import type { NavGroup } from './nav-items'
import { navGroupActive } from './nav-match'

/**
 * A single mobile belt slot that stands for several sections. The knob
 * carries the group's own dome cap and lights up when the current route is
 * one of its members; tapping it opens a small popover above the belt that
 * lists the members as links. Selecting one navigates and closes the
 * popover (closed on route change so the timing never leaves it hanging
 * open over the new page).
 */
export function NavGroupKnob({ group }: { readonly group: NavGroup }) {
	const { i18n, t } = useLingui()
	const [open, setOpen] = useState(false)
	const pathname = useRouterState({
		select: state => state.location.pathname,
	})
	const active = navGroupActive(pathname, group)
	const groupLabel = i18n._(group.label)
	const Icon = group.icon

	// Close on navigation — a tapped link changes the route but keeps the
	// belt (and this popover) mounted, so nothing else would dismiss it.
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger, not a value read inside — the effect exists to fire on route change.
	useEffect(() => {
		setOpen(false)
	}, [pathname])

	return (
		<PriPopover.Root open={open} onOpenChange={setOpen}>
			<PriPopover.Trigger
				render={props => (
					<KnobButton
						type='button'
						aria-label={groupLabel}
						data-testid={`nav-${group.testId}`}
						{...props}
					>
						<MachineButton
							icon={Icon}
							label={groupLabel}
							color={group.color}
							active={active}
							size='compact'
						/>
					</KnobButton>
				)}
			/>
			<PriPopover.Portal>
				<PriPopover.Positioner side='top' align='center' sideOffset={8}>
					<PriPopover.Popup>
						<GroupList aria-label={t`${groupLabel} sections`}>
							{group.items.map(item => {
								const MemberIcon = item.icon
								const memberLabel = i18n._(item.label)
								return (
									<li key={item.path}>
										<GroupLink
											to={item.path}
											activeOptions={{ exact: Boolean(item.exact) }}
											activeProps={{ 'aria-current': 'page' }}
											data-testid={`nav-${item.testId}`}
										>
											<MemberIcon size={18} aria-hidden />
											<span>{memberLabel}</span>
										</GroupLink>
									</li>
								)
							})}
						</GroupList>
					</PriPopover.Popup>
				</PriPopover.Positioner>
			</PriPopover.Portal>
		</PriPopover.Root>
	)
}

const KnobButton = styled.button.withConfig({
	displayName: 'NavGroupKnobButton',
})`
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 0;
	background: none;
	border: none;
	cursor: pointer;
	border-radius: var(--shape-full);

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 4px;
	}
`

const GroupList = styled.ul.withConfig({ displayName: 'NavGroupList' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	min-width: 11rem;
	margin: 0;
	padding: 0;
	list-style: none;
`

const GroupLink = styled(Link).withConfig({ displayName: 'NavGroupLink' })`
	display: flex;
	align-items: center;
	gap: var(--space-sm);
	padding: var(--space-2xs) var(--space-sm);
	border-radius: var(--shape-2xs);
	color: var(--color-on-surface);
	text-decoration: none;
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);

	&:hover {
		background: color-mix(in srgb, var(--color-primary) 8%, transparent);
	}

	&[data-status='active'] {
		background: color-mix(in srgb, var(--color-primary) 14%, transparent);
		font-weight: var(--font-weight-bold);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`
