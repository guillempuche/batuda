/**
 * A final, per-field "second look" over the extracted findings.
 *
 * The deterministic guards prove a value appears somewhere in the run's evidence
 * and that its citation was fetched — but not that the *cited quote* actually
 * backs the value, nor that the quote is about the target company rather than a
 * look-alike. This guard asks exactly that, one question per sourced field, and
 * blanks the fields that fail. It is the only guard that calls a model, so it runs
 * LAST (after the free deterministic guards have pruned the findings) and only
 * looks at values that still carry a source + quote — the per-field Sourced shape
 * introduced for enrichment scalars and contact channels.
 *
 * The judge is injected (the guard family's "check"), so the walk stays pure and
 * unit-testable without a model; research-service wires the judge to the extract
 * tier and fails open, keeping the guarded fields if the judge call errors.
 */

import { Effect, Schema } from 'effect'

// One extracted field to audit: its dotted path (enrichment.industry,
// contacts.0.email), the leaf key, the value, and the quote said to back it.
export interface FieldClaim {
	readonly id: string
	readonly field: string
	readonly value: unknown
	readonly quote: string
}

// The judge's ruling on one field: keep it, or drop it (with an optional reason).
export interface CriticVerdict {
	readonly id: string
	readonly keep: boolean
	readonly reason?: string
}

export interface CriticJudgeResult {
	readonly verdicts: ReadonlyArray<CriticVerdict>
	readonly outputTokens: number
}

// The injected model-backed check: rules on a batch of field claims in one call.
export type CriticJudge<E = never, R = never> = (
	claims: ReadonlyArray<FieldClaim>,
) => Effect.Effect<CriticJudgeResult, E, R>

export interface FieldCritiqueResult {
	readonly findings: unknown
	/** Fields sent to the judge. */
	readonly criticised: number
	/** Fields the judge rejected and this blanked. */
	readonly dropped: number
	readonly outputTokens: number
}

export interface CriticTarget {
	readonly name: string
	readonly domain?: string | undefined
}

// The strict json_schema the wired judge is asked to fill — also embedded in the
// prompt, per the extract tier's schema-in-both-places rule.
export const CriticVerdictsSchema = Schema.Struct({
	verdicts: Schema.Array(
		Schema.Struct({
			id: Schema.String,
			keep: Schema.Boolean,
			reason: Schema.optionalKey(Schema.String),
		}),
	),
})

// A per-field Sourced wrapper: { value, source_id, quote?, confidence? }. Keys on
// its own `value` + string `source_id`, which no other shape carries (a bare
// citation has source_id but no value; a channel has value but no source_id).
const isSourcedField = (
	v: unknown,
): v is { value: unknown; source_id: string; quote?: string } =>
	v !== null &&
	typeof v === 'object' &&
	!Array.isArray(v) &&
	'value' in v &&
	typeof (v as { source_id?: unknown }).source_id === 'string'

// Subtrees that are not per-field sourced values and must not be walked into: the
// block-level citation arrays and the freeform proposed-updates JSON blob (which
// could hold arbitrary { value, source_id }-looking objects).
const SKIP_KEYS = new Set(['citations', 'proposed_updates'])

const childPath = (path: string, key: string): string =>
	path === '' ? key : `${path}.${key}`

export const collectFieldClaims = (
	findings: unknown,
): ReadonlyArray<FieldClaim> => {
	const claims: FieldClaim[] = []
	const collect = (value: unknown, path: string): void => {
		if (Array.isArray(value)) {
			value.forEach((item, i) => {
				collect(item, childPath(path, String(i)))
			})
			return
		}
		if (value === null || typeof value !== 'object') return
		for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
			if (SKIP_KEYS.has(key)) continue
			const p = childPath(path, key)
			if (isSourcedField(v)) {
				// Only critique a field that offers a quote to check against; a
				// quote-less field was already vetted by the deterministic guards, so
				// leave it rather than spend a judgement guessing.
				const quote = v.quote
				if (typeof quote === 'string' && quote.trim() !== '') {
					claims.push({ id: p, field: key, value: v.value, quote })
				}
				continue
			}
			collect(v, p)
		}
	}
	collect(findings, '')
	return claims
}

export const applyCriticVerdicts = (
	findings: unknown,
	verdicts: ReadonlyArray<CriticVerdict>,
): { readonly findings: unknown; readonly dropped: number } => {
	// An id absent from `drop` (unknown id, or a field the judge gave no verdict
	// for) defaults to keep — the critic only removes what it affirmatively rejects.
	const drop = new Set(verdicts.filter(v => v.keep === false).map(v => v.id))
	let dropped = 0
	const apply = (value: unknown, path: string): unknown => {
		if (Array.isArray(value)) {
			return value.map((item, i) => apply(item, childPath(path, String(i))))
		}
		if (value === null || typeof value !== 'object') return value
		const out: Record<string, unknown> = {}
		for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
			if (SKIP_KEYS.has(key)) {
				out[key] = v
				continue
			}
			const p = childPath(path, key)
			if (isSourcedField(v)) {
				if (drop.has(p)) {
					dropped++
					out[key] = null
				} else {
					out[key] = v
				}
				continue
			}
			out[key] = apply(v, p)
		}
		return out
	}
	return { findings: apply(findings, ''), dropped }
}

export const critiqueFieldSupport = <E, R>(
	findings: unknown,
	judge: CriticJudge<E, R>,
): Effect.Effect<FieldCritiqueResult, E, R> =>
	Effect.gen(function* () {
		const claims = collectFieldClaims(findings)
		// No sourced+quoted fields (a scan/freeform schema, or empty findings) →
		// don't spend a model call.
		if (claims.length === 0) {
			return { findings, criticised: 0, dropped: 0, outputTokens: 0 }
		}
		const { verdicts, outputTokens } = yield* judge(claims)
		const { findings: applied, dropped } = applyCriticVerdicts(
			findings,
			verdicts,
		)
		return {
			findings: applied,
			criticised: claims.length,
			dropped,
			outputTokens,
		}
	})

// Builds the judge prompt: the target, the two acceptance questions, and the
// field list. The schema is passed to generateObject and also named here so the
// model sees the shape in both places.
export const criticPrompt = (
	target: CriticTarget,
	claims: ReadonlyArray<FieldClaim>,
): string => {
	const fields = claims
		.map(
			c =>
				`- id=${c.id} field=${c.field} value=${JSON.stringify(
					c.value,
				)} quote=${JSON.stringify(c.quote)}`,
		)
		.join('\n')
	return [
		`You are auditing extracted CRM fields for the company "${target.name}"${
			target.domain ? ` (official site ${target.domain})` : ''
		}.`,
		'For each field, set keep=true only if BOTH hold:',
		'1) the quote actually supports the value, and',
		'2) the quote is about this company, not a different or look-alike one.',
		'A value may be a short CRM category code (e.g. "serveis" = a services or',
		'finance business, "retail" = a shop, "manufactura" = a maker); judge whether',
		'the quote fits that category, not an exact word match.',
		'Otherwise set keep=false. Return exactly one verdict per id, matching the id verbatim.',
		'',
		'Fields:',
		fields,
	].join('\n')
}
