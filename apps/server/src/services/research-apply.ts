import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg } from '@batuda/controllers'

import { forkCompanyRegeocode } from './company-geocoding'

/**
 * Apply (or reject) a research-proposed CRM update — the one place a research
 * run's suggestion is written back onto a company or contact row.
 *
 * A research run records suggested field changes in its findings as "proposed
 * updates", each awaiting human review. Applying one writes the suggested fields
 * onto the target row under optimistic concurrency control: the write only lands
 * if the row's `version` still matches the version the run saw, so a proposal
 * made against a since-changed row is rejected as a conflict instead of
 * clobbering newer data. The MCP tool `resolve_research_proposed_update` and the
 * HTTP apply/reject endpoints both go through here, so the two transports stay
 * identical.
 */

// Only these columns can be set by an applied proposal — never an arbitrary
// column. Keys are the camelCase names the SQL client maps to snake_case; the
// model may send either casing, so proposal keys are normalized before the
// lookup. Excludes identity, coordinates (set by the geocoder), version, and
// timestamps.
const COMPANY_FIELDS = new Set([
	'name',
	'status',
	'industry',
	'sizeRange',
	'region',
	'location',
	'source',
	'priority',
	'website',
	'email',
	'phone',
	'instagram',
	'linkedin',
	'googleMapsUrl',
	'productsFit',
	'tags',
	'painPoints',
	'currentTools',
])

const CONTACT_FIELDS = new Set([
	'name',
	'role',
	'isDecisionMaker',
	'email',
	'phone',
	'whatsapp',
	'linkedin',
	'instagram',
	'notes',
])

const snakeToCamel = (s: string) =>
	s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

/**
 * Keep only the proposal fields that map to a writable column on the target
 * table, normalizing snake_case keys to the camelCase the SQL client expects.
 */
export const allowlistFields = (
	table: 'companies' | 'contacts',
	fields: Record<string, unknown>,
): Record<string, unknown> => {
	const allowed = table === 'companies' ? COMPANY_FIELDS : CONTACT_FIELDS
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(fields)) {
		const camel = snakeToCamel(key)
		if (allowed.has(camel)) out[camel] = value
	}
	return out
}

export type Validated =
	| {
			readonly ok: true
			readonly table: 'companies' | 'contacts'
			readonly subjectId: string
			readonly expectedVersion: number
			readonly fields: Record<string, unknown>
	  }
	| { readonly ok: false; readonly reason: string }

export const validate = (proposal: Record<string, unknown>): Validated => {
	const table = proposal['subject_table']
	if (table !== 'companies' && table !== 'contacts')
		return { ok: false, reason: 'unknown subject_table' }
	const subjectId = proposal['subject_id']
	if (typeof subjectId !== 'string' || subjectId === '')
		return { ok: false, reason: 'missing subject_id' }
	const expectedVersion = proposal['expected_version']
	if (typeof expectedVersion !== 'number' || !Number.isFinite(expectedVersion))
		return { ok: false, reason: 'missing or non-finite expected_version' }
	// A proposal's fields arrive as JSON, but an open-weights model sometimes
	// writes a plain sentence there instead (kept as a raw string by the tolerant
	// decoder); prose is not an actionable field map, so refuse it.
	const fields = proposal['fields']
	if (typeof fields !== 'object' || fields === null || Array.isArray(fields))
		return { ok: false, reason: 'fields is not an object' }
	return {
		ok: true,
		table,
		subjectId,
		expectedVersion,
		fields: fields as Record<string, unknown>,
	}
}

// Mark one proposal (found by array index) applied or rejected in the run's
// findings, leaving the rest of the findings untouched.
const setProposalStatus = (
	sql: SqlClient.SqlClient,
	runId: string,
	orgId: string,
	index: number,
	status: 'applied' | 'rejected',
) =>
	sql`
		UPDATE research_runs
		SET findings = jsonb_set(
				findings,
				${`{proposed_updates,${index},status}`}::text[],
				${JSON.stringify(status)}::jsonb
			),
			updated_at = now()
		WHERE id = ${runId} AND organization_id = ${orgId}
	`

