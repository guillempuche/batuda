import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import * as p from '@clack/prompts'
import { Data, Effect } from 'effect'

import { ROOT } from '../shell'
import { getTarget } from './load-env'

export class CloudRefused extends Data.TaggedError('CloudRefused')<{
	readonly reason: string
}> {}

const AUDIT_LOG = resolve(ROOT, 'cloud-audit.log')

const parseHost = (url: string): string => {
	try {
		return new URL(url).hostname
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
 * Gate for destructive operations when `--env cloud`. No-op on local.
 *
 * Re-prompts the user to re-type the DB hostname verbatim. On mismatch or
 * cancel, fails with `CloudRefused` and appends a REFUSED line to
 * `cloud-audit.log`. On success, appends an OK line and resolves.
 */
export const confirmCloud = (command: string) =>
	Effect.gen(function* () {
		if (getTarget() !== 'cloud') return

		const expectedHost = parseHost(process.env['DATABASE_URL'] ?? '')
		const ts = new Date().toISOString()
		const user = process.env['USER'] ?? 'unknown'

		const typed = yield* Effect.promise(() =>
			p.text({
				message: `⚠  CLOUD \`${command}\` against ${expectedHost}. Re-type the hostname to confirm:`,
			}),
		)

		const isCancelled = p.isCancel(typed)
		const typedStr = isCancelled ? '<cancelled>' : typed.trim()

		if (isCancelled || typedStr !== expectedHost) {
			appendAudit(
				`${ts}\t${command}\tREFUSED\thost=${expectedHost}\ttyped=${typedStr}\tuser=${user}`,
			)
			return yield* Effect.fail(
				new CloudRefused({
					reason: isCancelled
						? 'Cancelled by user.'
						: `Expected "${expectedHost}", got "${typedStr}".`,
				}),
			)
		}

		appendAudit(`${ts}\t${command}\tOK\thost=${expectedHost}\tuser=${user}`)
	})
