/**
 * One shape for every field on a stored answer, for the people and assistants
 * reading it.
 *
 * ## The problem this solves
 *
 * A field on a scan's row is written one of two ways. Most are the value itself
 * — `"industry": "metalworking"`. A few are the value paired with the page it was
 * read on — `"website": { "value": "https://…", "source_id": "…", "confidence": 1 }`
 * — and which few has changed over time, one field at a time, as each was moved
 * so the per-field checks could grade it.
 *
 * Nothing migrates a stored run, so both shapes are on the wire forever and a
 * reader meets a mixture: a row from last year and a row from today, in one list,
 * with the same field written differently. Every reader then has to know which
 * fields are paired THIS WEEK, and one that guesses wrong does not fail — it
 * quietly reads nothing. That has already cost this codebase four readers at
 * once, the day a prospect's website was paired: site de-duplication, own-site
 * establishment, the shared-host verdict and the existence check all went silent
 * together, and every test stayed green because every fixture still held a bare
 * string.
 *
 * So the shape is settled here, once, on the way out. A reader gets the value
 * under the field's own name, always, and never has to know how it was stored.
 *
 * ## Where the provenance goes
 *
 * Not away. Which page a value was read on is the thing that makes a stored
 * answer worth anything, and dropping it to tidy the shape would be a worse
 * trade than the mixture. It moves to an `evidence` map beside the fields, keyed
 * by the field it belongs to:
 *
 * ```json
 * {
 *   "name": "Acme",
 *   "website": "https://acme.example",
 *   "evidence": { "website": { "source_id": "src_1", "confidence": 1 } }
 * }
 * ```
 *
 * Beside rather than inside, because a reader wanting the value is the common
 * case by a long way and should not pay for the rare one. A reader wanting the
 * page looks it up under the same name it already has.
 *
 * ## What it does not touch
 *
 * This runs on the way OUT, and only there. What the pipeline stores keeps the
 * paired shape, because that is what the per-field checks grade — flattening
 * before they run would take every field out of their reach, which is the exact
 * mistake that left `tax_id` and `industry` ungraded for as long as they were
 * bare.
 *
 * The step that writes a run's findings into the customer's own records reads
 * them from the database rather than through here, for the same reason: it
 * records which page each written value came from, and a flattened field would
 * have it write facts with no source.
 *
 * The stored shape has a settling step of its own, `paired-field-shape.ts`, which
 * runs the other way round: it PAIRS the fields a schema declares as paired, so a
 * guard that writes one back bare cannot leave the row a mixture. A field belongs
 * in that file's list or in neither — declared paired and left out of it, it
 * reaches storage in whichever shape the last guard happened to write.
 */

import { isPlainObject, isValueWrapper } from './guard-shapes'

/**
 * The key the provenance is gathered under.
 *
 * No schema defines a field by this name, and one added later would collide —
 * so a value already sitting here is left exactly as it is, and the fields that
 * would have been gathered stay paired. A reader then meets the old shape, which
 * is a shape it could already read; overwriting would destroy an answer instead.
 */
export const EVIDENCE_FIELD = 'evidence'

/**
 * Branches this does not walk into, the same two the per-field guard steps over.
 *
 * A proposed update carries `fields`, which is not a finding but a picture of a
 * customer's own record — column names and the values to write. Gathering
 * provenance there adds a key called `evidence` to that picture, and the screen
 * showing a person what would change then lists "Evidence" among the columns,
 * holding a blob. `citations` is a list of pages rather than a value read off
 * one, so there is nothing on it to settle either.
 */
const LEAVE_ALONE = new Set(['citations', 'proposed_updates'])

/** Which page one value was read on, and how sure the run was of it. */
export interface FieldEvidence {
	readonly source_id?: unknown
	readonly quote?: unknown
	readonly confidence?: unknown
	readonly as_of?: unknown
}

// Everything a pairing carries apart from the value itself. Listed rather than
// taken as "whatever is not `value`", so a key added to the wrapper has to be
// named here before it reaches a reader — an unlisted one would otherwise arrive
// under `evidence` with nobody having decided it should.
const PROVENANCE_KEYS = ['source_id', 'quote', 'confidence', 'as_of'] as const

