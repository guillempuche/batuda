import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

// portless serves the main checkout on the plain host and a linked worktree
// under its branch's last path segment. These branch names mean "no prefix".
const UNPREFIXED_BRANCHES = new Set(['main', 'master', 'HEAD'])
// The port an https URL with no port of its own already means.
const IMPLIED_HTTPS_PORT = '443'

const git = (...args: readonly string[]): string =>
	execFileSync('git', args, {
		encoding: 'utf-8',
		timeout: 5_000,
		stdio: ['ignore', 'pipe', 'ignore'],
	}).trim()

/**
 * Where the local proxy answers for this checkout, as far as it can be read.
 *
 * The link is minted from `BETTER_AUTH_BASE_URL`, which names neither part on
 * purpose: portless takes 443 when it can and a high port when it cannot, and it
 * serves a worktree under a host of its own. The server learns both from
 * `PORTLESS_URL` at boot, but this command runs on its own and never sees it, so
 * it works them out the same way portless does.
 */
const proxyRoute = (): { readonly prefix: string; readonly port: string } => {
	let prefix = ''
	let port = ''

	try {
		// Compared as git prints them, which is how portless compares them: from a
		// subdirectory it prints one absolute and the other relative. Resolving
		// them first would read better and answer differently, and the answer that
		// matters is the one portless reached, not the tidier one.
		const linked =
			git('rev-parse', '--git-dir') !== git('rev-parse', '--git-common-dir')
		const branch = linked ? git('rev-parse', '--abbrev-ref', 'HEAD') : ''
		if (branch !== '' && !UNPREFIXED_BRANCHES.has(branch)) {
			prefix = (branch.split('/').pop() ?? '')
				.toLowerCase()
				.replace(/[^a-z0-9-]/g, '-')
				.replace(/-{2,}/g, '-')
				.replace(/^-+|-+$/g, '')
		}
	} catch {
		// No git, or none that answers — the plain host is the best guess left.
	}

	try {
		// The same file /debug-apps reads.
		const read = readFileSync(
			resolve(homedir(), '.portless/proxy.port'),
			'utf-8',
		).trim()
		if (/^\d+$/.test(read) && read !== IMPLIED_HTTPS_PORT) port = read
	} catch {
		// No proxy to ask; leave the port off and let the URL mean 443.
	}

	return { prefix, port }
}

/**
 * Move a minted link onto the host and port that will answer for it.
 *
 * Only an address on this machine is touched: a link for a deployment has to be
 * printed exactly as minted, and prefixing its host would invent an address that
 * resolves nowhere.
 */
export const onProxyRoute = (
	url: string,
	route: { readonly prefix: string; readonly port: string },
): string => {
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		return url
	}

	const onThisMachine =
		parsed.hostname === 'localhost' || parsed.hostname.endsWith('.localhost')
	if (!onThisMachine) return url

	if (route.prefix !== '' && !parsed.hostname.startsWith(`${route.prefix}.`)) {
		parsed.hostname = `${route.prefix}.${parsed.hostname}`
	}
	// What the link already names beats what was read from the machine.
	if (route.port !== '' && parsed.port === '') parsed.port = route.port

	return parsed.toString()
}

/**
 * A sign-in link the developer can open as printed.
 */
export const reachableSignInLink = (url: string): string =>
	onProxyRoute(url, proxyRoute())
