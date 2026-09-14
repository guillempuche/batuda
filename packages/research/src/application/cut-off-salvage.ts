import { Effect, Schema } from 'effect'

import { closeCutOffJson } from '../domain/cut-off-reply'
import { CutOffReply } from '../domain/errors'

export interface SalvagedReply<A> {
	readonly value: A
	/** How many characters of what the model wrote were kept, and how many it wrote. */
	readonly keptChars: number
	readonly totalChars: number
}

/**
 * The complete part of a reply that ended before its JSON closed, read against
 * the shape it was asked for. The reply is closed at the innermost point first
 * and one container further out each time, so an entity the cut fell in is
 * dropped only when what arrived of it does not fit the shape. Nothing when the
 * failure carries no text, when no value arrived whole, or when nothing that
 * did fits the shape.
 */
export const salvageCutOffReply = <S extends Schema.Top>(
	err: unknown,
	schema: S,
): Effect.Effect<
	SalvagedReply<S['Type']> | undefined,
	never,
	S['DecodingServices']
> => {
	if (!(err instanceof CutOffReply)) return Effect.succeed(undefined)
	const candidates = closeCutOffJson(err.responseText)
	const decode = Schema.decodeEffect(Schema.fromJsonString(schema))
	const tryFrom = (
		at: number,
	): Effect.Effect<
		SalvagedReply<S['Type']> | undefined,
		never,
		S['DecodingServices']
	> => {
		const candidate = candidates[at]
		if (candidate === undefined) return Effect.succeed(undefined)
		return decode(candidate.text).pipe(
			Effect.map(value => ({
				value,
				keptChars: candidate.keptChars,
				totalChars: err.responseText.length,
			})),
			Effect.catch(() => tryFrom(at + 1)),
		)
	}
	return tryFrom(0)
}

/**
 * What a run keeps of a reply cut off a second time: the part that arrived
 * whole, said so in the log and counted on the run's span, or the cut-off
 * itself when nothing whole fits the shape.
 */
export const keepWhatArrived = <S extends Schema.Top, E>(
	cutOff: E,
	schema: S,
	researchId: string,
): Effect.Effect<{ readonly value: S['Type'] }, E, S['DecodingServices']> =>
	salvageCutOffReply(cutOff, schema).pipe(
		Effect.flatMap(salvaged =>
			salvaged === undefined
				? Effect.fail(cutOff)
				: Effect.logWarning('research.extraction.salvaged').pipe(
						Effect.annotateLogs({
							event: 'research.extraction.salvaged',
							research_id: researchId,
							kept_chars: salvaged.keptChars,
							total_chars: salvaged.totalChars,
						}),
						Effect.andThen(
							Effect.annotateCurrentSpan({
								'research.extraction.salvaged': 1,
							}),
						),
						Effect.as({ value: salvaged.value }),
					),
		),
	)