const PROVENANCE = new Set<string>(PROVENANCE_KEYS)

/**
 * A field written as its value paired with where it came from.
 *
 * The page is optional, and that is the part worth being careful about: a value
 * that arrived bare is stored as `{ value }` with nothing beside it, because
 * there was no page to name and inventing one would turn a missing citation into
 * a false one. Most stored rows carry a location written exactly that way. Asked
 * for provenance before flattening, this would walk past every one of them and
 * hand a reader an object where it expects text.
 *
 * So a pairing is an object carrying `value` where nothing ELSE on it is
 * something other than provenance — which admits `{ value }` on its own, admits
 * a pairing that grows a key this file has not been told about, and refuses the
 * one shape that matters: a contact channel is `{ kind, value }`, and flattening
 * that to the value alone would lose which kind of channel it is.
 *
 * The two ways of being wrong are not equal, which is why it leans this way. Flatten
 * something that was not a pairing and a reader loses a key; miss one and a reader
 * gets an object it will try to print as text.
 */
const isPairedField = (
	value: unknown,
): value is { value: unknown } & Record<string, unknown> => {
	if (!isValueWrapper(value)) return false
	const others = Object.keys(value).filter(key => key !== 'value')
	return others.length === 0 || others.some(key => PROVENANCE.has(key))
}

const provenanceOf = (wrapper: Record<string, unknown>): FieldEvidence => {
	const evidence: Record<string, unknown> = {}
	for (const key of PROVENANCE_KEYS) {
		if (key in wrapper) evidence[key] = wrapper[key]
	}
	return evidence
}

/**
 * One object with its paired fields flattened and their provenance gathered.
 *
 * Returned unchanged when nothing on it was paired, so an answer that never used
 * the shape is handed back as it was rather than rebuilt.
 */
const flattenObject = (
	object: Record<string, unknown>,
): Record<string, unknown> => {
	// An object already carrying this key keeps its fields paired, provenance and
	// all: flattening the values with nowhere to put their pages would leave a
	// reader holding facts with nothing behind them.
	const evidenceKeyTaken = EVIDENCE_FIELD in object
	const flat: Array<readonly [string, unknown]> = []
	const evidence: Array<readonly [string, unknown]> = []
	for (const [key, value] of Object.entries(object)) {
		if (LEAVE_ALONE.has(key)) {
			flat.push([key, value])
			continue
		}
		if (!evidenceKeyTaken && isPairedField(value)) {
			flat.push([key, forReaders(value.value)])
			// Only where there is a page to name. A value that arrived bare is
			// stored paired with nothing beside it, and an empty entry here would
			// read as provenance a reader could go and look at.
			const page = provenanceOf(value)
			if (Object.keys(page).length > 0) evidence.push([key, page])
			continue
		}
		flat.push([key, forReaders(value)])
	}
	// Built from entries rather than by assigning keys: a stored answer is model
	// -written JSON, so it can hold a key called `__proto__`, and assigning that
	// one reaches the prototype setter instead of storing anything.
	if (evidence.length === 0) return Object.fromEntries(flat)
	return Object.fromEntries([
		...flat,
		[EVIDENCE_FIELD, Object.fromEntries(evidence)] as const,
	])
}

/**
 * A stored answer with every field written one way.
 *
 * Walks the whole tree rather than a list of known fields: which fields are
 * paired differs by schema and by when the run happened, and a walk that reads
 * the shape it meets is right for a run stored before this was written and for
 * one stored after a field is moved next year.
 */
export const forReaders = (findings: unknown): unknown => {
	if (Array.isArray(findings)) return findings.map(forReaders)
	if (!isPlainObject(findings)) return findings
	return flattenObject(findings)
}

/**
 * A run with its findings written one way, and everything else as it was.
 *
 * A run carrying no findings — one still working, or one that failed — is handed
 * straight back rather than rebuilt, so a missing answer stays missing instead of
 * becoming an empty one a reader would have to tell apart from a real one.
 */
export const runForReaders = <Run extends object>(run: Run): Run => {
	if (!('findings' in run)) return run
	const { findings } = run
	return findings === undefined || findings === null
		? run
		: { ...run, findings: forReaders(findings) }
}
