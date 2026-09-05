import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'
import {
	AlertCircle,
	AlertTriangle,
	Check,
	GitMerge,
	Minus,
} from 'lucide-react'
import { styled } from 'next-yak'
import type { ComponentType } from 'react'

import { Badge } from './badge'
import { outcomeTone, type ProposalOutcome, type Tone } from './proposal-logic'

/**
 * Badge for the result of applying or rejecting one proposal. Every outcome
 * the backend can return — success, a merge into a duplicate, a stale-record
 * conflict, a validation failure — gets its own plain-language label and
 * colour, so a mixed batch reads at a glance.
 */

type IconComponent = ComponentType<{ size?: number | string }>

const OUTCOME_LABEL: Record<ProposalOutcome, MessageDescriptor> = {
	applied: msg`Applied`,
	created: msg`Created`,
	duplicate: msg`Merged into existing`,
	rejected: msg`Rejected`,
	conflict: msg`Record changed since research`,
	invalid: msg`Invalid`,
	no_applicable_fields: msg`Nothing to apply`,
	run_not_found: msg`Run not found`,
	proposal_not_found: msg`Already resolved`,
	error: msg`Error`,
}

const TONE_ICON: Record<Tone, IconComponent> = {
	positive: Check,
	info: GitMerge,
	caution: AlertTriangle,
	negative: AlertCircle,
	neutral: Minus,
}

export function OutcomeBadge({
	outcome,
	reason,
}: {
	readonly outcome: ProposalOutcome
	readonly reason?: string | null
}) {
	const { i18n } = useLingui()
	const tone = outcomeTone(outcome)
	const Icon = TONE_ICON[tone]

	return (
		<Wrap>
			<Badge
				$tone={tone}
				data-testid='research-outcome-badge'
				data-outcome={outcome}
			>
				<Icon size={12} aria-hidden />
				<span>{i18n._(OUTCOME_LABEL[outcome])}</span>
			</Badge>
			{reason !== undefined && reason !== null && reason !== '' ? (
				<Reason title={reason}>{reason}</Reason>
			) : null}
		</Wrap>
	)
}

const Wrap = styled.span`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	flex-wrap: wrap;
`

const Reason = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	max-width: 24ch;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`
