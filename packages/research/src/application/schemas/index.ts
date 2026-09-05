import { Schema } from 'effect'

import { discoveryResultField } from '../discovery-scan'
import { isPlainObject } from '../guard-shapes'
import { CompanyEnrichmentV1Schema } from './company-enrichment-v1'
import { CompetitorScanV1Schema } from './competitor-scan-v1'
import { ContactDiscoveryV1Schema } from './contact-discovery-v1'
import { FreeformSchema } from './freeform'
import { ProspectScanV1Schema } from './prospect-scan-v1'

// Closed set of server-compiled Effect Schemas. Versioned so schemas can
// evolve without breaking old runs. The service resolves a name here for
// LanguageModel.generateObject.
//
// `satisfies` rather than a `Record<string, …>` annotation: the annotation
// checks the same thing but throws the five names away afterwards, leaving
// every table keyed by them free to fall out of step with this one silently.
export const schemaRegistry = {
	freeform: FreeformSchema,
	company_enrichment_v1: CompanyEnrichmentV1Schema,
	competitor_scan_v1: CompetitorScanV1Schema,
	contact_discovery_v1: ContactDiscoveryV1Schema,
	prospect_scan_v1: ProspectScanV1Schema,
} satisfies Record<string, Schema.Top>

export type SchemaName = keyof typeof schemaRegistry

// Runtime list of the registry's keys, so the API boundary can reject an
// unknown schema_name up front instead of letting a doomed run be created.
// Read off the registry, so the two cannot disagree; reading an object's keys
// only ever promises strings, and the cast names them back.
export const schemaNames = Object.keys(
	schemaRegistry,
) as ReadonlyArray<SchemaName>

// The same closed set as an Effect Schema, so HTTP/MCP boundaries can validate
// schema_name with one import instead of writing the names out again.
export const SchemaNameSchema = Schema.Literals(schemaNames)

/** Whether a name, from wherever it arrived, is one this build still has. */
export const isSchemaName = (name: string): name is SchemaName =>
	Object.hasOwn(schemaRegistry, name)

/**
 * The schema behind a name, or nothing when there is no such schema here.
 *
 * Names reach this from outside the type system — off a run row written months
 * ago, or from a caller — so a name that has been retired since has to come
 * back as nothing rather than as a schema that is not there.
 */
export const resolveSchema = (name: string): Schema.Top | undefined =>
	isSchemaName(name) ? schemaRegistry[name] : undefined

/**
 * The kind of research a request asked for, or — when it did not say — the kind
 * its own shape implies.
 *
 * A request pinned to records we already hold is asking about those; one pinned
 * to nothing is asking for companies we do not have yet. A brief is neither, so
 * it stays something a caller has to ask for by name: it is the one shape with
 * no list of companies in it, and every check that catches a thin result reads
 * that list, so a hunt for companies answered as a brief comes back holding none
 * and still calls itself a success.
 *
 * A name we do not recognise is handed back untouched rather than swapped for a
 * guess, so a run asking for a kind of research this build no longer has still
 * stops and says so. A blank one is not a name at all, so it counts as saying
 * nothing rather than as a kind that has been retired.
 */
export const schemaNameFor = (request: {
	readonly schemaName?: string | null | undefined
	readonly context?:
		| {
				readonly subjects?: ReadonlyArray<unknown> | undefined
				readonly selector?: unknown
		  }
		| null
		| undefined
}): string => {
	const asked = request.schemaName?.trim()
	if (asked) return asked
	const context = request.context
	// A filter counts as pinned as much as a list of ids does: it picks out
	// companies already here, one run each, rather than asking for new ones.
	const pinned =
		(context?.subjects?.length ?? 0) > 0 ||
		(context?.selector !== undefined && context.selector !== null)
	// Typed as a registry key, so a typo here is a build error rather than a run
	// that starts and then finds no such schema.
	const inferred: SchemaName = pinned
		? 'company_enrichment_v1'
		: 'prospect_scan_v1'
	return inferred
}

// Fields every schema carries that are not something to go and find out: they
// are how a run hands work back to the CRM, and the prompt covers them where it
// explains that work.
const PLUMBING_FIELDS = new Set([
	'proposed_updates',
	'pending_paid_actions',
	'discovered_existing',
])

/**
 * The fields inside a block of them, seeing past an optional wrapper.
 *
 * A list of repeated things — the people, the competitors — stays closed. Naming
 * it is what the searching agent needs: it has to know to go and find people at
 * all, while each person's own fields are a detail for whoever writes them down
 * afterwards, and every extra word competes for the attention of a small model
 * with little to spare. It stays closed only because a list holds its entry
 * shape under a name this walk does not follow, so the test next door pins the
 * result exactly.
 *
 * A shape is callable as well as readable, so it answers "function" rather than
 * "object" when asked what it is. Looking only for an object walks straight past
 * every one of them, leaving a block that appears to hold no fields — no error,
 * just a prompt that never mentions them.
 */
