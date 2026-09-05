import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { styled } from 'next-yak'

import { PriTooltip } from '@batuda/ui/pri'

/**
 * 10px screw/rivet. Priority 1 (hot) gets a warm outer glow via the
 * error token; priority 2 stays neutral metal; priority 3 reads slightly
 * colder. Wrapped in `PriTooltip` for the accessible explanation.
 *
 * Returns `null` for nullish input so callers don't need to guard.
 */
export function PriorityDot({
	priority,
}: {
	priority: number | null | undefined
}) {
	const { i18n } = useLingui()
	if (priority !== 1 && priority !== 2 && priority !== 3) return null
	return (
		<PriTooltip.Provider delay={400}>
			<PriTooltip.Root>
				<PriTooltip.Trigger
					render={
						<Rivet
							$priority={priority}
							role='img'
							aria-label={i18n._(priorityLabels[priority])}
						/>
					}
				/>
				<PriTooltip.Portal>
					<PriTooltip.Positioner side='top' sideOffset={6}>
						<PriTooltip.Popup>
							{i18n._(priorityLabels[priority])}
						</PriTooltip.Popup>
					</PriTooltip.Positioner>
				</PriTooltip.Portal>
			</PriTooltip.Root>
		</PriTooltip.Provider>
	)
}

export const PRIORITY_LEVELS = [1, 2, 3] as const
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number]

/** Reads on its own — for a tooltip or a spoken label. */
export const priorityLabels: Record<PriorityLevel, MessageDescriptor> = {
	1: msg`High priority`,
	2: msg`Medium priority`,
	3: msg`Low priority`,
}

/**
 * For a control that already says "Priority" beside it. Both maps live here so
 * the filter and the picker cannot drift into calling the same stored number
 * different things, which is how one screen came to say "Hot" and another "High".
 */
export const priorityShortLabels: Record<PriorityLevel, MessageDescriptor> = {
	1: msg`High`,
	2: msg`Medium`,
	3: msg`Low`,
}

const Rivet = styled.span<{ $priority: 1 | 2 | 3 }>`
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
	border: 1px solid var(--color-metal-edge-strong);
	box-shadow:
		inset 0 -1px 0 var(--shadow-color-deep),
		inset 0 1px 0 var(--highlight-inset-strong),
		${p =>
			p.$priority === 1
				? '0 0 6px 0 var(--color-error), 0 0 0 1px var(--color-priority-urgent-glow)'
				: '0 1px 2px var(--shadow-color-deep)'};
`
