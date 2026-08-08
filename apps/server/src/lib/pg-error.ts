/**
 * The Postgres error code (e.g. '22P02' bad-uuid, '23503' fk-violation, '23505'
 * duplicate-row) can sit a couple of `cause` levels down inside a wrapped
 * SqlError, so walk the chain rather than reading only the top cause.
 *
 * It lives here rather than beside any one caller because two of them now need
 * it — the research apply path and the channel writes — and they already point
 * at each other the other way round.
 */
export const pgErrorCode = (error: unknown): string | undefined => {
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
