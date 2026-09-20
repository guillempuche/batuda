import { Effect, Schema } from 'effect'

import { closeCutOffJson } from '../domain/cut-off-reply'
import { CutOffReply } from '../domain/errors'
import { isPlainObject } from './guard-shapes'

export interface SalvagedReply<A> {
	readonly value: A
	/** How many characters of what the model wrote were kept, and how many it wrote. */
	readonly keptChars: number
	readonly totalChars: number
	/**
	 * How many rows of the reply's list were kept and how many left out, when the
	 * reply was read row by row; absent when it decoded whole.
	 */
	readonly rows?: { readonly kept: number; readonly leftOut: number }
}

const parsed = (text: string): unknown => {
	try {
		return JSON.parse(text)
	} catch {
		return undefined
	}
}

/**
 * The complete part of a reply that ended before its JSON closed, read against
 * the shape it was asked for. The reply is closed at the innermost point first
 * and one container further out each time, so an entity the cut fell in is
 * dropped only when what arrived of it does not fit the shape. Nothing when the
 * failure carries no text, when no value arrived whole, or when nothing that
 * did fits the shape.
 *
 * Every one of those readings shares the reply's opening, so one row that does
 * not fit the shape fails them all, however many whole rows came after it.
 * Naming the reply's list (`listField`) reads it a second way when that
 * happens: each row on its own against the same shape, keeping the ones that
 * fit.
 */
export const salvageCutOffReply = <S extends Schema.Top>(
	err: unknown,
	schema: S,
	listField?: string | null,
): Effect.Effect<
	SalvagedReply<S['Type']> | undefined,
	never,
	S['DecodingServices']
> => {
	if (!(err instanceof CutOffReply)) return Effect.succeed(undefined)
	const candidates = closeCutOffJson(err.responseText)
	const totalChars = err.responseText.length
	const decode = Schema.decodeEffect(Schema.fromJsonString(schema))
	const decodeValue = Schema.decodeUnknownEffect(schema)
	type Reading = Effect.Effect<
		SalvagedReply<S['Type']> | undefined,
		never,
		S['DecodingServices']
	>

	// The rows of one candidate that fit the shape when each stands alone in the
	// list. Each key the reply wrote beside its list rides along when the reply
	// still decodes with it, so one key written wrong costs that key alone.
	const readRowByRowFrom = (at: number): Reading => {
		const candidate = candidates[at]
		if (candidate === undefined || listField == null)
			return Effect.succeed(undefined)
		const whole = parsed(candidate.text)
		const rows = isPlainObject(whole) ? whole[listField] : undefined
		if (!isPlainObject(whole) || !Array.isArray(rows) || rows.length === 0)
			return readRowByRowFrom(at + 1)
		return Effect.gen(function* () {
			const fitting: unknown[] = []
			for (const row of rows) {
				const fits = yield* decodeValue({ [listField]: [row] }).pipe(
					Effect.as(true),
					Effect.catch(() => Effect.succeed(false)),
				)
				if (fits) fitting.push(row)
			}
			if (fitting.length === 0) return yield* readRowByRowFrom(at + 1)
			const kept = {
				kept: fitting.length,
				leftOut: rows.length - fitting.length,
			}
			const asSalvaged = (value: S['Type']): SalvagedReply<S['Type']> => ({
				value,
				keptChars: candidate.keptChars,
				totalChars,
				rows: kept,
			})
			let reply: Record<string, unknown> = { [listField]: fitting }
			for (const [key, value] of Object.entries(whole)) {
				if (key === listField) continue
				const withKey = { ...reply, [key]: value }
				const fits = yield* decodeValue(withKey).pipe(
					Effect.as(true),
					Effect.catch(() => Effect.succeed(false)),
				)
				if (fits) reply = withKey
			}
			return yield* decodeValue(reply).pipe(
				Effect.map(asSalvaged),
				Effect.catch(() => readRowByRowFrom(at + 1)),
			)
		})
	}

	const readWholeFrom = (at: number): Reading => {
		const candidate = candidates[at]
		if (candidate === undefined) return readRowByRowFrom(0)
		return decode(candidate.text).pipe(
			Effect.map(value => ({
				value,
				keptChars: candidate.keptChars,
				totalChars,
			})),
			Effect.catch(() => readWholeFrom(at + 1)),
		)
	}
	return readWholeFrom(0)
}

/**
 * What a run keeps of a reply cut off a second time: the part that arrived
 * whole, or the cut-off itself when nothing whole fits the shape. Both are said
 * in the log, so a rescue that found nothing is told apart from one that never
 * ran.
 *
 * Where the reply is a list and the caller still holds the first cut-off reply,
 * both are read and the one with more rows ships: the second was asked to write
 * less per value, which does not mean it got further. A reply that is not a list
 * has no such measure — characters kept would favour the wordier first reply
 * over the fuller second — so there the latest reply stands alone.
 */
export const keepWhatArrived = <S extends Schema.Top, E>(
	cutOff: E,
	schema: S,
	researchId: string,
	options: {
		readonly listField?: string | null
		readonly earlierCutOff?: unknown
	} = {},
): Effect.Effect<{ readonly value: S['Type'] }, E, S['DecodingServices']> =>
	Effect.gen(function* () {
		const latest = yield* salvageCutOffReply(cutOff, schema, options.listField)
		const listField = options.listField
		const earlier =
			options.earlierCutOff === undefined || listField == null
				? undefined
				: yield* salvageCutOffReply(
						options.earlierCutOff,
						schema,
						options.listField,
					)
		const rowsIn = (reply: SalvagedReply<S['Type']>): number => {
			const rows =
				listField != null && isPlainObject(reply.value)
					? reply.value[listField]
					: undefined
			return Array.isArray(rows) ? rows.length : 0
		}
		const salvaged =
			earlier !== undefined &&
			(latest === undefined || rowsIn(earlier) > rowsIn(latest))
				? earlier
				: latest
		if (salvaged === undefined) {
			yield* Effect.logWarning('research.extraction.salvage_empty').pipe(
				Effect.annotateLogs({
					event: 'research.extraction.salvage_empty',
					research_id: researchId,
					total_chars:
						cutOff instanceof CutOffReply ? cutOff.responseText.length : 0,
				}),
			)
			yield* Effect.annotateCurrentSpan({
				'research.extraction.salvage_empty': 1,
			})
			return yield* Effect.fail(cutOff)
		}
		yield* Effect.logWarning('research.extraction.salvaged').pipe(
			Effect.annotateLogs({
				event: 'research.extraction.salvaged',
				research_id: researchId,
				kept_chars: salvaged.keptChars,
				total_chars: salvaged.totalChars,
				...(salvaged.rows === undefined
					? {}
					: {
							rows_kept: salvaged.rows.kept,
							rows_left_out: salvaged.rows.leftOut,
						}),
			}),
		)
		yield* Effect.annotateCurrentSpan({
			'research.extraction.salvaged': 1,
		})
		return { value: salvaged.value }
	})
