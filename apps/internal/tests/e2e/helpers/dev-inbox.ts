import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Resolves the dev-inbox dir against the e2e runner's CWD. The local
 * transactional provider writes here whenever the server dispatches
 * email under the LOCAL provider. Tests poll this directory to capture
 * the URL embedded in the .md body.
 */
const INBOX_DIR = join(process.cwd(), '..', 'server', '.dev-inbox')

/**
 * Labels the local provider stamps on each .md. Filtering by label
 * avoids collisions when several tests share the inbox in sequence.
 */
export type DevInboxLabel = 'invitation' | 'magic-link' | 'password-reset'

export interface FoundEmail {
	readonly file: string
	readonly url: string
	readonly body: string
}

interface FindLatestOptions {
	readonly recipient: string
	readonly label: DevInboxLabel
	/**
	 * Only consider files whose mtime is at or after this epoch
	 * (typically `Date.now()` captured at test start). Filters out
	 * leftovers from prior suites that share the same recipient slug.
	 */
	readonly sinceMs: number
	/**
	 * Maximum total time to spend polling before giving up.
	 *
	 * @default 5000
	 */
	readonly maxWaitMs?: number
}

/**
 * Polls the dev-inbox directory for the newest `.md` matching all three
 * filters (recipient slug + label + mtime), and pulls out the first
 * URL pointing at an auth-related endpoint we care about.
 */
export async function findLatestEmail(
	options: FindLatestOptions,
): Promise<FoundEmail> {
	const { recipient, label, sinceMs, maxWaitMs = 5_000 } = options
	const slug = recipient.split('@')[0]!
	const deadline = Date.now() + maxWaitMs

	let lastError: unknown
	while (Date.now() < deadline) {
		try {
			const files = await readdir(INBOX_DIR)
			const candidates = files.filter(
				name => name.includes(slug) && name.endsWith('.md'),
			)
			const stamped = await Promise.all(
				candidates.map(async name => {
					const filePath = join(INBOX_DIR, name)
					const info = await stat(filePath)
					return { name, mtimeMs: info.mtimeMs }
				}),
			)
			const fresh = stamped
				.filter(entry => entry.mtimeMs >= sinceMs)
				.sort((a, b) => b.mtimeMs - a.mtimeMs)

			for (const entry of fresh) {
				const body = await readFile(join(INBOX_DIR, entry.name), 'utf8')
				if (!body.includes('labels:')) continue
				if (!body.includes(label)) continue
				const url = body.match(
					/https?:\/\/[^\s]*\/auth\/(?:magic-link|reset-password)[^\s]*/,
				)?.[0]
				if (url) {
					return { file: entry.name, url, body }
				}
			}
		} catch (cause) {
			lastError = cause
		}
		await new Promise(resolve => {
			setTimeout(resolve, 200)
		})
	}

	throw new Error(
		`No ${label} email for ${recipient} appeared in ${INBOX_DIR} within ${maxWaitMs}ms (last error: ${String(lastError)})`,
	)
}
