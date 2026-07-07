import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg } from '@batuda/controllers'

import { forkCompanyRegeocode } from './company-geocoding'
import { type ChannelInput, writeChannels } from './contact-channels'

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

// Reachable addresses (email/phone/whatsapp/linkedin/instagram) live on
// contact_channels, not on `contacts`, so they are not settable here; only
// the row's own columns remain.
const CONTACT_FIELDS = new Set(['name', 'role', 'isDecisionMaker', 'notes'])

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

// Channels arrive from contact discovery as { kind, value, verification?,
// confidence?, is_primary? }. Keep only well-formed entries — a channel needs
// both a kind and a value to be reachable.
const parseChannels = (raw: unknown): ReadonlyArray<ChannelInput> => {
	if (!Array.isArray(raw)) return []
	const channels: ChannelInput[] = []
	for (const entry of raw) {
		if (typeof entry !== 'object' || entry === null) continue
		const record = entry as Record<string, unknown>
		const kind = record['kind']
		const value = record['value']
		if (typeof kind !== 'string' || typeof value !== 'string') continue
		const verification = record['verification']
		const confidence = record['confidence']
		const isPrimary = record['is_primary']
		channels.push({
			kind,
			value,
			verification: typeof verification === 'string' ? verification : undefined,
			confidence: typeof confidence === 'number' ? confidence : undefined,
			is_primary: typeof isPrimary === 'boolean' ? isPrimary : undefined,
		})
	}
	return channels
}

export type ValidatedCreate =
	| {
			readonly ok: true
			readonly companyId: string
			readonly fields: Record<string, unknown>
			readonly channels: ReadonlyArray<ChannelInput>
	  }
	| { readonly ok: false; readonly reason: string }

