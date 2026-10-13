import { Schema, SchemaTransformation } from 'effect'

/**
 * A number as a query string carries it. Plain number parsing reads an empty or
 * blank value as 0, so `?minLat=` would quietly filter to latitudes above zero;
 * the text has to be there, with nothing around it, and has to be a finite
 * number.
 */
export const FiniteFromQuery = Schema.String.check(
	Schema.isNonEmpty(),
	Schema.isTrimmed(),
).pipe(Schema.decodeTo(Schema.Finite, SchemaTransformation.numberFromString))