// Optimistic-concurrency write: lands only if `version` still equals the version
// the proposal was made against, and bumps it. Branches on the table so the name
// is never interpolated. Returns the new row (empty on a version/id mismatch).
const occUpdate = (
	sql: SqlClient.SqlClient,
	table: 'companies' | 'contacts',
	subjectId: string,
	orgId: string,
	expectedVersion: number,
	fields: Record<string, unknown>,
) =>
	table === 'companies'
		? sql<{ version: number }>`
				UPDATE companies
				SET ${sql.update(fields)}, version = version + 1, updated_at = now()
				WHERE id = ${subjectId}
					AND organization_id = ${orgId}
					AND version = ${expectedVersion}
				RETURNING version
			`
		: sql<{ version: number }>`
				UPDATE contacts
				SET ${sql.update(fields)}, version = version + 1, updated_at = now()
				WHERE id = ${subjectId}
					AND organization_id = ${orgId}
					AND version = ${expectedVersion}
				RETURNING version
			`

export type ResolveOutcome =
	| {
			readonly outcome: 'applied'
			readonly subject_table: 'companies' | 'contacts'
			readonly subject_id: string
			readonly version: number
	  }
	| { readonly outcome: 'rejected' }
	| { readonly outcome: 'conflict' }
	| { readonly outcome: 'invalid'; readonly reason: string }
	| { readonly outcome: 'no_applicable_fields' }
	| { readonly outcome: 'run_not_found' }
	| { readonly outcome: 'proposal_not_found' }

export const resolveResearchProposedUpdate = (
	runId: string,
	proposedUpdateId: string,
	decision: 'apply' | 'reject',
) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const org = yield* CurrentOrg

		const rows = yield* sql<{ findings: string | null }>`
			SELECT findings::text AS findings FROM research_runs
			WHERE id = ${runId} AND organization_id = ${org.id}
			LIMIT 1
		`
		const run = rows[0]
		if (!run) return { outcome: 'run_not_found' } satisfies ResolveOutcome

		// Read the raw JSONB text and parse it, so the proposal keeps its stored
		// snake_case shape. The SQL client camelCases result keys — including
		// nested JSONB object keys — which would otherwise rename
		// `proposed_updates` to `proposedUpdates` and hide every proposal.
		const findings = (run.findings ? JSON.parse(run.findings) : null) as {
			proposed_updates?: Array<Record<string, unknown>>
		} | null
		const proposals = findings?.proposed_updates ?? []
		const index = proposals.findIndex(
			p => p['id'] === proposedUpdateId && p['status'] === 'pending',
		)
		if (index === -1)
			return { outcome: 'proposal_not_found' } satisfies ResolveOutcome
		const proposal = proposals[index] as Record<string, unknown>

		if (decision === 'reject') {
			yield* setProposalStatus(sql, runId, org.id, index, 'rejected')
			return { outcome: 'rejected' } satisfies ResolveOutcome
		}

		const validated = validate(proposal)
		if (!validated.ok)
			return {
				outcome: 'invalid',
				reason: validated.reason,
			} satisfies ResolveOutcome

		const fields = allowlistFields(validated.table, validated.fields)
		if (Object.keys(fields).length === 0)
			return { outcome: 'no_applicable_fields' } satisfies ResolveOutcome

		const updatedRows = yield* occUpdate(
			sql,
			validated.table,
			validated.subjectId,
			org.id,
			validated.expectedVersion,
			fields,
		)
		if (updatedRows.length === 0)
			return { outcome: 'conflict' } satisfies ResolveOutcome

		yield* setProposalStatus(sql, runId, org.id, index, 'applied')

		// Applying a new location makes the stored coordinates stale; refresh them
		// the same background, org-scoped way a manual location edit does.
		if (validated.table === 'companies' && Object.hasOwn(fields, 'location')) {
			yield* forkCompanyRegeocode(validated.subjectId)
		}

		return {
			outcome: 'applied',
			subject_table: validated.table,
			subject_id: validated.subjectId,
			version: updatedRows[0]?.version ?? validated.expectedVersion + 1,
		} satisfies ResolveOutcome
	})
