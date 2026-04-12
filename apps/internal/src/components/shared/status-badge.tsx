import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import styled from 'styled-components'

import { PriTooltip } from '@engranatge/ui/pri'

import { brushedMetalPlate, stenciledTitle } from '#/lib/workshop-mixins'

/**
 * Stamped-metal status tag. The chrome is a brushed-metal gradient with a
 * thick left rule tinted by `--color-status-*`, so the status palette
 * still reads at a glance without swamping the workshop chrome. Label is
 * embossed display-font uppercase. Wrapped in `PriTooltip` for the
 * long-press / hover explanation of the abbreviated status.
 */
export type CompanyStatus =
	| 'prospect'
	| 'contacted'
	| 'responded'
	| 'meeting'
	| 'proposal'
	| 'client'
	| 'closed'
	| 'dead'

const statusLabels: Record<CompanyStatus, MessageDescriptor> = {
	prospect: msg`Prospect`,
	contacted: msg`Contacted`,
	responded: msg`Responded`,
	meeting: msg`Meeting`,
	proposal: msg`Proposal`,
	client: msg`Client`,
	closed: msg`Closed`,
	dead: msg`Dead`,
}

const statusDescriptions: Record<CompanyStatus, MessageDescriptor> = {
	prospect: msg`Cold lead — no contact yet`,
	contacted: msg`First outreach sent`,
	responded: msg`They replied — keep the thread warm`,
	meeting: msg`Meeting booked`,
	proposal: msg`Proposal in review`,
	client: msg`Active client`,
	closed: msg`Closed — won or lost`,
	dead: msg`Archived — not pursuing`,
}

const statusTokens: Record<CompanyStatus, string> = {
	prospect: 'var(--color-status-prospect)',
	contacted: 'var(--color-status-contacted)',
	responded: 'var(--color-status-responded)',
	meeting: 'var(--color-status-meeting)',
	proposal: 'var(--color-status-proposal)',
	client: 'var(--color-status-client)',
	closed: 'var(--color-status-closed)',
	dead: 'var(--color-status-dead)',
}

export function asCompanyStatus(value: string): CompanyStatus {
	return value in statusTokens ? (value as CompanyStatus) : 'prospect'
}

export function StatusBadge({
	status,
	size = 'sm',
}: {
	status: CompanyStatus | string
	size?: 'sm' | 'lg'
}) {
	const { i18n } = useLingui()
	const normalized = asCompanyStatus(
		typeof status === 'string' ? status : 'prospect',
	)
	return (
		<PriTooltip.Provider delay={400}>
			<PriTooltip.Root>
				<PriTooltip.Trigger render={<Tag $status={normalized} $size={size} />}>
					{i18n._(statusLabels[normalized])}
				</PriTooltip.Trigger>
				<PriTooltip.Portal>
					<PriTooltip.Positioner side='top' sideOffset={6}>
						<PriTooltip.Popup>
							{i18n._(statusDescriptions[normalized])}
						</PriTooltip.Popup>
					</PriTooltip.Positioner>
				</PriTooltip.Portal>
			</PriTooltip.Root>
		</PriTooltip.Provider>
	)
}

const Tag = styled.span.withConfig({
	displayName: 'StatusBadgeTag',
	shouldForwardProp: prop => prop !== '$status' && prop !== '$size',
})<{ $status: CompanyStatus; $size: 'sm' | 'lg' }>`
	${brushedMetalPlate}
	${stenciledTitle}
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
	padding: ${p =>
		p.$size === 'lg'
			? 'var(--space-2xs) var(--space-md) var(--space-2xs) calc(var(--space-md) + 4px)'
			: 'var(--space-3xs) var(--space-sm) var(--space-3xs) calc(var(--space-sm) + 4px)'};
	border-left: 4px solid ${p => statusTokens[p.$status]};
	border-radius: var(--shape-2xs);
	white-space: nowrap;
	transform: rotate(-0.5deg);
	font-size: ${p =>
		p.$size === 'lg'
			? 'var(--typescale-label-medium-size)'
			: 'var(--typescale-label-small-size)'};
	line-height: ${p =>
		p.$size === 'lg'
			? 'var(--typescale-label-medium-line)'
			: 'var(--typescale-label-small-line)'};
`
