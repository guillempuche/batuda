import { Cause, DateTime, Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg } from '@batuda/controllers'
import {
	BUYING_ROLES,
	COMPANY_PRIORITIES,
	COMPANY_SIZE_RANGES,
	COMPANY_STATUSES,
	channelAddressIsValid,
	isVerificationVerdict,
	MAPS_ADDRESS_PATTERN,
} from '@batuda/domain'
import {
	canonicalizeUrl,
	isWebAddress,
	sourceIdFor,
	urlHashForScrape,
} from '@batuda/research'

export {
	type ProvenanceEntry,
	researchProvenance,
} from './research-provenance'

import { pgErrorCode } from '../lib/pg-error'
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
		!('value' in value)
	)
		return { value }
	const wrapper = value as Record<string, unknown>
	const sourceId = wrapper['source_id']
	// A wrapper is still a wrapper when the run named no page for it. The value
	// inside is what belongs in the column either way, and only the note about
	// where it came from is lost. Left wrapped, the whole object would go into the
	// column in place of the text it holds.
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
 * Swap each cited page for the page's real address, and stamp the run that cited
 * it. A run names a page either by its address — which is what the model is asked
 * for, and all it is ever shown — or by the id we hold that page under, which is
 * what our own harvested values carry. Both are read.
 *
 * Only pages THIS run fetched count: a citation naming a page the run never
 * opened is dropped, because a stored note about where a fact came from has to
 * point somewhere a reader can open.
 */
