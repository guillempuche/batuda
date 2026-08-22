import { execFileSync } from 'node:child_process'

// Every address the local proxy serves sits under this suffix, and what comes
// before it is the name it knows the service by.
const LOCAL_SUFFIX = '.localhost'

/**
 * The name the local proxy knows a host by, or nothing when it serves no such
 * host — a deployment, or a bare `localhost` with no name in front of it.
 */
export const serviceNameFor = (hostname: string): string | null => {
	if (!hostname.endsWith(LOCAL_SUFFIX)) return null
	const service = hostname.slice(0, -LOCAL_SUFFIX.length)
	return service === '' ? null : service
}

/**
 * The address the local proxy serves a named service on, or nothing when it
 * cannot be asked.
 *
 * It answers from its own naming rule rather than from anything running, so this
 * works before the server is started, and the answer already accounts for the
 * port it managed to bind and for a worktree being served under a host of its
 * own. Asking it beats working the same answer out here: the rules are its to
 * change, and a copy of them here would drift the first time they did.
 */
const proxyOrigin = (service: string): string | null => {
	try {
		const printed = execFileSync('pnpm', ['exec', 'portless', 'get', service], {
			encoding: 'utf-8',
			timeout: 15_000,
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim()
		return printed.startsWith('https://') || printed.startsWith('http://')
			? printed
			: null
	} catch {
		// No proxy to ask, so the link stands as it was minted.
		return null
	}
}

/**
 * Move a link onto a given address, keeping everything that identifies it.
 *
 * Only the scheme, host and port are replaced: the path, the token and the
 * callback have to survive exactly, since re-encoding any of them would break
 * the sign-in the link exists for.
 */
export const onProxyOrigin = (url: string, origin: string): string => {
	try {
		const parsed = new URL(url)
		const proxy = new URL(origin)
		parsed.protocol = proxy.protocol
		parsed.host = proxy.host
		// Assigning a host with no port of its own leaves any port already on the
		// link in place, so the port is set on its own to follow the proxy either
		// way — an empty one clears it.
		parsed.port = proxy.port
		return parsed.toString()
	} catch {
		return url
	}
}

/**
 * A sign-in link the developer can open as printed.
 *
 * The link is minted from `BETTER_AUTH_BASE_URL`, which names no port and no
 * worktree on purpose. The server fills both in from `PORTLESS_URL` at boot, but
 * this command runs on its own and never sees it, so it asks the proxy directly.
 * A link for a deployment is left exactly as minted.
 */
export const reachableSignInLink = (url: string): string => {
	let hostname: string
	try {
		hostname = new URL(url).hostname
	} catch {
		return url
	}

	const service = serviceNameFor(hostname)
	if (service === null) return url

	const origin = proxyOrigin(service)
	return origin === null ? url : onProxyOrigin(url, origin)
}
