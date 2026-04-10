import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import styled from 'styled-components'

/**
 * Pipeline status pill using the `--color-status-*` tokens from
 * `forja-tokens.css`. The transient `$status` prop is typed against
 * the exact enum values stored in the `companies.status` column (see
 * `packages/domain/src/schema/companies.ts`).
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

/** Normalize any string into a known status, falling back to `prospect`. */
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
		<Pill $status={normalized} $size={size}>
			{i18n._(statusLabels[normalized])}
		</Pill>
	)
}

const Pill = styled.span.withConfig({
	displayName: 'StatusBadge',
	shouldForwardProp: prop => prop !== '$status' && prop !== '$size',
})<{ $status: CompanyStatus; $size: 'sm' | 'lg' }>`
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
	background: ${p => statusTokens[p.$status]};
	color: var(--color-on-status);
	border-radius: var(--shape-full);
	font-family: var(--font-body);
	font-weight: var(--font-weight-medium);
	text-transform: uppercase;
	letter-spacing: var(--typescale-label-small-tracking);
	white-space: nowrap;
	padding: ${p => (p.$size === 'lg' ? 'var(--space-2xs) var(--space-md)' : 'var(--space-3xs) var(--space-sm)')};
	font-size: ${p =>
		p.$size === 'lg'
			? 'var(--typescale-label-medium-size)'
			: 'var(--typescale-label-small-size)'};
	line-height: ${p =>
		p.$size === 'lg'
			? 'var(--typescale-label-medium-line)'
			: 'var(--typescale-label-small-line)'};
`
