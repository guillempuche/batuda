import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import styled from 'styled-components'

import { PriTooltip } from '@engranatge/ui/pri'

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

const priorityLabels: Record<1 | 2 | 3, MessageDescriptor> = {
	1: msg`High priority`,
	2: msg`Medium priority`,
	3: msg`Low priority`,
}

const Rivet = styled.span.withConfig({
	displayName: 'PriorityDotRivet',
	shouldForwardProp: prop => prop !== '$priority',
})<{ $priority: 1 | 2 | 3 }>`
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
			p.$priority === 1
				? '0 0 6px 0 var(--color-error), 0 0 0 1px rgba(233, 84, 32, 0.5)'
				: '0 1px 2px rgba(0, 0, 0, 0.3)'};
`
