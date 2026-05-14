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
 * Shows the parsed DB hostname and asks for a `y/N` confirm (default no).
 * Cancelling or answering no fails with `CloudRefused` and appends a
 * REFUSED line to `cloud-audit.log`. Confirming appends an OK line and
 * resolves. The default-no posture is what keeps a stray Enter from
 * running a prod op.
 */
export const confirmCloud = (command: string) =>
	Effect.gen(function* () {
		if (getTarget() !== 'cloud') return

		const expectedHost = parseHost(process.env['DATABASE_URL'] ?? '')
		const ts = new Date().toISOString()
		const user = process.env['USER'] ?? 'unknown'

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
				`${ts}\t${command}\tREFUSED\thost=${expectedHost}\tanswer=${isCancelled ? '<cancelled>' : 'no'}\tuser=${user}`,
			)
			return yield* Effect.fail(
				new CloudRefused({
					reason: isCancelled
						? 'Cancelled by user.'
						: `Declined the y/N confirm for host "${expectedHost}".`,
				}),
			)
		}

		appendAudit(`${ts}\t${command}\tOK\thost=${expectedHost}\tuser=${user}`)
	})