const innerFields = (field: unknown): Record<string, unknown> | undefined => {
	const seen = new Set<unknown>()
	let current = field
	while (
		current !== null &&
		(typeof current === 'object' || typeof current === 'function') &&
		!seen.has(current)
	) {
		seen.add(current)
		const own = (current as { fields?: Record<string, unknown> }).fields
		if (own !== undefined) return own
		current = (current as { schema?: unknown }).schema
	}
	return undefined
}

/**
 * The names of everything a run of this kind is expected to come back with,
 * read off the schema itself so the two can never drift apart.
 *
 * The agent doing the searching is told the schema only by name, which tells it
 * nothing: it goes looking for the facts the instructions happen to mention and
 * leaves the rest of the profile empty, never having been told those fields
 * exist. A nested block is listed as `block.field`, since that is how the
 * output is shaped. Empty for a run that writes a brief rather than a profile.
 */
export const schemaFieldNames = (schemaName: string): ReadonlyArray<string> => {
	const schema = resolveSchema(schemaName)
	const fields = (schema as { fields?: Record<string, unknown> } | undefined)
		?.fields
	if (fields === undefined) return []
	const names: string[] = []
	for (const [key, field] of Object.entries(fields)) {
		if (PLUMBING_FIELDS.has(key)) continue
		const nested = innerFields(field)
		if (nested === undefined) {
			names.push(key)
			continue
		}
		for (const inner of Object.keys(nested)) names.push(`${key}.${inner}`)
	}
	return names
}

/**
 * The field each kind of run fills with the rows it went looking for — beyond
 * the two open-ended scans, which are not named here.
 *
 * Which list holds a scan's companies is `discovery-scan.ts`'s to say, and that
 * file is deliberately the only place the scan schemas are named, so nothing
 * here may name one of them and quietly disagree. They are listed as null and
 * read through `discoveryResultField` below; everything else is named here, so
 * retiring or renaming a schema fails the build until this table follows.
 *
 * `null` marks a kind that goes looking for no such list at all: a brief is
 * prose, and an enrichment answers about one company that was already known.
 */
const NON_SCAN_FOUND_FIELD = {
	freeform: null,
	company_enrichment_v1: null,
	// A hunt for people is not an open-ended scan — it is never retried for
	// coming back thin — so it stays out of that file's table and is named here.
	contact_discovery_v1: 'contacts',
	competitor_scan_v1: null,
	prospect_scan_v1: null,
} satisfies Record<SchemaName, string | null>

/**
 * Which list a kind of run fills with what it went looking for, or null for a
 * kind that hunts for none. Settled from the run's schema, which never changes,
 * so a caller reading the same run repeatedly asks once.
 */
export const foundRowsField = (schemaName: string | null): string | null => {
	// A run stored before the schema column existed counts as a brief, and a name
	// this build no longer has is not one anybody can be told a number for.
	const name = schemaName ?? 'freeform'
	if (!isSchemaName(name)) return null
	return discoveryResultField(name) ?? NON_SCAN_FOUND_FIELD[name]
}

/**
 * How many rows a run has found so far, or null for a kind that hunts for none.
 *
 * Findings arrive as plain JSON written by a model, so nothing guarantees the
 * field is there or that it holds a list; anything else counts as none found
 * rather than as an error, because a half-written run is the normal case while
 * one is still going.
 */
export const countFoundRows = (
	schemaName: string | null,
	findings: unknown,
): number | null => {
	const field = foundRowsField(schemaName)
	if (field === null) return null
	if (!isPlainObject(findings)) return 0
	const rows = findings[field]
	return Array.isArray(rows) ? rows.length : 0
}

/**
 * How many of a run's proposed changes are still waiting on a decision. Every
 * kind of run can carry these, so it is not keyed by schema.
 */
export const countPendingProposals = (findings: unknown): number => {
	if (!isPlainObject(findings)) return 0
	const proposals = findings['proposed_updates']
	if (!Array.isArray(proposals)) return 0
	return proposals.filter(p => isPlainObject(p) && p['status'] === 'pending')
		.length
}

export {
	CompanyEnrichmentV1Schema,
	CompetitorScanV1Schema,
	ContactDiscoveryV1Schema,
	FreeformSchema,
	ProspectScanV1Schema,
}
