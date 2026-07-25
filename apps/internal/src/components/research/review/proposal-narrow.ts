import {
	normalizeConfidence,
	type TrustSignal,
	verdictRank,
} from '#/components/research/proposal-logic'

/**
 * The per-run `listProposedUpdates` endpoint returns `Schema.Unknown`, so the
 * review screen runtime-narrows it here. Unlike the cross-run inbox query,
 * this carries the full `fields` a reviewer needs to see (name, channels,
 * scalar values) plus each proposal's `status`, so applied/rejected items can
 * be shown as already resolved.
 */

export type ReviewChannel = {
	readonly kind: string
	readonly value: string
	readonly verification: string | null
	readonly confidence: number | null
	readonly isPrimary: boolean
}

export type ReviewProposal = {
	readonly id: string
	readonly status: string
	readonly operation: string
	readonly subjectTable: string | null
	readonly subjectId: string | null
	readonly expectedVersion: number | null
	readonly reason: string | null
	readonly name: string | null
	readonly channels: ReadonlyArray<ReviewChannel>
	readonly scalarFields: ReadonlyArray<readonly [string, string]>
	readonly citations: ReadonlyArray<{
		readonly sourceId: string
		readonly quote: string | null
	}>
}

// Field keys rendered specially (or hidden), so they don't repeat in the
// generic scalar-diff table: `name` heads the row, `channels` render as
// trust-badged contact points, the owning company is an internal link the
// reviewer doesn't act on. The model writes these names itself, so the same
// reference turns up spelled either way and both are listed.
const SPECIAL_FIELDS = new Set(['name', 'channels', 'company_id', 'companyId'])

// Turns a field name into something a reviewer reads: "is_decision_maker"
// becomes "Is decision maker". The words come from the data rather than a fixed
// phrase, so there is nothing to translate — only the spelling to tidy up.
const fieldLabel = (key: string): string => {
	const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ')
	return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
}

export function narrowProposedUpdates(
	rows: ReadonlyArray<unknown>,
): ReadonlyArray<ReviewProposal> {
	const out: Array<ReviewProposal> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		const fields =
			r['fields'] && typeof r['fields'] === 'object'
				? (r['fields'] as Record<string, unknown>)
				: {}
		out.push({
			id: r['id'],
			status: typeof r['status'] === 'string' ? r['status'] : 'pending',
			operation: typeof r['operation'] === 'string' ? r['operation'] : 'update',
			subjectTable:
				typeof r['subject_table'] === 'string' ? r['subject_table'] : null,
			subjectId: typeof r['subject_id'] === 'string' ? r['subject_id'] : null,
			expectedVersion:
				typeof r['expected_version'] === 'number'
					? r['expected_version']
					: null,
			reason: typeof r['reason'] === 'string' ? r['reason'] : null,
			name: typeof fields['name'] === 'string' ? fields['name'] : null,
			channels: narrowChannels(fields['channels']),
			scalarFields: narrowScalarFields(fields),
			citations: narrowCitations(r['citations']),
		})
	}
	return out
}

function narrowChannels(raw: unknown): ReadonlyArray<ReviewChannel> {
	if (!Array.isArray(raw)) return []
	const out: Array<ReviewChannel> = []
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue
		const c = item as Record<string, unknown>
		if (typeof c['kind'] !== 'string' || typeof c['value'] !== 'string')
			continue
		out.push({
			kind: c['kind'],
			value: c['value'],
			verification:
				typeof c['verification'] === 'string' ? c['verification'] : null,
			confidence: normalizeConfidence(
				typeof c['confidence'] === 'number' ? c['confidence'] : null,
			),
			isPrimary: c['is_primary'] === true,
		})
	}
	return out
}

function narrowScalarFields(
	fields: Record<string, unknown>,
): ReadonlyArray<readonly [string, string]> {
	const out: Array<readonly [string, string]> = []
	for (const [key, value] of Object.entries(fields)) {
		if (SPECIAL_FIELDS.has(key)) continue
		if (value === null || value === undefined) continue
		out.push([
			fieldLabel(key),
			typeof value === 'string' ? value : JSON.stringify(value),
		])
	}
	return out
}

function narrowCitations(
	raw: unknown,
): ReadonlyArray<{ readonly sourceId: string; readonly quote: string | null }> {
	if (!Array.isArray(raw)) return []
	const out: Array<{ sourceId: string; quote: string | null }> = []
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue
		const c = item as Record<string, unknown>
		if (typeof c['source_id'] !== 'string') continue
		out.push({
			sourceId: c['source_id'],
			quote: typeof c['quote'] === 'string' ? c['quote'] : null,
		})
	}
	return out
}

/**
 * The trust signal to badge a whole proposal with — taken from its
 * best-verdict email/phone channel (the reviewer cares most about "is the
 * strongest contact point verified"). A proposal with no channels (a plain
 * field update) carries no machine-checkable signal.
 */
export function strongestChannelTrust(
	channels: ReadonlyArray<ReviewChannel>,
): TrustSignal {
	const machineCheckable = channels.some(
		c => c.kind === 'email' || c.kind === 'phone',
	)
	let best: ReviewChannel | null = null
	for (const channel of channels) {
		if (channel.kind !== 'email' && channel.kind !== 'phone') continue
		if (
			best === null ||
			verdictRank(channel.verification) < verdictRank(best.verification)
		) {
			best = channel
		}
	}
	return {
		verification: best?.verification ?? null,
		confidence: best?.confidence ?? null,
		machineCheckable,
	}
}
