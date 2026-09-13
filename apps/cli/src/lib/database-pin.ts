/**
 * Refuse a measuring pass whose database is not the one this checkout works on.
 *
 * A pass is wrapped in `infisical run`, and an environment there can ship a
 * `DATABASE_URL` of its own. It arrives already exported, so it outranks the
 * `.env` beside this checkout and the whole pass lands in another worktree's
 * database — where its runs are mixed in with somebody else's and the sources
 * it reads back for grounding are not its own. Nothing fails; the numbers are
 * simply about the wrong data.
 *
 * `requireLocalDatabase` does not catch it: another worktree's database is on
 * this machine too.
 */

import { Data, Effect } from 'effect'

import { getDatabaseUrls } from './load-env'

/** Which database each side names, as host:port/database and never a password. */
export interface DatabasePinMismatch {
	readonly caller: string
	readonly file: string
}

export class DatabasePinRefused extends Data.TaggedError('DatabasePinRefused')<{
	readonly command: string
	readonly mismatch: DatabasePinMismatch
}> {
	// The TUI prints `error.message` directly, so the reason has to live here.
	override get message(): string {
		return [
			`Refused to run \`${this.command}\`: the environment points at ${this.mismatch.caller},`,
			`but this checkout's .env names ${this.mismatch.file}.`,
			'Take DATABASE_URL out of that environment, or pass --database-from-env to measure against the one the environment names.',
		].join(' ')
	}
}

const UNREADABLE = 'unreadable'

// What a connection string names, with the credentials left out, or nothing when
// it will not parse.
//
// Two spellings of the same database have to read alike, or a pass is refused
// over a difference that reaches the same rows: a string with no port means the
// standard one, and the loopback address is the same machine as localhost.
const label = (url: string): string | null => {
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		return null
	}
	const host =
		parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]'
			? 'localhost'
			: parsed.hostname
	const port = parsed.port === '' ? '5432' : parsed.port
	const database = parsed.pathname.replace(/^\//, '')
	return `${host}:${port}/${database}`
}

/**
 * Whether the connection string the caller exported and the one beside this
 * checkout reach different databases. Null when they agree, and null when there
 * is no pair to compare — a caller who exported nothing is already using the
 * file's own value, and a checkout with no file has nothing to be pinned to.
 *
 * A string that will not parse counts as a difference: a pin that cannot say
 * which database it is looking at should stop the pass, not wave it through.
 */
export const databasePinMismatch = (
	callerUrl: string | undefined,
	fileUrl: string | undefined,
): DatabasePinMismatch | null => {
	if (
		callerUrl === undefined ||
		callerUrl === '' ||
		fileUrl === undefined ||
		fileUrl === ''
	)
		return null
	const caller = label(callerUrl)
	const file = label(fileUrl)
	if (caller === null || file === null)
		return { caller: caller ?? UNREADABLE, file: file ?? UNREADABLE }
	return caller === file ? null : { caller, file }
}

/**
 * Stop a pass that would measure against a database this checkout does not own,
 * unless the caller said that is what they meant.
 */
export const requireDatabasePin = (command: string, allowFromEnv: boolean) =>
	Effect.gen(function* () {
		if (allowFromEnv) return
		const { caller, file } = getDatabaseUrls()
		const mismatch = databasePinMismatch(caller, file)
		if (mismatch === null) return
		return yield* Effect.fail(new DatabasePinRefused({ command, mismatch }))
	})
