/**
 * The shape tests the findings guards share.
 *
 * Every guard walks the same extracted-findings tree, so each had grown its own
 * copy of "is this a plain object?" and "is this a per-field value with its
 * source?". The copies had already drifted, which is the danger: a guard that
 * recognises one shape more loosely than its neighbour silently judges a
 * borderline object differently.
 *
 * The three value tests below are deliberately NOT one predicate — they answer
 * different questions, and each guard needs the one it asks:
 *  - `isValueWrapper` — anything carrying a `value`, however unprovenanced. The
 *    loosest; used where the guard reads the source itself and treats a missing
 *    one as its own signal.
 *  - `isSourcedField` — a `value` beside at least one provenance key
 *    (source_id / quote / confidence), which is what distinguishes a real
 *    per-field wrapper from an arbitrary object that happens to have a `value`.
 *  - `isCitedField` — a `value` whose `source_id` is a usable string. The
 *    strictest; used where the guard must actually resolve the citation.
 */

/** A non-null, non-array object — the only thing worth walking into. */
export const isPlainObject = (
	value: unknown,
): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)

/** Carries a `value`, with or without provenance. */
export const isValueWrapper = (
	value: unknown,
): value is { value: unknown; source_id?: unknown } =>
	isPlainObject(value) && 'value' in value

/**
 * The value itself, whether or not it arrived paired with the page it was read
 * on. A run is asked to send every changed value paired that way, so a guard that
 * reads the field flat is reading a wrapper, not text — and every check that
 * expects text then passes it without looking. Ask for the value through here
 * rather than unwrapping in place, so a guard added later gets it right by
 * default.
 */
export const unwrapValue = (value: unknown): unknown =>
	isValueWrapper(value) ? value.value : value

/**
 * The text a field holds, whether it is written bare or paired with the page it
 * was read on. Null when it holds neither.
 *
 * A field gains its provenance one day and every reader written against the bare
 * string goes quiet the same day — not wrong in a way anything reports, just
 * always answering "nothing here". That is what happened when a prospect's
 * website was paired with its source: four readers went on asking whether it was
 * a string, so site-based de-duplication, own-site establishment, the
 * shared-host verdict and the existence check's reading of a website all stopped
 * doing anything at all, and no test noticed because every fixture still held a
 * bare string.
 *
 * Both shapes have to be read for good: findings already stored keep whatever
 * shape they were written in, and nothing migrates them.
 */
export const readTextValue = (value: unknown): string | null => {
	const text = unwrapValue(value)
	return typeof text === 'string' && text.trim() !== '' ? text : null
}

/**
 * A per-field Sourced wrapper: `{ value, source_id?, quote?, confidence? }`.
 * The provenance key is what separates it from an arbitrary `{ value }` object.
 */
export const isSourcedField = (
	value: unknown,
): value is {
	value: unknown
	source_id?: unknown
	quote?: unknown
	confidence?: unknown
} =>
	isValueWrapper(value) &&
	('source_id' in value || 'quote' in value || 'confidence' in value)

/**
 * A Sourced wrapper whose citation is resolvable: `source_id` is a string. No
 * other shape carries both — a bare citation has a source_id but no value, a
 * contact channel has a value but no source_id.
 */
export const isCitedField = (
	value: unknown,
): value is { value: unknown; source_id: string; quote?: string } =>
	isValueWrapper(value) &&
	typeof (value as { source_id?: unknown }).source_id === 'string'

/**
 * The pages a row cites, by the id the model wrote.
 *
 * One reading, shared: the website guard asks it to tell a row's own site from
 * the page its claim was read on, and the existence verdict asks it to count
 * how many websites name the company. Two copies would let one of them accept
 * a citation the other drops, so the two would disagree about what a row cites.
 *
 * The ids come back as written. What is and is not a web address is a separate
 * question, and each caller screens for it with the reading its own direction
 * of error calls for.
 */
export const citedSourceIds = (
	value: Record<string, unknown>,
): ReadonlyArray<string> => {
	const citations = value['citations']
	if (!Array.isArray(citations)) return []
	return citations.flatMap(entry =>
		isPlainObject(entry) && typeof entry['source_id'] === 'string'
			? [entry['source_id']]
			: [],
	)
}
