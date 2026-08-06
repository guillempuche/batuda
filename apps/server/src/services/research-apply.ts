import { Cause, DateTime, Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg } from '@batuda/controllers'
import {
	BUYING_ROLES,
	COMPANY_PRIORITIES,
	COMPANY_SIZE_RANGES,
	COMPANY_STATUSES,
} from '@batuda/domain'

export {
	type ProvenanceEntry,
	researchProvenance,
} from './research-provenance'

import {
	type ChannelInput,
	splitCompanyChannelFields,
	writeChannels,
} from './channels'
import { forkCompanyRegeocode } from './company-geocoding'
import {
	ResearchProposalApplied,
	TimelineActivityService,
} from './timeline-activity'

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
// lookup. Excludes identity, coordinates (set by the geocoder), version,
// timestamps, and the pain points a person fills in from calls and emails.
//
// A company's mailbox, number, website and handles are not here because they are
// no longer columns. They are still proposed by those names — what a reviewer
// reads is "email: info@…" — and are written as channels instead; see
// COMPANY_CHANNEL_PROPOSAL_FIELDS below.
export const COMPANY_FIELDS = new Set([
	'name',
	'status',
	'industry',
	'sizeRange',
	'taxId',
	'location',
	'priority',
	'googleMapsUrl',
	'productsFit',
	'tags',
	'currentTools',
])

// Reachable addresses (email/phone/whatsapp/linkedin/instagram) live on
// their own channel rows, not on `contacts`, so they are not settable here; only
// the row's own columns remain.
export const CONTACT_FIELDS = new Set(['name', 'role', 'buyingRole'])

const snakeToCamel = (s: string) =>
	s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

// What the run cited for one value: which page it read the value on, how sure it
// was, and the date the value was true as of. The page is named by the run's own
// id for it, which only means something inside that run.
export type FieldCitation = {
	readonly sourceId: string
	readonly confidence?: number
	readonly asOf?: string
}

// Where one applied value came from, as the company row keeps it: the page's own
// address rather than the run's private id for it, plus the run that read it.
// Stored beside the value it explains, so a reader can ask "where did this come
// from?" of any single fact on the row.
export type FieldSource = {
	readonly sourceUrl: string
	readonly runId: string
	readonly confidence?: number
	readonly asOf?: string
}

// A field value the model may have wrapped as { value, source_id, … } — the
// per-field provenance shape enrichment findings use. CRM columns hold plain
// text, so the inner value is what gets written, and the wrapper around it is
// what says where that value came from. A plain value has neither.
const readSourced = (
	value: unknown,
): { readonly value: unknown; readonly citation?: FieldCitation } => {
	if (
		value === null ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		!('value' in value) ||
		!('source_id' in (value as Record<string, unknown>))
	)
		return { value }
	const wrapper = value as Record<string, unknown>
	const sourceId = wrapper['source_id']
	if (typeof sourceId !== 'string' || sourceId === '')
		return { value: wrapper['value'] }
	const confidence = wrapper['confidence']
	const asOf = wrapper['as_of']
	return {
		value: wrapper['value'],
		citation: {
			sourceId,
			...(typeof confidence === 'number' ? { confidence } : {}),
			...(typeof asOf === 'string' ? { asOf } : {}),
		},
	}
}

/**
 * Swap each cited page id for the page's real address, and stamp the run that
 * cited it. A citation naming a page this run never fetched is dropped: a stored
 * note about where a fact came from has to point somewhere a reader can open.
 */
const resolveFieldSources = (
	sql: SqlClient.SqlClient,
	runId: string,
	citations: Record<string, FieldCitation>,
) =>
	Effect.gen(function* () {
		const entries = Object.entries(citations)
		if (entries.length === 0) return {} as Record<string, FieldSource>
		const citedIds = [...new Set(entries.map(([, cited]) => cited.sourceId))]
		const rows = yield* sql<{ id: string; url: string }>`
			SELECT s.id, s.url
			FROM research_run_sources rs
			JOIN sources s ON s.id = rs.source_id
			WHERE rs.research_id = ${runId} AND s.id IN ${sql.in(citedIds)}
		`
		const urlById = new Map(rows.map(row => [row.id, row.url]))
		const out: Record<string, FieldSource> = {}
		for (const [field, cited] of entries) {
			const sourceUrl = urlById.get(cited.sourceId)
			if (sourceUrl === undefined) continue
			out[field] = {
				sourceUrl,
				runId,
				...(cited.confidence !== undefined
					? { confidence: cited.confidence }
					: {}),
				...(cited.asOf !== undefined ? { asOf: cited.asOf } : {}),
			}
		}
		return out
	})

