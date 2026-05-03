import { Trans } from '@lingui/react/macro'

import {
	type CommonFindings,
	CommonSections,
	EmptyHint,
	Sections,
} from './shared'

/**
 * Renders a `freeform` research finding. Per the schema at
 * `packages/research/src/application/schemas/freeform.ts`, freeform
 * carries only the cross-cutting arrays (proposed_updates,
 * pending_paid_actions). Typed schemas (company-enrichment,
 * competitor-scan, contact-discovery, prospect-scan) live in their
 * own *-view files alongside this one.
 */

export function FreeformView({
	findings,
}: {
	readonly findings: CommonFindings | null | undefined
}) {
	const proposed = findings?.proposedUpdates ?? []
	const paid = findings?.pendingPaidActions ?? []
	const existing = findings?.discoveredExisting ?? []

	if (proposed.length === 0 && paid.length === 0 && existing.length === 0) {
		return (
			<EmptyHint>
				<Trans>
					The run finished without proposed updates or paid actions.
				</Trans>
			</EmptyHint>
		)
	}

	return (
		<Sections>
			<CommonSections findings={findings} />
		</Sections>
	)
}
