import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import * as p from '@clack/prompts'
import { Data, DateTime, Effect, Option } from 'effect'

import { ROOT } from '../shell'
import { isLocalDatabaseHost, resolveDatabaseHost } from './database-host'
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
	// Absent when the connection string could not be read at all.
	readonly host: string | null
}> {
	// The TUI prints `error.message` directly, so the reason has to live here.
	override get message(): string {
		return this.host === null
			? `Refused to run \`${this.command}\`: DATABASE_URL could not be read, so there is no telling which database it would reach.`
			: `Refused to run \`${this.command}\` against ${this.host} — it is not a database on this machine.`
	}
}

const AUDIT_LOG = resolve(ROOT, 'cloud-audit.log')

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
		const resolved = resolveDatabaseHost(process.env['DATABASE_URL'] ?? '')
		if (Option.isSome(resolved) && isLocalDatabaseHost(resolved.value)) return

		const host = Option.getOrNull(resolved)
		const timestamp = DateTime.formatIso(DateTime.nowUnsafe())
		const user = process.env['USER'] ?? 'unknown'
		appendAudit(
			`${timestamp}\t${command}\tBLOCKED\thost=${host ?? 'unreadable'}\tuser=${user}`,
		)

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
		const resolved = resolveDatabaseHost(process.env['DATABASE_URL'] ?? '')
		const isLocal =
			Option.isSome(resolved) && isLocalDatabaseHost(resolved.value)
		// What prompts and audit lines call the target, including when the
		// connection string gave us no host to name.
		const hostLabel = Option.getOrElse(resolved, () => 'unreadable')
		const timestamp = DateTime.formatIso(DateTime.nowUnsafe())
		const user = process.env['USER'] ?? 'unknown'

		// Checked before the local shortcut: a caller that believes it reached
		// production but landed elsewhere would report success for work that
		// never happened.
		if (
			confirmHost !== undefined &&
			!(Option.isSome(resolved) && confirmHost === resolved.value)
		) {
			appendAudit(
				`${timestamp}\t${command}\tMISMATCH\thost=${hostLabel}\tuser=${user}`,
			)
			return yield* Effect.fail(
				new CloudRefused({
					reason: Option.isSome(resolved)
						? `--confirm-host named "${confirmHost}" but DATABASE_URL resolves to "${resolved.value}".`
						: `--confirm-host named "${confirmHost}" but DATABASE_URL could not be read.`,
				}),
			)
		}

		// `--env cloud` supplies settings but never credentials, so forgetting the
		// `infisical run` wrapper leaves the dev connection string in place. Saying
		// cloud and landing on this machine is a contradiction, not a default.
		if (getTarget() === 'cloud' && isLocal) {
			appendAudit(
				`${timestamp}\t${command}\tLOCAL_IN_CLOUD_MODE\thost=${hostLabel}\tuser=${user}`,
			)
			return yield* Effect.fail(
				new CloudRefused({
					reason: `--env cloud was passed, but DATABASE_URL resolves to "${hostLabel}" on this machine. Wrap the command in \`infisical run --env=prod --\` so the production credentials are injected.`,
				}),
			)
		}

		if (isLocal) return

		// Naming the host stands in for the prompt, so scripts and agents can run
		// this without a terminal. Deliberately not a bare `--yes`: a command
		// copied into the wrong environment stops instead of going through.
		if (confirmHost !== undefined) {
			appendAudit(
				`${timestamp}\t${command}\tOK\thost=${hostLabel}\tuser=${user}\tvia=confirm-host`,
			)
			return
		}

		const answer = yield* Effect.promise(() =>
			p.confirm({
				message: `⚠  Run \`${command}\` against ${hostLabel}?`,
				initialValue: false,
			}),
		)

		const isCancelled = p.isCancel(answer)
		const confirmed = !isCancelled && answer === true

		if (!confirmed) {
			appendAudit(
				`${timestamp}\t${command}\tREFUSED\thost=${hostLabel}\tanswer=${isCancelled ? '<cancelled>' : 'no'}\tuser=${user}`,
			)
			return yield* Effect.fail(
				new CloudRefused({
					reason: isCancelled
						? 'Cancelled by user.'
						: `Declined the y/N confirm for host "${hostLabel}".`,
				}),
			)
		}

		appendAudit(`${timestamp}\t${command}\tOK\thost=${hostLabel}\tuser=${user}`)
	})
