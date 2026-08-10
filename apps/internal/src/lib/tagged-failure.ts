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

/** Why a send was refused: the address that is blocked, and what it did. */
export type SuppressedRecipient = {
	readonly recipient: string
	readonly status: 'bounced' | 'complained'
	readonly reason: string | null
}

/**
 * The address a send was refused over, or null when the failure was something
 * else. The server names the address, says whether it bounced or was reported
 * as spam, and passes on whatever the receiving server said, so a screen can
 * point at the one recipient at fault instead of blaming the whole send.
 */
export function suppressedRecipient(
	cause: unknown,
): SuppressedRecipient | null {
	const error = taggedFailure(cause, 'EmailSuppressed')
	if (error === null) return null
	const recipient = error['recipient']
	const status = error['status']
	if (typeof recipient !== 'string' || recipient === '') return null
	if (status !== 'bounced' && status !== 'complained') return null
	const reason = error['reason']
	return {
		recipient,
		status,
		reason: typeof reason === 'string' && reason !== '' ? reason : null,
	}
}
