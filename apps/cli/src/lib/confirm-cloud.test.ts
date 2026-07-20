import { Cause, Effect, Exit } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The audit writer appends to a real file at the repo root. Capture the lines
// instead so assertions can read them and the developer's log stays clean.
const auditLines: string[] = []
vi.mock('node:fs', () => ({
	appendFileSync: (_path: string, line: string) => {
		auditLines.push(String(line).trimEnd())
	},
	mkdirSync: () => undefined,
}))

// `getTarget` reads module state that only `loadEnv` sets, and loading env
// files mid-test would trample process.env. Drive it directly instead.
let target: 'local' | 'cloud' = 'local'
vi.mock('./load-env', () => ({
	getTarget: () => target,
}))

const {
	CloudRefused,
	confirmCloud,
	RemoteDatabaseRefused,
	requireLocalDatabase,
} = await import('./confirm-cloud')

const runExit = <A, E>(effect: Effect.Effect<A, E>) =>
	Effect.runSyncExit(effect as Effect.Effect<A, E, never>)

// Both guard errors extend Error, so the caller reads `.message` directly —
// the classes arrive via a dynamic import and so exist only as values here.
const failureOf = (exit: Exit.Exit<unknown, unknown>): Error => {
	if (Exit.isSuccess(exit)) throw new Error('expected the effect to fail')
	return Cause.squash(exit.cause) as Error
}

describe('requireLocalDatabase', () => {
	beforeEach(() => {
		auditLines.length = 0
		target = 'local'
	})
	afterEach(() => {
		delete process.env['DATABASE_URL']
	})

	describe('when the database is on this machine', () => {
		// Every form a local Postgres shows up as, including the bracketed IPv6
		// literal the URL parser hands back.
		const localUrls = [
			'postgresql://batuda:batuda@localhost:5433/batuda',
			'postgresql://batuda:batuda@127.0.0.1:5433/batuda',
			'postgresql://batuda:batuda@0.0.0.0:5433/batuda',
			'postgresql://batuda:batuda@[::1]:5433/batuda',
		]

		it.each(localUrls)('should allow %s', url => {
			// GIVEN a connection string pointing at this machine
			process.env['DATABASE_URL'] = url

			// WHEN the guard runs
			const exit = runExit(requireLocalDatabase('db reset'))

			// THEN it passes and records nothing
			expect(Exit.isSuccess(exit)).toBe(true)
			expect(auditLines).toEqual([])
		})
	})

	describe('when the database is somewhere else', () => {
		it('should refuse and name the host', () => {
			// GIVEN a connection string pointing at a remote database
			process.env['DATABASE_URL'] =
				'postgresql://u:p@db.example.com:5432/batuda'

			// WHEN the guard runs
			const exit = runExit(requireLocalDatabase('db reset'))

			// THEN it fails with the host named, and says so in plain words
			const error = failureOf(exit)
			expect(error).toBeInstanceOf(RemoteDatabaseRefused)
			expect(error).toMatchObject({
				command: 'db reset',
				host: 'db.example.com',
			})
			expect(error.message).toContain('db.example.com')
		})

		it('should record the attempt as blocked', () => {
			// GIVEN a remote connection string
			process.env['DATABASE_URL'] = 'postgresql://u:p@db.example.com:5432/x'

			// WHEN the guard refuses
			runExit(requireLocalDatabase('seed'))

			// THEN the attempt is auditable
			expect(auditLines).toHaveLength(1)
			expect(auditLines[0]).toContain('\tseed\tBLOCKED\t')
			expect(auditLines[0]).toContain('host=db.example.com')
		})

		// A guard that can't tell what it is about to wipe must not wipe it.
		it.each([
			['unset', undefined],
			['empty', ''],
			['unparseable', 'not-a-url'],
			['host-less', 'postgresql:///batuda'],
		])('should refuse when DATABASE_URL is %s', (_label, value) => {
			// GIVEN a connection string that names no usable host
			if (value === undefined) delete process.env['DATABASE_URL']
			else process.env['DATABASE_URL'] = value

			// WHEN the guard runs
			const exit = runExit(requireLocalDatabase('db reset'))

			// THEN it fails closed rather than assuming local
			expect(Exit.isFailure(exit)).toBe(true)
		})
	})
})