const resolveFieldSources = (
	sql: SqlClient.SqlClient,
	runId: string,
	citations: Record<string, FieldCitation>,
) =>
	Effect.gen(function* () {
		const entries = Object.entries(citations)
		if (entries.length === 0) return {} as Record<string, FieldSource>
		// The run's own pages, matched here rather than in the query: one page gets
		// written a dozen ways — a trailing slash, a capital in the host, a
		// fragment — and tidying both sides down to one spelling is not something
		// the database can do for us. A run holds tens of pages, so reading them all
		// costs less than a lookup per citation.
		//
		// The page store is shared by every organisation, so it is the run's own link
		// rows that hold this to pages this run really fetched. Take that join away
		// and an address a run merely mentioned would resolve against somebody else's
		// page.
		const rows = yield* sql<{ id: string; url: string; localRef: string }>`
			SELECT s.id, s.url, rs.local_ref AS "localRef"
			FROM research_run_sources rs
			JOIN sources s ON s.id = rs.source_id
			WHERE rs.research_id = ${runId}
			ORDER BY s.id
		`
		// Every way one of this run's pages can be named, each pointing at the one
		// address on file. What gets stored is always that address, never the text
		// the run happened to write down. Two pages can tidy down to the same name
		// and the first of them wins, so the rows are read in a fixed order — the
		// same citation then always resolves to the same page.
		const urlByName = new Map<string, string>()
		for (const row of rows) {
			// A page with no address on file cannot be pointed at, so it never becomes
			// a way of naming one. Left in, it would answer a lookup with an empty
			// string — which is a found value as far as the search below is concerned,
			// and would store a note leading nowhere.
			if (row.url === '') continue
			for (const name of [
				row.id,
				canonicalizeUrl(row.url),
				canonicalizeUrl(row.localRef),
			])
				if (!urlByName.has(name)) urlByName.set(name, row.url)
		}
		const out: Record<string, FieldSource> = {}
		for (const [field, cited] of entries) {
			// Exactly as written first, so an id we minted is never put through
			// address-tidying it was never meant for. Then the tidied address. Then
			// the id that address itself maps to, which is what still finds the page
			// when a fetch was redirected off-site and the row kept where it landed.
			// That last one only makes sense for an address: asked of an id it would
			// hash the id itself, which names no page anybody holds.
			const sourceUrl =
				urlByName.get(cited.sourceId) ??
				urlByName.get(canonicalizeUrl(cited.sourceId)) ??
				(isWebAddress(cited.sourceId)
					? urlByName.get(sourceIdFor(urlHashForScrape(cited.sourceId)))
					: undefined)
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

// Fields whose value has to look like something, as opposed to being one of a
// handful of allowed words. Held here rather than left to the column, because a
// proposal is written by a model and the two doors a person or an assistant
// comes through already turn these away — this is the third door.
const COMPANY_FIELD_SHAPES: ReadonlyArray<{
	readonly field: string
	readonly ok: (value: string) => boolean
	readonly wanted: string
}> = [
	{
		field: 'name',
		ok: value => value.trim() !== '',
		wanted: 'a name with something in it',
	},
	{
		field: 'googleMapsUrl',
		ok: value => MAPS_ADDRESS_PATTERN.test(value),
		wanted: 'a Google Maps link',
	},
]

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
	if (table === 'companies')
		for (const { field, ok, wanted } of COMPANY_FIELD_SHAPES) {
			if (!(field in fields)) continue
			const raw = fields[field]
			// Left out and cleared are both a caller not setting it, which the
			// column already answers for; only a value actually offered is checked.
			if (raw === null || raw === undefined) continue
			if (typeof raw === 'string' && ok(raw)) continue
			return `${field} must be ${wanted} — got ${JSON.stringify(raw)}`
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
//
// A verdict nobody recognises is dropped and the address kept, rather than the
// whole proposal being refused. These fields come out of a model's free-form
// JSON, and a found address is the part that was worth having: throwing it away
// over a stray word about its deliverability loses the finding to protect a
// footnote. The tools a person or an assistant calls do the opposite and refuse
// outright, because there the caller can be told which words are allowed.
const parseChannels = (raw: unknown): ReadonlyArray<ChannelInput> => {
	if (!Array.isArray(raw)) return []
	const channels: ChannelInput[] = []
	for (const entry of raw) {
		if (typeof entry !== 'object' || entry === null) continue
		const record = entry as Record<string, unknown>
		const kind = record['kind']
		const value = record['value']
		if (typeof kind !== 'string' || typeof value !== 'string') continue
		// An address nobody could ever write to is stepped over, the same way the
		// company side does it: a person discovered this way is still worth having,
		// and a made-up mailbox beside a real name should not cost the whole row.
		// A platform nothing describes passes, so a new one is never turned away.
		if (!channelAddressIsValid(kind, value)) continue
		const verification = record['verification']
		const confidence = record['confidence']
		const isPrimary = record['is_primary']
		channels.push({
			kind,
			value,
			verification:
				typeof verification === 'string' && isVerificationVerdict(verification)
					? verification
					: undefined,
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
			readonly citations: Record<string, FieldCitation>
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
	// Read through a wrapper here too. A run asked to pair each changed value with
	// the page it came from tends to do the same for the person it is offering, and
	// a wrapped name read as-is is not a string — which would throw the whole
	// person away for being nameless.
	const name = readSourced(fields['name']).value
	if (typeof name !== 'string' || name.trim() === '')
		return { ok: false, reason: 'missing name' }
	const companyId = readSourced(
		fields['company_id'] ?? fields['companyId'],
	).value
	if (typeof companyId !== 'string' || companyId === '')
		return { ok: false, reason: 'missing company_id' }
	const { fields: allowed, citations } = allowlistFields('contacts', fields)
	const badValue = checkFieldValues('contacts', allowed)
	if (badValue !== null) return { ok: false, reason: badValue }
	return {
		ok: true,
		companyId,
		fields: allowed,
		channels: parseChannels(fields['channels']),
		citations,
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
	/**
	 * True whenever a person set this apply going — one at a time or as a batch.
	 * Only the server acting on its own leaves it out, and then the run's opinion
	 * above and its written brief stay as they are: both are a model's words, and
	 * a writer that has not said somebody is watching has not earned the right to
	 * replace what a person wrote. Saying nothing therefore keeps what is already
	 * there, rather than quietly taking a person's freedom the way the unattended
	 * path once did.
	 */
	readonly attended?: boolean
}

// Serialize a json column value, or null to leave the stored one alone.
const jsonOrNull = (value: unknown): string | null =>
	value === null || value === undefined ? null : JSON.stringify(value)

// Absent and empty both mean the run recorded no rows, so neither should replace
// what is stored. An empty array is still valid json, so plain `jsonOrNull` would
// write it over the rows an earlier run put there.
const rowsOrNull = (value: unknown): string | null =>
	Array.isArray(value) && value.length === 0 ? null : jsonOrNull(value)

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
	// The run's own words about the company — how it judged the fit, and the brief
	// it wrote — as opposed to the values it went and found. These belong to the
	// company the run was about and need a person to read them: the brief is one
	// shared page with no earlier version kept, so replacing it with nobody
	// looking loses whatever somebody had written. The values themselves still
	// land, and so does the record of where each came from.
	const writesRunOpinion = isRunTarget && enrichment?.attended === true
	const fitVerdict = writesRunOpinion ? (enrichment?.fitVerdict ?? null) : null
	// A run that listed no fit rules judged nothing, so it must not wipe the rules
	// an earlier run did check. Conflicts below are left alone on purpose: an
	// empty list there is a real finding — the run looked, and the sources agreed.
	const fitChecks = writesRunOpinion ? rowsOrNull(enrichment?.fitChecks) : null
	const fitConflicts = writesRunOpinion
		? jsonOrNull(enrichment?.fitConflicts)
		: null
	// A brief that came back empty is not a brief. The writer model sometimes
	// returns nothing but its own reasoning, which strips to blank, and both
	// warnings a person gets before an apply already read that as nothing to
	// write — so writing it here would take their notes with nothing said.
	const written = writesRunOpinion ? (enrichment?.brief ?? null) : null
	const brief = written !== null && written.trim() !== '' ? written : null
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

/**
 * Who set an apply going. Each kind is trusted with a different amount.
 *
 * `person` is somebody deciding on one suggestion with the run in front of them.
 * `bulk` is somebody pressing apply on all of them at once, and a run that needs
 * reading first is exactly what a sweep must not pick up. `unattended` is the
 * server applying on its own, because whoever started the run set a threshold
 * asking for it; nobody sees it happen, so it may only write what a machine
 * checked.
 *
 * Every caller has to say which it is. One that could stay quiet would get a
 * person's freedom without anybody choosing that, which is how the unattended
 * path came to be replacing account notes nobody had read.
 */
export type ApplyOrigin = 'person' | 'bulk' | 'unattended'

export const resolveResearchProposedUpdate = (
	runId: string,
	proposedUpdateId: string,
	decision: 'apply' | 'reject',
	actorUserId: string | null,
	options: { readonly origin: ApplyOrigin },
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
		// caller can go round it. Only a sweep is stopped here: the server applying
		// on its own never reaches a run that needs reading, because it takes none
		// but a plain success in the first place.
		if (
			options.origin === 'bulk' &&
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
			// Where each of the new person's values was read — the same note an
			// update keeps, so a person the research found can be asked "where did
			// this job title come from?" like any other row.
			const createdSources = yield* resolveFieldSources(
				sql,
				runId,
				created.citations,
			)
			const inserted = yield* sql<{ id: string; version: number }>`
				INSERT INTO contacts ${sql.insert({
					...created.fields,
					companyId: created.companyId,
					organizationId: org.id,
					...(Object.keys(createdSources).length > 0
						? { fieldProvenance: createdSources }
						: {}),
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
						attended: options.origin !== 'unattended',
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
			{ origin: 'bulk' },
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
