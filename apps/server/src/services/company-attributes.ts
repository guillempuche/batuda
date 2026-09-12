import { Effect, Schema } from 'effect'
import type { SqlError, Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { AttributeRejected } from '@batuda/controllers'
import {
	ATTRIBUTE_QUOTE_MAX,
	type AttributeValue,
	type AttributeValueEntry,
	AttributeValueInput,
	type CompanyAttributesInput,
	coerceAttributeValue,
	isCalendarDay,
} from '@batuda/domain'
import {
	type AttributeFilter,
	type CheckedValue,
	type DeclaredAttribute,
	declaredByKey,
	isUuidRef,
	listActiveAttributes,
	validateAttributeFilter,
	validateAttributeWrite,
} from '@batuda/instructions'
import { recordFacts } from '@batuda/observability'
import { isPlainObject, isWebAddress } from '@batuda/research'

import { textAnywhere } from '../lib/search-text'
import {
	type FieldSource,
	pageFor,
	type RunPages,
	readRunPages,
} from './research-page-sources'

// The attributes an organisation declared, as they reach a company row: what a
// write to the `attributes` column does, and how a list is narrowed by one.
// The rules about a value live in the instructions package; this file turns a
// checked write into SQL, stamps who set each value, and keeps the record of
// where each fact came from in step.

const ATTRIBUTES_KEY = 'attributes'
const RESEARCH_ID_KEY = 'researchId'

// The name a value's source is filed under in `field_provenance`, beside the
// column names the other facts use.
export const attributeProvenanceKey = (key: string): string =>
	`attributes.${key}`

// A refusal answers the caller with its reason and puts the same reason on the
// request's record, where a 400 alone says nothing about why. The reason alone
// goes on the record: a key is the organisation's own word, a value its data.
const refuse = (error: AttributeRejected) =>
	recordFacts({ 'attribute.refused.reason': error.reason }).pipe(
		Effect.andThen(Effect.fail(error)),
	)

// The active declarations keyed by key. Read through the caller's row-level
// security and named by organisation as well, so a connection that sees every
// tenant still gets one organisation's.
const readDeclared = (
	sql: SqlClient.SqlClient,
	orgId: string,
): Effect.Effect<ReadonlyMap<string, DeclaredAttribute>, SqlError.SqlError> =>
	listActiveAttributes(orgId).pipe(
		Effect.map(declaredByKey),
		Effect.provideService(SqlClient.SqlClient, sql),
	)

// ── Writes ─────────────────────────────────────────────────────────────────

// A company write bag with the two things in it that are not columns lifted
// out: the attribute values as sent, and the research run they were read in.
export const splitCompanyAttributes = (
	data: Record<string, unknown>,
): {
	readonly columns: Record<string, unknown>
	readonly attributes: unknown
	readonly researchId: string | undefined
} => {
	const {
		[ATTRIBUTES_KEY]: attributes,
		[RESEARCH_ID_KEY]: rawRunId,
		...columns
	} = data
	const researchId = typeof rawRunId === 'string' ? rawRunId : undefined
	return { columns, attributes, researchId }
}

// What every write in one call reads once: the declarations, and — when a run
// was named — the pages that run fetched, so a value citing one of them can be
// recorded as the run's.
export interface AttributeWriteContext {
	readonly declared: ReadonlyMap<string, DeclaredAttribute>
	readonly run: { readonly id: string; readonly pages: RunPages } | undefined
}

export const readAttributeWriteContext = (
	sql: SqlClient.SqlClient,
	orgId: string,
	researchId: string | undefined,
): Effect.Effect<
	AttributeWriteContext,
	AttributeRejected | SqlError.SqlError
> =>
	Effect.gen(function* () {
		const declared = yield* readDeclared(sql, orgId)
		if (researchId === undefined) return { declared, run: undefined }
		// Checked for shape first: the column is a uuid, and asking it about
		// anything else is a database error rather than a run not found.
		const runs = isUuidRef(researchId)
			? yield* sql<{ id: string }>`
					SELECT id FROM research_runs
					WHERE id = ${researchId} AND organization_id = ${orgId}
					LIMIT 1
				`
			: []
		if (runs.length === 0)
			return yield* refuse(
				new AttributeRejected({ reason: 'unknown_run', key: null }),
			)
		const pages = yield* readRunPages(sql, researchId)
		return { declared, run: { id: researchId, pages } }
	})

// What one write does to the column and to the record of where each fact came
// from. Every write merges: keys not named are left alone.
export interface AttributeMerge {
	readonly entries: Readonly<Record<string, AttributeValueEntry>>
	readonly removed: ReadonlyArray<string>
	readonly provenance: Readonly<Record<string, FieldSource>>
	readonly provenanceCleared: ReadonlyArray<string>
}

const entryFrom = (
	checked: CheckedValue,
	source: { readonly sourceUrl: string; readonly runId: string } | undefined,
): AttributeValueEntry => ({
	value: checked.value,
	// A page the run did not fetch is kept only when the caller named it by its
	// address: a run's own id for a page means nothing outside that run.
	...(source !== undefined
		? { source_url: source.sourceUrl }
		: checked.source_id !== undefined && isWebAddress(checked.source_id)
			? { source_url: checked.source_id }
			: {}),
	...(checked.quote !== undefined ? { quote: checked.quote } : {}),
	...(checked.as_of !== undefined ? { as_of: checked.as_of } : {}),
	...(source !== undefined
		? { research_id: source.runId, set_by: 'research' as const }
		: { set_by: 'client' as const }),
})

// The values as sent, each read as the shape a value may take. The ways in —
// the HTTP routes and the assistant's tools — decode this shape too; checking
// it here as well means a caller that reaches this service another way gets the
// same refusal, with the key named, rather than a fault.
const readInput = (
	raw: unknown,
): Effect.Effect<CompanyAttributesInput, AttributeRejected> => {
	if (!isPlainObject(raw))
		return refuse(new AttributeRejected({ reason: 'wrong_kind', key: null }))
	const read: Array<[string, typeof AttributeValueInput.Type]> = []
	for (const [key, value] of Object.entries(raw)) {
		const decoded = Schema.decodeUnknownExit(AttributeValueInput)(value)
		if (decoded._tag === 'Failure')
			return refuse(new AttributeRejected({ reason: 'wrong_kind', key }))
		read.push([key, decoded.value])
	}
	return Effect.succeed(Object.fromEntries(read))
}

// Check a caller's attribute values against the declarations and decide who set
// each one. A value counts as research's only when the caller named a run of
// this organisation and the page the value cites is one that run fetched;
// anything else was set by the caller, whatever it says about its source.
export const attributeMergeFor = (
	context: AttributeWriteContext,
	input: unknown,
): Effect.Effect<AttributeMerge | undefined, AttributeRejected> =>
	Effect.gen(function* () {
		if (input === undefined) return undefined
		const check = validateAttributeWrite(
			context.declared,
			yield* readInput(input),
		)
		if (!check.ok)
			return yield* refuse(
				new AttributeRejected({ reason: check.reason, key: check.key }),
			)
		const { values, removed } = check.plan
		const entries: Array<[string, AttributeValueEntry]> = []
		const provenance: Array<[string, FieldSource]> = []
		const provenanceCleared: Array<string> = removed.map(attributeProvenanceKey)
		for (const [key, checked] of Object.entries(values)) {
			const page =
				context.run !== undefined && checked.source_id !== undefined
					? pageFor(context.run.pages, checked.source_id)
					: undefined
			const source =
				context.run !== undefined && page !== undefined
					? {
							sourceUrl: page,
							runId: context.run.id,
							...(checked.as_of !== undefined ? { asOf: checked.as_of } : {}),
						}
					: undefined
			entries.push([key, entryFrom(checked, source)])
			if (source !== undefined)
				provenance.push([attributeProvenanceKey(key), source])
			else provenanceCleared.push(attributeProvenanceKey(key))
		}
		return {
			entries: Object.fromEntries(entries),
			removed,
			provenance: Object.fromEntries(provenance),
			provenanceCleared,
		}
	})

// The two assignments a company UPDATE carries for a merge — or the columns
// unchanged when the write named no attributes.
export const attributeWriteFragments = (
	sql: SqlClient.SqlClient,
	merge: AttributeMerge | undefined,
): {
	readonly attributes: Statement.Fragment
	readonly fieldProvenance: Statement.Fragment
} =>
	merge === undefined
		? { attributes: sql`attributes`, fieldProvenance: sql`field_provenance` }
		: {
				attributes: sql`(attributes || ${JSON.stringify(merge.entries)}::jsonb) - ${merge.removed}::text[]`,
				fieldProvenance: sql`(COALESCE(field_provenance, '{}'::jsonb) || ${JSON.stringify(merge.provenance)}::jsonb) - ${merge.provenanceCleared}::text[]`,
			}

// ── Landing a run's own findings ───────────────────────────────────────────

// One attribute value a run's findings carry, with the page it cites.
export interface FoundAttribute {
	readonly value: AttributeValue
	readonly sourceId: string
	readonly quote?: string
	readonly asOf?: string
}

export interface ResearchAttributePatch {
	readonly values: Readonly<Record<string, FoundAttribute>>
	readonly dropped: ReadonlyArray<{
		readonly key: string
		readonly reason: 'undeclared' | 'wrong_kind' | 'ungrounded'
	}>
}

// Read the attribute values off a run's findings, keeping only the ones the
// organisation still declares, that read as the declared kind, and that cite a
// page. A key retired since the run finished is dropped rather than written
// under a name nothing reads any more.
export const researchAttributePatch = (
	declared: ReadonlyMap<string, DeclaredAttribute>,
	raw: unknown,
): ResearchAttributePatch => {
	const values: Array<[string, FoundAttribute]> = []
	const dropped: Array<ResearchAttributePatch['dropped'][number]> = []
	if (!isPlainObject(raw)) return { values: {}, dropped }
	for (const [key, found] of Object.entries(raw)) {
		const declaration = declared.get(key)
		if (declaration === undefined) {
			dropped.push({ key, reason: 'undeclared' })
			continue
		}
		if (!isPlainObject(found) || typeof found['source_id'] !== 'string') {
			dropped.push({ key, reason: 'ungrounded' })
			continue
		}
		const value = coerceAttributeValue(
			declaration.kind,
			found['value'],
			declaration.enumValues,
		)
		if (value === null) {
			dropped.push({ key, reason: 'wrong_kind' })
			continue
		}
		// The notes get the caps a person's write gets: a long quote is cut, a
		// date that names no day is dropped.
		values.push([
			key,
			{
				value,
				sourceId: found['source_id'],
				...(typeof found['quote'] === 'string'
					? { quote: found['quote'].slice(0, ATTRIBUTE_QUOTE_MAX) }
					: {}),
				...(typeof found['as_of'] === 'string' && isCalendarDay(found['as_of'])
					? { asOf: found['as_of'] }
					: {}),
			},
		])
	}
	return { values: Object.fromEntries(values), dropped }
}

// The citations a patch carries, in the shape the page-source resolution reads,
// filed under the provenance key each value will be stored beside.
export const researchAttributeCitations = (
	patch: ResearchAttributePatch,
): Record<string, { readonly sourceId: string; readonly asOf?: string }> =>
	Object.fromEntries(
		Object.entries(patch.values).map(([key, found]) => [
			attributeProvenanceKey(key),
			{
				sourceId: found.sourceId,
				...(found.asOf !== undefined ? { asOf: found.asOf } : {}),
			},
		]),
	)

// What became of each value the run found: the entries a run may store, the
// keys held back because a person set them by hand, and the keys whose cited
// page the run never fetched. A person's word stays; the run's reading is
// still in its findings for anyone who wants it.
export interface ResearchAttributeLanding {
	readonly entries: Readonly<Record<string, AttributeValueEntry>>
	readonly held: ReadonlyArray<string>
	readonly unfetched: ReadonlyArray<string>
}

export const researchAttributeEntries = (
	patch: ResearchAttributePatch,
	sources: Readonly<Record<string, FieldSource>>,
	runId: string,
	storedAttributes: unknown,
): ResearchAttributeLanding => {
	const storedValues = isPlainObject(storedAttributes) ? storedAttributes : {}
	const entries: Array<[string, AttributeValueEntry]> = []
	const held: Array<string> = []
	const unfetched: Array<string> = []
	for (const [key, found] of Object.entries(patch.values)) {
		const source = sources[attributeProvenanceKey(key)]
		if (source === undefined) {
			unfetched.push(key)
			continue
		}
		const stored = storedValues[key]
		if (isPlainObject(stored) && stored['set_by'] === 'client') {
			held.push(key)
			continue
		}
		entries.push([
			key,
			{
				value: found.value,
				source_url: source.sourceUrl,
				...(found.quote !== undefined ? { quote: found.quote } : {}),
				...(found.asOf !== undefined ? { as_of: found.asOf } : {}),
				research_id: runId,
				set_by: 'research',
			},
		])
	}
	return { entries: Object.fromEntries(entries), held, unfetched }
}

// One write's merge, or nothing when the write named no attributes. An
// ordinary edit then reads no declaration at all, and a run id sent without
// values changes nothing, since it only says where values came from.
export const readAttributeMerge = (
	sql: SqlClient.SqlClient,
	orgId: string,
	write: {
		readonly attributes: unknown
		readonly researchId: string | undefined
	},
): Effect.Effect<
	AttributeMerge | undefined,
	AttributeRejected | SqlError.SqlError
> =>
	write.attributes === undefined
		? Effect.succeed(undefined)
		: Effect.flatMap(
				readAttributeWriteContext(sql, orgId, write.researchId),
				context => attributeMergeFor(context, write.attributes),
			)

// ── Filters ────────────────────────────────────────────────────────────────

export interface AttributeFilterParts {
	readonly attributeKey?: string | undefined
	readonly attributeOp?: string | undefined
	readonly attributeValue?: string | undefined
}

// Turn the three filter parts a list was asked with into a checked filter, or
// nothing when none were given. Reads the declarations only when asked to.
export const resolveAttributeFilter = (
	sql: SqlClient.SqlClient,
	orgId: string,
	parts: AttributeFilterParts,
): Effect.Effect<
	AttributeFilter | undefined,
	AttributeRejected | SqlError.SqlError
> =>
	Effect.gen(function* () {
		if (
			parts.attributeKey === undefined &&
			parts.attributeOp === undefined &&
			parts.attributeValue === undefined
		)
			return undefined
		const declared = yield* readDeclared(sql, orgId)
		const check = validateAttributeFilter(declared, {
			key: parts.attributeKey,
			op: parts.attributeOp,
			value: parts.attributeValue,
		})
		if (!check.ok)
			return yield* refuse(
				new AttributeRejected({
					reason: check.reason,
					key: parts.attributeKey ?? null,
				}),
			)
		return check.filter
	})

const ISO_DAY = '^\\d{4}-\\d{2}-\\d{2}$'

// The SQL a checked filter narrows a company list by. A number is compared as
// a number only where the stored value is one, and a date only where it has the
// date shape — a value that got in under an earlier meaning of the key matches
// nothing instead of failing the whole list.
export const attributeCondition = (
	sql: SqlClient.SqlClient,
	filter: AttributeFilter,
): Statement.Fragment => {
	if ('undeclared' in filter) return sql`false`
	const key = filter.key
	// The key is bound as an untyped parameter; the cast says it is a name,
	// not a position in an array.
	const stored = sql`attributes->${key}::text->>'value'`
	// A checked filter always carries a value; one that somehow carries none
	// matches nothing rather than asking for a comparison with an empty list.
	const [first] = filter.values
	if (first === undefined) return sql`false`
	const text = String(first)
	switch (filter.kind) {
		case 'text':
		case 'enum':
		case 'boolean':
			if (filter.op === 'in')
				return sql`${stored} IN ${sql.in(filter.values.map(String))}`
			if (filter.op === 'contains')
				return sql`normalize(${stored}) ILIKE ${textAnywhere(text)}`
			return sql`${stored} = ${text}`
		case 'number': {
			const isNumber = sql`jsonb_typeof(attributes->${key}::text->'value') = 'number'`
			const asNumber = sql`(${stored})::numeric`
			const compare =
				filter.op === 'gte'
					? sql`${asNumber} >= ${first}`
					: filter.op === 'lte'
						? sql`${asNumber} <= ${first}`
						: sql`${asNumber} = ${first}`
			return sql`CASE WHEN ${isNumber} THEN ${compare} ELSE false END`
		}
		case 'date': {
			// Text against text: the shape is year-month-day, so the plain order of
			// the characters is the order of the days.
			const isDay = sql`${stored} ~ ${ISO_DAY}`
			const compare =
				filter.op === 'gte'
					? sql`${stored} >= ${text}`
					: filter.op === 'lte'
						? sql`${stored} <= ${text}`
						: sql`${stored} = ${text}`
			return sql`CASE WHEN ${isDay} THEN ${compare} ELSE false END`
		}
		// A kind the code does not know matches nothing.
		default:
			return sql`false`
	}
}