describe('confirmCloud', () => {
	beforeEach(() => {
		auditLines.length = 0
		target = 'local'
	})
	afterEach(() => {
		delete process.env['DATABASE_URL']
	})

	describe('when --confirm-host matches the resolved host', () => {
		it('should proceed without prompting and record how it was approved', () => {
			// GIVEN a remote database the caller has named correctly
			process.env['DATABASE_URL'] = 'postgresql://u:p@db.example.com:5432/x'

			// WHEN the guard runs with that host stated
			const exit = runExit(confirmCloud('auth promote', 'db.example.com'))

			// THEN it passes with no prompt, and the audit says it was the flag
			expect(Exit.isSuccess(exit)).toBe(true)
			expect(auditLines[0]).toContain('\tOK\t')
			expect(auditLines[0]).toContain('via=confirm-host')
		})
	})

	describe('when --confirm-host disagrees with the resolved host', () => {
		it('should refuse against a remote database', () => {
			// GIVEN a remote database the caller has named incorrectly
			process.env['DATABASE_URL'] = 'postgresql://u:p@db.example.com:5432/x'

			// WHEN the guard runs
			const exit = runExit(confirmCloud('auth promote', 'other.example.com'))

			// THEN it refuses and both hosts appear in the explanation
			const error = failureOf(exit)
			expect(error).toBeInstanceOf(CloudRefused)
			expect(error.message).toContain('other.example.com')
			expect(error.message).toContain('db.example.com')
			expect(auditLines[0]).toContain('\tMISMATCH\t')
		})

		// The caller declared production; silently doing the work on a dev
		// database would have it report success for something that never
		// happened. Intent is checked before the local-target shortcut.
		it('should refuse even when the resolved database is local', () => {
			// GIVEN a caller naming production while pointed at this machine
			process.env['DATABASE_URL'] =
				'postgresql://batuda:batuda@localhost:5433/batuda'

			// WHEN the guard runs
			const exit = runExit(confirmCloud('auth invite-admin', 'db.example.com'))

			// THEN it refuses rather than quietly using localhost
			const error = failureOf(exit)
			expect(error).toBeInstanceOf(CloudRefused)
			expect(error.message).toContain('localhost')
		})
	})

	describe('when --env cloud resolves to a database on this machine', () => {
		// Cloud mode supplies settings but never credentials, so a forgotten
		// `infisical run` wrapper leaves the dev connection string in place.
		it('should refuse and point at the missing wrapper', () => {
			// GIVEN cloud mode with the dev connection string still in place
			target = 'cloud'
			process.env['DATABASE_URL'] =
				'postgresql://batuda:batuda@localhost:5433/batuda'

			// WHEN the guard runs
			const exit = runExit(confirmCloud('auth invite-admin'))

			// THEN it refuses and names the fix
			const error = failureOf(exit)
			expect(error).toBeInstanceOf(CloudRefused)
			expect(error.message).toContain('infisical run')
			expect(auditLines[0]).toContain('\tLOCAL_IN_CLOUD_MODE\t')
		})
	})

	describe('when working locally', () => {
		it('should not prompt, so ordinary dev and CI are untouched', () => {
			// GIVEN local mode against a local database
			process.env['DATABASE_URL'] =
				'postgresql://batuda:batuda@localhost:5433/batuda'

			// WHEN the guard runs with no host stated
			const exit = runExit(confirmCloud('auth promote'))

			// THEN it passes silently and writes no audit line
			expect(Exit.isSuccess(exit)).toBe(true)
			expect(auditLines).toEqual([])
		})
	})
})
