import { Option } from 'effect'
import { parse as parseConnectionString } from 'pg-connection-string'

// Addresses that mean "a database on this machine": plain local dev, a
// worktree's own database, and CI, which all run Postgres on localhost.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])

/**
 * Work out which host a connection string will actually reach, or nothing when
 * it cannot be read. A connection string can carry a `host=` setting that the
 * driver dials in preference to the address it appears to name, so the answer
 * comes from the driver's own parser: anything asking "am I about to touch
 * production?" has to agree with the code that opens the connection.
 */
export const resolveDatabaseHost = (url: string): Option.Option<string> => {
	// Text that is not a URL at all still gets a made-up host back from the
	// parser, so rule it out before trusting the answer.
	try {
		new URL(url)
	} catch {
		return Option.none()
	}

	try {
		const host = parseConnectionString(url).host ?? ''
		// IPv6 addresses come back wrapped in brackets; compare them unwrapped.
		return host === ''
			? Option.none()
			: Option.some(host.replace(/^\[|\]$/g, ''))
	} catch {
		return Option.none()
	}
}

/**
 * Whether a resolved host is a database on this machine. A path rather than an
 * address means a socket file, which cannot be anywhere else.
 */
export const isLocalDatabaseHost = (host: string): boolean =>
	host.startsWith('/') || LOCAL_HOSTS.has(host)

/**
 * Whether the database this process is configured for is on this machine. An
 * unreadable connection string counts as somewhere else, since a guard that
 * cannot tell where it is pointed should not proceed.
 */
export const isLocalDatabase = (): boolean =>
	Option.match(resolveDatabaseHost(process.env['DATABASE_URL'] ?? ''), {
		onNone: () => false,
		onSome: isLocalDatabaseHost,
	})
