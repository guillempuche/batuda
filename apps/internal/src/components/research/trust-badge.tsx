import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'
import {
	Shield,
	ShieldAlert,
	ShieldCheck,
	ShieldQuestion,
	ShieldX,
} from 'lucide-react'
import { styled } from 'next-yak'
import type { ComponentType } from 'react'

import { Badge } from './badge'
import { verdictTone } from './proposal-logic'

/**
 * "Confirmed vs guessed" badge for a discovered value. Shows the email
 * deliverability verdict and, when present, the confidence score — so a
 * person can tell a verified email from an unverified guess before it
 * enters the CRM. A value with no verdict at all reads as "Unverified".
 */

type IconComponent = ComponentType<{ size?: number | string }>

const VERDICT_LABEL: Record<string, MessageDescriptor> = {
	deliverable: msg`Confirmed`,
	risky: msg`Risky`,
	catch_all: msg`Catch-all`,
	undeliverable: msg`Undeliverable`,
	unknown: msg`Unverified`,
}

const VERDICT_ICON: Record<string, IconComponent> = {
	deliverable: ShieldCheck,
	risky: ShieldAlert,
	catch_all: ShieldQuestion,
	undeliverable: ShieldX,
	unknown: Shield,
}

export function TrustBadge({
	verification,
	confidence,
	machineCheckable = false,
}: {
	readonly verification: string | null
	readonly confidence: number | null
	readonly machineCheckable?: boolean
}) {
	const { i18n } = useLingui()

	const label =
		verification !== null && verification in VERDICT_LABEL
			? i18n._(VERDICT_LABEL[verification] as MessageDescriptor)
			: i18n._(msg`Unverified`)
	const Icon =
		verification !== null && verification in VERDICT_ICON
			? (VERDICT_ICON[verification] as IconComponent)
			: Shield
	const tone = verdictTone(verification)

	return (
		<Badge
			$tone={tone}
			data-testid='research-trust-badge'
			data-verification={verification ?? 'none'}
			data-machine-checkable={machineCheckable}
		>
			<Icon size={12} aria-hidden />
			<span>{label}</span>
			{confidence !== null ? (
				<Confidence>{`${Math.round(confidence)}%`}</Confidence>
			) : null}
		</Badge>
	)
}

const Confidence = styled.span`
	font-family: var(--font-mono);
	font-variant-numeric: tabular-nums;
	opacity: 0.85;
`