// A create proposal carries a newly discovered contact: its row data plus the
// company it belongs to (contacts.company_id is required) and its channels.
export const validateCreate = (
	proposal: Record<string, unknown>,
): ValidatedCreate => {
	if (proposal['subject_table'] !== 'contacts')
		return { ok: false, reason: 'create is only supported for contacts' }
	const fieldsRaw = proposal['fields']
	if (
		typeof fieldsRaw !== 'object' ||
		fieldsRaw === null ||
		Array.isArray(fieldsRaw)
	)
		return { ok: false, reason: 'fields is not an object' }
	const fields = fieldsRaw as Record<string, unknown>
	const name = fields['name']
	if (typeof name !== 'string' || name.trim() === '')
		return { ok: false, reason: 'missing name' }
	const companyId = fields['company_id'] ?? fields['companyId']
	if (typeof companyId !== 'string' || companyId === '')
		return { ok: false, reason: 'missing company_id' }
	return {
		ok: true,
		companyId,
		fields: allowlistFields('contacts', fields),
		channels: parseChannels(fields['channels']),
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

// Record that a contact row came from this run, so the timeline and provenance
// can trace it back to its evidence. Idempotent — re-applying the same finding
// leaves a single link.
const linkContactToRun = (
	sql: SqlClient.SqlClient,
	orgId: string,
	runId: string,
	contactId: string,
) =>
	sql`
		INSERT INTO research_links (organization_id, research_id, subject_table, subject_id, link_kind)
		VALUES (${orgId}, ${runId}, 'contacts', ${contactId}, 'finding')
		ON CONFLICT DO NOTHING
	`

// A create proposal describes a newly discovered person. Before inserting a
// fresh row, look for one that is already the same person, so two runs on the
// same contact don't leave two rows. In order of strength: (1) a contact already
// reachable at one of the proposed channel values, matched on the (kind, value)
// pair so a shared switchboard number can't merge two different people; (2) one
// the model itself flagged as already existing; (3) same name under the same
// company.
export const findDuplicateContact = (
	sql: SqlClient.SqlClient,
	orgId: string,
	name: string,
	companyId: string,
	channels: ReadonlyArray<ChannelInput>,
	discoveredExisting: ReadonlyArray<{
		subject_table?: string
		subject_id?: string
		name?: string
	}>,
) =>
	Effect.gen(function* () {
		const searchableChannels = channels.filter(c => c.value.length > 0)
		if (searchableChannels.length > 0) {
			const pairs = searchableChannels.map(
				c => sql`(kind = ${c.kind} AND value = ${c.value})`,
			)
			const rows = yield* sql<{ contactId: string }>`
				SELECT contact_id FROM contact_channels
				WHERE organization_id = ${orgId} AND (${sql.or(pairs)})
				LIMIT 1
			`
			if (rows[0]) return rows[0].contactId
		}

		const flagged = discoveredExisting.find(
			e =>
				e.subject_table === 'contacts' &&
				typeof e.subject_id === 'string' &&
				typeof e.name === 'string' &&
				e.name.trim().toLowerCase() === name.trim().toLowerCase(),
		)
		if (flagged?.subject_id) {
			// The id came from the model, so a value that isn't a UUID would trip
			// text parsing (22P02); treat that as simply no match.
			const rows = yield* sql<{ id: string }>`
				SELECT id FROM contacts
				WHERE id = ${flagged.subject_id} AND organization_id = ${orgId}
				LIMIT 1
			`.pipe(
				Effect.catchTag('SqlError', () =>
					Effect.succeed([] as ReadonlyArray<{ id: string }>),
				),
			)
			if (rows[0]) return rows[0].id
		}

		const byName = yield* sql<{ id: string }>`
			SELECT id FROM contacts
			WHERE organization_id = ${orgId}
				AND company_id = ${companyId}
				AND lower(name) = lower(${name})
			LIMIT 1
		`
		return byName[0]?.id ?? null
	})

export type ResolveOutcome =
	| {
			readonly outcome: 'applied'
			readonly subject_table: 'companies' | 'contacts'
			readonly subject_id: string
			readonly version: number
	  }
	| {
			readonly outcome: 'created'
			readonly subject_table: 'contacts'
			readonly subject_id: string
			readonly version: number
	  }
	| {
			// A create proposal for a person who already has a contact row: the
			// discovered channels were merged onto the existing row instead of
			// inserting a second contact.
			readonly outcome: 'duplicate'
			readonly subject_table: 'contacts'
			readonly subject_id: string
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
			discovered_existing?: Array<{
				subject_table?: string
				subject_id?: string
				name?: string
			}>
		} | null
		const proposals = findings?.proposed_updates ?? []
		const discoveredExisting = findings?.discovered_existing ?? []
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

		// A discovered contact has no row yet: create it (with its channels)
		// instead of updating an existing one, and link the new row to the run.
		if (proposal['operation'] === 'create') {
			const created = validateCreate(proposal)
			if (!created.ok)
				return {
					outcome: 'invalid',
					reason: created.reason,
				} satisfies ResolveOutcome
			const existingId = yield* findDuplicateContact(
				sql,
				org.id,
				typeof created.fields['name'] === 'string'
					? (created.fields['name'] as string)
					: '',
				created.companyId,
				created.channels,
				discoveredExisting,
			)
			if (existingId) {
				// Merge the discovered channels onto the person's existing row
				// (additive — the human-owned scalar fields stay untouched) and link
				// the run, rather than inserting a second contact for the same person.
				yield* writeChannels(sql, org.id, existingId, created.channels)
				yield* linkContactToRun(sql, org.id, runId, existingId)
				yield* setProposalStatus(sql, runId, org.id, index, 'applied')
				return {
					outcome: 'duplicate',
					subject_table: 'contacts',
					subject_id: existingId,
				} satisfies ResolveOutcome
			}
			const inserted = yield* sql<{ id: string; version: number }>`
				INSERT INTO contacts ${sql.insert({
					...created.fields,
					companyId: created.companyId,
					organizationId: org.id,
				})}
				RETURNING id, version
			`.pipe(
				Effect.catchTag('SqlError', e => {
					const code = (e.cause as { code?: unknown } | null | undefined)?.code
					// A hallucinated company_id is a bad proposal, not a server error: a
					// company that doesn't exist trips the foreign key (23503), a value
					// that isn't a UUID trips text parsing (22P02). Report it as invalid
					// like any other unusable proposal, rather than failing the request.
					return code === '23503' || code === '22P02'
						? Effect.succeed(null)
						: Effect.fail(e)
				}),
			)
			if (inserted === null)
				return {
					outcome: 'invalid',
					reason: 'company_id does not reference a known company',
				} satisfies ResolveOutcome
			const [row] = inserted
			if (!row)
				return {
					outcome: 'invalid',
					reason: 'contact insert returned no row',
				} satisfies ResolveOutcome
			// Deliverability verdict + confidence land on the channels, not the row.
			yield* writeChannels(sql, org.id, row.id, created.channels)
			yield* linkContactToRun(sql, org.id, runId, row.id)
			yield* setProposalStatus(sql, runId, org.id, index, 'applied')
			return {
				outcome: 'created',
				subject_table: 'contacts',
				subject_id: row.id,
				version: row.version,
			} satisfies ResolveOutcome
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
