import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import * as p from '@clack/prompts'
import { Data, Effect } from 'effect'

import { ROOT } from '../shell'
import { getTarget } from './load-env'

export class CloudRefused extends Data.TaggedError('CloudRefused')<{
	readonly reason: string
}> {
	// The TUI prints `error.message` directly, so the reason has to live here.
	override get message(): string {
		return this.reason
	}
}

export class RemoteDatabaseRefused extends Data.TaggedError(
	'RemoteDatabaseRefused',
)<{
	readonly command: string
	readonly host: string
}> {
	// The TUI prints `error.message` directly, so the reason has to live here.
	override get message(): string {
		return `Refused to run \`${this.command}\` against ${this.host} — it is not a database on this machine.`
	}
}

const AUDIT_LOG = resolve(ROOT, 'cloud-audit.log')

// Hosts that mean "a database on this machine": plain local dev, a worktree's
// own database, and CI, which all run Postgres on localhost.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])

const parseHost = (url: string): string => {
	try {
		// IPv6 hostnames come back bracketed (`[::1]`); compare them unwrapped.
		return new URL(url).hostname.replace(/^\[|\]$/g, '')
	} catch {
		return 'unknown'
	}
}

const appendAudit = (line: string): void => {
	try {
		mkdirSync(dirname(AUDIT_LOG), { recursive: true })
		appendFileSync(AUDIT_LOG, `${line}\n`)
	} catch {
		// best-effort — never break the command if the log can't be written
	}
}

/**
 * Refuse outright to run a command against a database that isn't on this
 * machine. No prompt, because for the commands that use this there is no
 * correct answer to "do this to production?" — `db reset` and `seed` rebuild a
 * database from empty, so reaching a real one is never the intent, and a
 * confirm would still let a mistyped keystroke through.
 *
 * A connection string that won't parse is treated as remote: if the CLI can't
 * tell what it is about to wipe, it doesn't wipe it.
 */
export const requireLocalDatabase = (command: string) =>
	Effect.gen(function* () {
		const host = parseHost(process.env['DATABASE_URL'] ?? '')
		if (LOCAL_HOSTS.has(host)) return

		const timestamp = new Date().toISOString()
		const user = process.env['USER'] ?? 'unknown'
		appendAudit(`${timestamp}\t${command}\tBLOCKED\thost=${host}\tuser=${user}`)

		return yield* Effect.fail(new RemoteDatabaseRefused({ command, host }))
	})

/**
 * Gate for commands that write to a database somewhere other than this
 * machine. No-op when the target is local.
 *
 * The decision comes from the database the command is about to touch, not from
 * `--env cloud`. Credentials arrive through `infisical run`, so a production
 * connection string can reach the CLI whether or not anyone remembered the
 * flag — and a forgotten flag should not be the difference between a prompt
 * and a silently dropped production schema.
 *
 * Shows the parsed DB hostname and asks for a `y/N` confirm (default no).
 * Cancelling or answering no fails with `CloudRefused` and appends a REFUSED
 * line to `cloud-audit.log`. Confirming appends an OK line and resolves. The
 * default-no posture is what keeps a stray Enter from running a prod op, and a
 * connection string that won't parse counts as remote — an unnecessary prompt
 * costs a keystroke, a missed one costs the database.
 *
 * `confirmHost` replaces the prompt for callers without a terminal. It must
 * equal the host `DATABASE_URL` resolves to, and every outcome is recorded in
 * `cloud-audit.log`: `via=confirm-host` on agreement, `MISMATCH` otherwise.
 */
export const confirmCloud = (
	command: string,
	confirmHost?: string | undefined,
) =>
	Effect.gen(function* () {
		const expectedHost = parseHost(process.env['DATABASE_URL'] ?? '')
		const isLocal = LOCAL_HOSTS.has(expectedHost)
		const timestamp = new Date().toISOString()
		const user = process.env['USER'] ?? 'unknown'

		// Checked before the local shortcut: a caller that believes it reached
		// production but landed elsewhere would report success for work that
		// never happened.
		if (confirmHost !== undefined && confirmHost !== expectedHost) {
			appendAudit(
				`${timestamp}\t${command}\tMISMATCH\thost=${expectedHost}\tuser=${user}`,
			)
			return yield* Effect.fail(
				new CloudRefused({
					reason: `--confirm-host named "${confirmHost}" but DATABASE_URL resolves to "${expectedHost}".`,
				}),
			)
		}

		// `--env cloud` supplies settings but never credentials, so forgetting the
		// `infisical run` wrapper leaves the dev connection string in place. Saying
		// cloud and landing on this machine is a contradiction, not a default.
		if (getTarget() === 'cloud' && isLocal) {
			appendAudit(
				`${timestamp}\t${command}\tLOCAL_IN_CLOUD_MODE\thost=${expectedHost}\tuser=${user}`,
			)
			return yield* Effect.fail(
				new CloudRefused({
					reason: `--env cloud was passed, but DATABASE_URL resolves to "${expectedHost}" on this machine. Wrap the command in \`infisical run --env=prod --\` so the production credentials are injected.`,
				}),
			)
		}

		if (isLocal) return

		// Naming the host stands in for the prompt, so scripts and agents can run
		// this without a terminal. Deliberately not a bare `--yes`: a command
		// copied into the wrong environment stops instead of going through.
		if (confirmHost !== undefined) {
			appendAudit(
				`${timestamp}\t${command}\tOK\thost=${expectedHost}\tuser=${user}\tvia=confirm-host`,
			)
			return
		}

		const answer = yield* Effect.promise(() =>
			p.confirm({
				message: `⚠  Run \`${command}\` against ${expectedHost}?`,
				initialValue: false,
			}),
		)

		const isCancelled = p.isCancel(answer)
		const confirmed = !isCancelled && answer === true

		if (!confirmed) {
			appendAudit(
				`${timestamp}\t${command}\tREFUSED\thost=${expectedHost}\tanswer=${isCancelled ? '<cancelled>' : 'no'}\tuser=${user}`,
			)
			return yield* Effect.fail(
				new CloudRefused({
					reason: isCancelled
						? 'Cancelled by user.'
						: `Declined the y/N confirm for host "${expectedHost}".`,
				}),
			)
		}

		appendAudit(
			`${timestamp}\t${command}\tOK\thost=${expectedHost}\tuser=${user}`,
		)
	})