/**
 * Keep only the proposal fields that map to a writable column on the target
 * table, normalizing snake_case keys to the camelCase the SQL client expects,
 * and collect the page each kept value was cited to.
 */
export const allowlistFields = (
	table: 'companies' | 'contacts',
	fields: Record<string, unknown>,
): {
	readonly fields: Record<string, unknown>
	readonly citations: Record<string, FieldCitation>
} => {
	const allowed = table === 'companies' ? COMPANY_FIELDS : CONTACT_FIELDS
	const out: Record<string, unknown> = {}
	const citations: Record<string, FieldCitation> = {}
	for (const [key, value] of Object.entries(fields)) {
		const camel = snakeToCamel(key)
		if (!allowed.has(camel)) continue
		const read = readSourced(value)
		out[camel] = read.value
		if (read.citation !== undefined) citations[camel] = read.citation
	}
	return { fields: out, citations }
}

// The allowlist above says which fields may be written, not what they may be
// set to. These three columns take only a fixed set of values, so a stage the
// model invented would otherwise reach the database and come back as a failed
// request — telling the reviewer the server broke, when the suggestion was
// simply unusable.
type FieldVocabulary = {
	readonly field: string
	readonly allowed: ReadonlyArray<string | number>
}

const COMPANY_FIELD_VOCABULARIES: ReadonlyArray<FieldVocabulary> = [
	{ field: 'status', allowed: COMPANY_STATUSES },
	{ field: 'priority', allowed: COMPANY_PRIORITIES },
	{ field: 'sizeRange', allowed: COMPANY_SIZE_RANGES },
]

// A contact's part in the buying decision reads back through a guard that only
// knows these five words, so one the model invented is stored but belongs to no
// group and shows up nowhere — the same quiet disappearance the company
// vocabularies prevent.
const CONTACT_FIELD_VOCABULARIES: ReadonlyArray<FieldVocabulary> = [
	{ field: 'buyingRole', allowed: BUYING_ROLES },
]

