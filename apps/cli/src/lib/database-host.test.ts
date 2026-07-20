import { Option } from 'effect'
import { describe, expect, it } from 'vitest'

import { isLocalDatabaseHost, resolveDatabaseHost } from './database-host'

describe('resolveDatabaseHost', () => {
	describe('when the connection string names its host in the address', () => {
		it.each([
			['postgresql://batuda:batuda@localhost:5433/batuda', 'localhost'],
			['postgresql://u:p@127.0.0.1:5433/batuda', '127.0.0.1'],
			['postgresql://u:p@db.example.com:5432/batuda', 'db.example.com'],
			// IPv6 arrives bracketed and has to come back comparable.
			['postgresql://u:p@[::1]:5433/batuda', '::1'],
		])('should read %s as %s', (url, expected) => {
			// GIVEN a connection string with the host in the usual place
			// WHEN the host is resolved
			// THEN it matches the address
			expect(resolveDatabaseHost(url)).toStrictEqual(Option.some(expected))
		})
	})

	describe('when a query parameter overrides the address', () => {
		// The driver prefers `host=` over the address, so anything deciding where
		// a command is about to write has to prefer it too.
		it('should report the host the driver will actually dial', () => {
			// GIVEN an address of localhost but a query parameter naming a remote host
			const url =
				'postgresql://u:p@localhost:5432/db?host=ep-prod.eu-central-1.aws.neon.tech'

			// WHEN the host is resolved
			const host = resolveDatabaseHost(url)

			// THEN the remote host wins, not the reassuring-looking address
			expect(host).toStrictEqual(
				Option.some('ep-prod.eu-central-1.aws.neon.tech'),
			)
			expect(Option.isSome(host) && isLocalDatabaseHost(host.value)).toBe(false)
		})

		it('should treat a socket path as a database on this machine', () => {
			// GIVEN a connection string pointing at a Unix socket directory
			const url = 'postgresql://u:p@localhost:5432/db?host=/var/run/postgresql'

			// WHEN the host is resolved
			const host = resolveDatabaseHost(url)

			// THEN it stays local, since a socket file cannot be anywhere else
			expect(host).toStrictEqual(Option.some('/var/run/postgresql'))
			expect(Option.isSome(host) && isLocalDatabaseHost(host.value)).toBe(true)
		})
	})

	describe('when the connection string cannot be read', () => {
		// The driver's parser answers with a placeholder rather than failing, so
		// unreadable input must not be mistaken for a real host.
		it.each([
			['empty', ''],
			['not a URL', 'not-a-url'],
			['host-less', 'postgresql:///batuda'],
		])('should resolve %s to nothing', (_label, url) => {
			// GIVEN a connection string with no usable host
			// WHEN the host is resolved
			// THEN there is no host at all, rather than a placeholder that could
			// be mistaken for one
			expect(resolveDatabaseHost(url)).toStrictEqual(Option.none())
		})
	})
})

describe('isLocalDatabaseHost', () => {
	describe('when the host is on this machine', () => {
		it.each([
			'localhost',
			'127.0.0.1',
			'0.0.0.0',
			'::1',
			'/tmp',
		])('should accept %s', host => {
			// GIVEN a loopback address or a socket path
			// WHEN it is classified
			// THEN it counts as local
			expect(isLocalDatabaseHost(host)).toBe(true)
		})
	})

	describe('when the host is somewhere else', () => {
		// Alternative loopback spellings are deliberately not accepted: the guard
		// errs toward refusing rather than guessing.
		it.each([
			'db.example.com',
			'',
			'127.1',
			'2130706433',
			'localhost.evil.com',
		])('should reject %s', host => {
			// GIVEN anything that is not plainly a database on this machine
			// WHEN it is classified
			// THEN it does not count as local
			expect(isLocalDatabaseHost(host)).toBe(false)
		})
	})
})
