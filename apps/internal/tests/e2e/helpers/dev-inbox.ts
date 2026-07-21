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
export type DevInboxLabel = 'member-added' | 'magic-link' | 'password-reset'

export interface FoundEmail {
	readonly file: string
	readonly url: string
	readonly body: string
}

export interface FoundMessage {
	readonly file: string
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
 * filters (recipient slug + label + mtime). `requireUrl` decides whether a
 * message without an auth URL counts as a match: sign-in and reset mail must
 * carry one, while the note telling someone they were added deliberately does
 * not — so waiting for a URL there would spin until the timeout.
 */
async function pollInbox(
	options: FindLatestOptions,
	requireUrl: boolean,
): Promise<FoundEmail | FoundMessage> {
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
				if (!requireUrl) return { file: entry.name, body }
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

/** Waits for mail that carries a link to follow — sign-in, password reset. */
export async function findLatestEmail(
	options: FindLatestOptions,
): Promise<FoundEmail> {
	return (await pollInbox(options, true)) as FoundEmail
}

/**
 * Waits for mail and returns only its body. Use for messages that carry no
 * link — the absence of one is usually the thing worth asserting.
 */
export async function findLatestMessage(
	options: FindLatestOptions,
): Promise<FoundMessage> {
	return await pollInbox(options, false)
}