// The reason a company proposal cannot be applied, or null when it can. An
// explicit null is how a value is cleared, which these columns allow except
// status — a company always sits at some stage.
export const checkFieldValues = (
	table: 'companies' | 'contacts',
	fields: Record<string, unknown>,
): string | null => {
	const vocabularies =
		table === 'companies'
			? COMPANY_FIELD_VOCABULARIES
			: CONTACT_FIELD_VOCABULARIES
	for (const { field, allowed } of vocabularies) {
		if (!(field in fields)) continue
		const raw = fields[field]
		if (raw === null && field !== 'status') continue
		// A model writing JSON often quotes a small number, and the column takes
		// it either way, so "2" is the priority 2 the reviewer read — not a
		// different value to refuse them over.
		const value =
			typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw
		if (
			(typeof value === 'string' || typeof value === 'number') &&
			allowed.includes(value)
		)
			continue
		return `${field} must be one of ${allowed.join(', ')} — got ${JSON.stringify(raw)}`
	}
	return null
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
	const allowed = allowlistFields('contacts', fields).fields
	const badValue = checkFieldValues('contacts', allowed)
	if (badValue !== null) return { ok: false, reason: badValue }
	return {
		ok: true,
		companyId,
		fields: allowed,
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

// The Postgres error code (e.g. '22P02' bad-uuid, '23503' fk-violation) can sit a
// couple of `cause` levels down inside a wrapped SqlError, so walk the chain
// rather than reading only the top cause.
const pgErrorCode = (error: unknown): string | undefined => {
	let cursor: unknown = error
	for (
		let depth = 0;
		depth < 6 && cursor != null && typeof cursor === 'object';
		depth++
	) {
		const code = (cursor as { code?: unknown }).code
		if (typeof code === 'string') return code
		cursor = (cursor as { cause?: unknown }).cause
	}
	return undefined
}

// What an apply records about a company beyond the proposed values themselves:
// where each value came from, and — when this company is the one the run was
// about — the run's overall judgement of it and its written brief.
export type CompanyEnrichment = {
	/** Where each written value came from, keyed by the column it explains. */
	readonly provenance: Record<string, FieldSource>
	/**
	 * The rest is a company's alone — its fit judgement and its written brief.
	 * A person carries only the provenance, so these are optional rather than a
	 * second payload type that would repeat the one field they share.
	 */
	readonly isRunTarget?: boolean
	readonly fitVerdict?: string | null
	readonly fitChecks?: unknown
	readonly fitConflicts?: unknown
	/** The run's brief, in markdown, already carrying its own dated heading. */
	readonly brief?: string | null
}

// Serialize a json column value, or null to leave the stored one alone.
const jsonOrNull = (value: unknown): string | null =>
	value === null || value === undefined ? null : JSON.stringify(value)

// Optimistic-concurrency write: lands only if `version` still equals the version
// the proposal was made against, and bumps it. Branches on the table so the name
// is never interpolated. Returns the new row (empty on a version/id mismatch).
//
// A company update also folds in what the run learned about the row. Each of
// those clauses leaves the stored value alone when there is nothing to say, so
// one statement serves both an ordinary field update and a full enrichment.
// Provenance is the one exception to plain replacement: it is MERGED, because a
// run that fills only the phone must not erase where an earlier run found the
// industry. That merge reads the stored value inside the same statement that
// checks the version, so a concurrent edit cannot slip between read and write.
export const occUpdate = (
	sql: SqlClient.SqlClient,
	table: 'companies' | 'contacts',
	subjectId: string,
	orgId: string,
	expectedVersion: number,
	fields: Record<string, unknown>,
	enrichment?: CompanyEnrichment,
) => {
	// A change can carry no column at all and still be a real change: a company's
	// mailbox and number are rows elsewhere now, so a suggestion naming only those
	// leaves nothing to set here. The row still has to be claimed — its version
	// checked and bumped — so the assignment list is simply left out rather than
	// written empty, which is not valid SQL.
	const setFields =
		Object.keys(fields).length > 0 ? sql`${sql.update(fields)},` : sql``
	const provenance =
		enrichment && Object.keys(enrichment.provenance).length > 0
			? JSON.stringify(enrichment.provenance)
			: null
	// A person records where each of their facts came from, exactly as a company
	// does. It matters more here, not less: a job title from eighteen months ago
	// is worse than none, because it gets quoted confidently in an opening line.
	// Added to what is there rather than replacing it, so a run that fills one
	// field leaves the others' sources alone.
	if (table === 'contacts')
		return sql<{ version: number }>`
			UPDATE contacts
			SET ${setFields}
				field_provenance = CASE
					WHEN ${provenance}::jsonb IS NULL THEN field_provenance
					ELSE COALESCE(field_provenance, '{}'::jsonb) || ${provenance}::jsonb
				END,
				version = version + 1,
				updated_at = now()
			WHERE id = ${subjectId}
				AND organization_id = ${orgId}
				-- Hidden with their company, so a suggestion about them has nowhere
				-- to show either.
				AND deleted_at IS NULL
				AND version = ${expectedVersion}
			RETURNING version
		`
	const isRunTarget = enrichment?.isRunTarget ?? false
	const fitVerdict = isRunTarget ? (enrichment?.fitVerdict ?? null) : null
	const fitChecks = isRunTarget ? jsonOrNull(enrichment?.fitChecks) : null
	const fitConflicts = isRunTarget ? jsonOrNull(enrichment?.fitConflicts) : null
	const brief = isRunTarget ? (enrichment?.brief ?? null) : null
	return sql<{ version: number }>`
		UPDATE companies
		SET ${setFields}
			field_provenance = CASE
				WHEN ${provenance}::jsonb IS NULL THEN field_provenance
				ELSE COALESCE(field_provenance, '{}'::jsonb) || ${provenance}::jsonb
			END,
			last_enriched_at = CASE
				WHEN ${isRunTarget}::boolean THEN now()
				ELSE last_enriched_at
			END,
			fit_verdict = COALESCE(${fitVerdict}::text, fit_verdict),
			fit_checks = COALESCE(${fitChecks}::jsonb, fit_checks),
			fit_conflicts = COALESCE(${fitConflicts}::jsonb, fit_conflicts),
			account_brief = COALESCE(${brief}::text, account_brief),
			version = version + 1,
			updated_at = now()
		WHERE id = ${subjectId}
			AND organization_id = ${orgId}
			-- The run finished before the company was taken out of view, so the
			-- suggestion is about a record nobody can open any more. Applying it
			-- would be work with nothing to show for it.
			AND deleted_at IS NULL
			AND version = ${expectedVersion}
		RETURNING version
	`
}

// A citation the model attached to a suggestion: which fetched source backed a
// claim, so the applied row can point back at its evidence.
export type Citation = {
	readonly source_id: string
	readonly quote?: string
	readonly confidence?: number
}

// Keep only well-formed citations — one needs a source id to resolve to a URL.
const parseCitations = (raw: unknown): ReadonlyArray<Citation> => {
	if (!Array.isArray(raw)) return []
	const out: Citation[] = []
	for (const entry of raw) {
		if (typeof entry !== 'object' || entry === null) continue
		const record = entry as Record<string, unknown>
		const sourceId = record['source_id']
		if (typeof sourceId !== 'string' || sourceId === '') continue
		const quote = record['quote']
		const confidence = record['confidence']
		out.push({
			source_id: sourceId,
			...(typeof quote === 'string' ? { quote } : {}),
			...(typeof confidence === 'number' ? { confidence } : {}),
		})
	}
	return out
}

// Record that a row came from this run, carrying the citations that back the
// change, so the row keeps a resolvable pointer to its evidence for later
// display (worded by the presentation layer). Idempotent — re-applying
// refreshes the citations on the single link; an existing input link keeps its
// kind and only has its citations updated.
export const linkSubjectToRun = (
	sql: SqlClient.SqlClient,
	orgId: string,
	runId: string,
	subjectTable: 'companies' | 'contacts',
	subjectId: string,
	citations: ReadonlyArray<Citation>,
) =>
	sql`
		INSERT INTO research_links
			(organization_id, research_id, subject_table, subject_id, link_kind, citations)
		VALUES (
			${orgId}, ${runId}, ${subjectTable}, ${subjectId}, 'finding',
			${JSON.stringify(citations)}::jsonb
		)
		ON CONFLICT (research_id, subject_table, subject_id)
			DO UPDATE SET citations = EXCLUDED.citations
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
				c => sql`(channel = ${c.kind} AND address = ${c.value})`,
			)
			// Only a person's channels are searched. A company now owns addresses
			// too — a shared info@ among them — and one of those matching would
			// merge two different people into whoever holds it.
			const rows = yield* sql<{ contactId: string }>`
				SELECT subject_id AS contact_id FROM channels
				WHERE organization_id = ${orgId}
					AND subject_table = 'contacts'
					AND (${sql.or(pairs)})
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
	| {
			// The run this came from needs somebody to read it before anything from
			// it enters a record, so a batch may not sweep it up.
			readonly outcome: 'needs_review'
	  }

export const resolveResearchProposedUpdate = (
	runId: string,
	proposedUpdateId: string,
	decision: 'apply' | 'reject',
	actorUserId: string | null,
	/**
	 * Whether this is one of many resolved in a single request. A person deciding
	 * on one suggestion with the run in front of them may apply anything; a batch
	 * is an automation, and a run that needs reading is precisely what an
	 * automation must not act on.
	 */
	options?: { readonly inBatch?: boolean },
) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const org = yield* CurrentOrg
		const timeline = yield* TimelineActivityService

		// Write an audit entry when a change lands, linked to both the run and
		// the subject. Best-effort: the change is already applied, so if the
		// audit write fails, log a warning rather than failing the whole apply.
		const recordApplied = (
			operation: 'created' | 'updated' | 'duplicate',
			subjectTable: 'companies' | 'contacts',
			subjectId: string,
			companyId: string | null,
			contactId: string | null,
			appliedFields: ReadonlyArray<string>,
		) =>
			timeline
				.record(
					new ResearchProposalApplied({
						researchRunId: runId,
						companyId,
						contactId,
						subjectTable,
						subjectId,
						operation,
						appliedFields,
						actorUserId,
						occurredAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
					}),
				)
				.pipe(
					Effect.catchCause(cause =>
						Effect.logWarning('research apply timeline write failed').pipe(
							Effect.annotateLogs({ cause: Cause.pretty(cause) }),
						),
					),
				)

		const rows = yield* sql<{
			findings: {
				proposed_updates?: Array<Record<string, unknown>>
				discovered_existing?: Array<{
					subject_table?: string
					subject_id?: string
					name?: string
				}>
				verdict?: unknown
				fit_checks?: unknown
				conflicts?: unknown
			} | null
			context: { subjects?: Array<{ table?: string; id?: string }> } | null
			country: string | null
			briefMd: string | null
			status: string
		}>`
			SELECT findings, context, country, brief_md AS "briefMd", status
			FROM research_runs
			WHERE id = ${runId} AND organization_id = ${org.id}
			LIMIT 1
		`
		const run = rows[0]
		if (!run) return { outcome: 'run_not_found' } satisfies ResolveOutcome
		// The screens hide their "apply everything" buttons for such a run, but the
		// same request can be sent without them, so the rule is kept here where no
		// caller can go round it.
		if (
			options?.inBatch === true &&
			decision === 'apply' &&
			run.status === 'succeeded_low_confidence'
		)
			return { outcome: 'needs_review' } satisfies ResolveOutcome

		const findings = run.findings
		const proposals = findings?.proposed_updates ?? []
		const discoveredExisting = findings?.discovered_existing ?? []

		// The company this run was about — its subject. The run's country describes
		// that company, so it is stamped only onto that company's update, never onto
		// another company the run merely mentioned (a competitor in a different
		// country would otherwise be mis-tagged).
		const targetCompanyIds = new Set(
			(run.context?.subjects ?? [])
				.filter(s => s?.table === 'companies' && typeof s?.id === 'string')
				.map(s => s.id as string),
		)
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

		// The sources the model cited for this change, stored with the applied
		// row so its evidence trail survives a later transcript prune.
		const citations = parseCitations(proposal['citations'])

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
				yield* writeChannels(
					sql,
					org.id,
					{ table: 'contacts' as const, id: existingId },
					created.channels,
				)
				yield* linkSubjectToRun(
					sql,
					org.id,
					runId,
					'contacts',
					existingId,
					citations,
				)
				yield* setProposalStatus(sql, runId, org.id, index, 'applied')
				yield* recordApplied(
					'duplicate',
					'contacts',
					existingId,
					created.companyId,
					existingId,
					Object.keys(created.fields),
				)
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
					const code = pgErrorCode(e)
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
			yield* writeChannels(
				sql,
				org.id,
				{ table: 'contacts' as const, id: row.id },
				created.channels,
			)
			yield* linkSubjectToRun(sql, org.id, runId, 'contacts', row.id, citations)
			yield* setProposalStatus(sql, runId, org.id, index, 'applied')
			yield* recordApplied(
				'created',
				'contacts',
				row.id,
				created.companyId,
				row.id,
				Object.keys(created.fields),
			)
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

		// A company proposal may name a way of reaching it. Those are taken out
		// first and written as addresses; what is left goes to the columns.
		//
		// Their citations are carried across by hand, because the allowlist no
		// longer sees these keys and would otherwise drop them. The company row
		// still answers "where did this email come from?" the way it did when the
		// address was a column of its own — the record of that is worth more than
		// the tidiness of dropping it with the field.
		const channelCitations: Record<string, FieldCitation> = {}
		const proposedChannels =
			validated.table === 'companies'
				? splitCompanyChannelFields(
						Object.fromEntries(
							Object.entries(validated.fields).map(([key, value]) => {
								const read = readSourced(value)
								if (read.citation !== undefined)
									channelCitations[snakeToCamel(key)] = read.citation
								return [key, read.value]
							}),
						),
					).channels
				: []
		const { fields, citations: fieldCitations } = allowlistFields(
			validated.table,
			validated.fields,
		)
		// The whole proposal goes back, not just the offending field: a reviewer
		// approved the set they were shown, so quietly applying the rest would
		// leave them believing a change landed that never did.
		const badValue = checkFieldValues(validated.table, fields)
		if (badValue !== null)
			return { outcome: 'invalid', reason: badValue } satisfies ResolveOutcome
		const sources = yield* resolveFieldSources(sql, runId, {
			...channelCitations,
			...fieldCitations,
		})

		// Persist the run's country onto its own target company as the run's
		// findings are applied. `country` is not an allowlisted proposal field —
		// it comes from the run, not the model's per-field suggestions.
		if (
			validated.table === 'companies' &&
			run.country !== null &&
			targetCompanyIds.has(validated.subjectId)
		)
			fields['country'] = run.country
		if (Object.keys(fields).length === 0 && proposedChannels.length === 0)
			return { outcome: 'no_applicable_fields' } satisfies ResolveOutcome

		// A subject_id that isn't a UUID trips text parsing (22P02) in the WHERE
		// clause; that is a bad proposal (the model can invent an id), not a server
		// error, so report it as invalid the way the create branch does.
		// The run's own judgement and brief belong only to the company the run was
		// about — a competitor it merely mentioned gets its values and their sources,
		// nothing more.
		const isRunTarget =
			validated.table === 'companies' &&
			targetCompanyIds.has(validated.subjectId)
		const updatedRows = yield* occUpdate(
			sql,
			validated.table,
			validated.subjectId,
			org.id,
			validated.expectedVersion,
			fields,
			validated.table === 'companies'
				? {
						provenance: sources,
						isRunTarget,
						fitVerdict:
							typeof findings?.verdict === 'string' ? findings.verdict : null,
						fitChecks: findings?.fit_checks ?? null,
						fitConflicts: findings?.conflicts ?? null,
						brief: run.briefMd,
					}
				: { provenance: sources },
		).pipe(
			Effect.catchTag('SqlError', e => {
				const code = pgErrorCode(e)
				return code === '22P02' || code === '23503'
					? Effect.succeed(null)
					: Effect.fail(e)
			}),
		)
		if (updatedRows === null)
			return {
				outcome: 'invalid',
				reason: 'subject_id does not reference a known row',
			} satisfies ResolveOutcome
		if (updatedRows.length === 0)
			return { outcome: 'conflict' } satisfies ResolveOutcome

		// Only now that the row's version proved unchanged. Written earlier, an
		// address would land even when the change was refused for being out of
		// date — a rejected suggestion that still altered the record.
		if (proposedChannels.length > 0) {
			yield* writeChannels(
				sql,
				org.id,
				{ table: 'companies', id: validated.subjectId },
				proposedChannels,
			)
		}

		yield* setProposalStatus(sql, runId, org.id, index, 'applied')
		yield* linkSubjectToRun(
			sql,
			org.id,
			runId,
			validated.table,
			validated.subjectId,
			citations,
		)
		yield* recordApplied(
			'updated',
			validated.table,
			validated.subjectId,
			validated.table === 'companies' ? validated.subjectId : null,
			validated.table === 'contacts' ? validated.subjectId : null,
			Object.keys(fields),
		)

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

export type BatchResolveItem = {
	readonly researchId: string
	readonly proposedUpdateId: string
	readonly decision: 'apply' | 'reject'
}

export type BatchResolveItemResult =
	| (ResolveOutcome & {
			readonly research_id: string
			readonly proposed_update_id: string
	  })
	| {
			readonly outcome: 'error'
			readonly research_id: string
			readonly proposed_update_id: string
	  }

// Resolve many proposals in one call, returning a per-item outcome. Runs the
// items one at a time on purpose: two proposals in the same run each rewrite
// that run's findings by array position, so resolving them at the same time
// could clobber each other. A failure on one item is caught into an `error`
// outcome so the rest of the batch still runs.
export const resolveResearchProposedUpdatesBatch = (
	items: ReadonlyArray<BatchResolveItem>,
	actorUserId: string | null,
) =>
	Effect.forEach(items, item =>
		resolveResearchProposedUpdate(
			item.researchId,
			item.proposedUpdateId,
			item.decision,
			actorUserId,
			{ inBatch: true },
		).pipe(
			Effect.map(
				outcome =>
					({
						research_id: item.researchId,
						proposed_update_id: item.proposedUpdateId,
						...outcome,
					}) satisfies BatchResolveItemResult,
			),
			Effect.catchCause(cause =>
				Effect.logWarning('bulk proposed-update resolve failed').pipe(
					Effect.annotateLogs({ cause: Cause.pretty(cause) }),
					Effect.as({
						research_id: item.researchId,
						proposed_update_id: item.proposedUpdateId,
						outcome: 'error' as const,
					} satisfies BatchResolveItemResult),
				),
			),
		),
	)
