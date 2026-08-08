/**
 * Reading a named error back out of a failed mutation.
 *
 * A mutation run with `mode: 'promiseExit'` hands back a cause rather than the
 * error itself, and the API client puts the decoded error inside one of that
 * cause's reasons. Without digging it out, every failure looks the same and a
 * screen can only say "try again" — even when the server sent a sentence written
 * for the reader.
 *
 * The shape it digs through belongs to the client, not to us, so it lives in one
 * place with one test rather than being worked out again wherever it is needed.
 */
export function taggedFailure(
	cause: unknown,
	tag: string,
): Record<string, unknown> | null {
	if (!cause || typeof cause !== 'object') return null
	const reasons = (cause as { reasons?: unknown }).reasons
	if (!Array.isArray(reasons)) return null
	for (const reason of reasons) {
		if (!reason || typeof reason !== 'object') continue
		const error = (reason as { error?: unknown }).error
		if (
			error !== null &&
			typeof error === 'object' &&
			(error as { _tag?: unknown })._tag === tag
		) {
			return error as Record<string, unknown>
		}
	}
	return null
}

/**
 * The sentence the server sent when it turned a write away, or null when the
 * failure was something else — a fault, a dropped connection — that has no
 * wording worth showing.
 */
export function badRequestMessage(cause: unknown): string | null {
	const message = taggedFailure(cause, 'BadRequest')?.['message']
	return typeof message === 'string' && message !== '' ? message : null
}
