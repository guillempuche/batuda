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
	const proposed = findings?.proposed_updates ?? []
	const paid = findings?.pending_paid_actions ?? []
	const existing = findings?.discovered_existing ?? []
	// A run that needs reading says so even when it suggests nothing — that
	// warning is the one thing that must never be swallowed by an empty state.
	const needsReading = findings?.quality?.low_confidence === true

	if (
		proposed.length === 0 &&
		paid.length === 0 &&
		existing.length === 0 &&
		!needsReading
	) {
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
