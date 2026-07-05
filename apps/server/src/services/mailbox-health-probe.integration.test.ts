// PgLive reads DATABASE_URL and MailboxHealthProbe reads
// EMAIL_HEALTH_PROBE_INTERVAL_SEC via Config at layer-build time — both
// required (no default). Set them so the suite runs without a loaded .env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'
process.env['EMAIL_HEALTH_PROBE_INTERVAL_SEC'] ??= '900'

import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GrantAuthFailed, GrantConnectFailed } from '@batuda/controllers'

import { PgLive } from '../db/client.js'
import { CredentialCrypto } from './credential-crypto.js'
import { type DecryptedCreds, MailTransport } from './mail-transport.js'
import { MailboxHealthProbe } from './mailbox-health-probe.js'

// Real Postgres + real SqlClient + stubbed MailTransport. The contract
// under test is the state-machine update on mailboxes per probe outcome —
// the probe itself (real IMAP/SMTP) is owned by mail-transport.test.ts.

interface GrantRow {
	readonly grantStatus: string
	readonly grantLastError: string | null
	readonly grantLastSeenAt: Date | null
}

const TEST_INBOX_ORG = 'health-probe-test-org'
const TEST_INBOX_USER = 'health-probe-test-user'

const stubTransport = (
	probe: (creds: DecryptedCreds) => Effect.Effect<void, unknown>,
) =>
	Layer.succeed(MailTransport, {
		probe,
		send: () => Effect.die('send not used in this test'),
		appendToSent: () => Effect.die('appendToSent not used in this test'),
	} as never)

// Stubbed crypto bypasses EnvVars (which would pull every env the
// server boot needs) and decoupling from a real key keeps the test
// hermetic — the contract under test is the state-machine update, not
// the cipher round-trip.
const stubCrypto = Layer.succeed(CredentialCrypto, {
	encryptConfig: () => ({
		ciphertext: new Uint8Array([0]),
		nonce: new Uint8Array([0]),
		tag: new Uint8Array([0]),
	}),
	decryptConfig: () => 'stubbed-password',
} as never)

const provideTestLayers = (
	probeImpl: (creds: DecryptedCreds) => Effect.Effect<void, unknown>,
) =>
	MailboxHealthProbe.layer.pipe(
		Layer.provide([stubCrypto, stubTransport(probeImpl)]),
		Layer.provide(PgLive),
	)

describe('MailboxHealthProbe', () => {
	let mailboxId: string

	const seedMailbox = Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		// The blob value never matters — stubCrypto.decryptPassword ignores
		// it and returns a constant — so a single byte each is enough to
		// satisfy the BYTEA NOT NULL columns.
		const placeholder = new Uint8Array([0])
		const rows = yield* sql<{ id: string }>`
			INSERT INTO channel_connections (
				organization_id, external_id, purpose, owner_user_id,
				imap_host, imap_port, imap_security,
				smtp_host, smtp_port, smtp_security,
				username, config_ciphertext, config_nonce, config_tag,
				active
			) VALUES (
				${TEST_INBOX_ORG}, 'probe@test.local', 'human', ${TEST_INBOX_USER},
				'imap.test.local', 993, 'tls',
				'smtp.test.local', 587, 'starttls',
				'probe@test.local', ${placeholder}, ${placeholder}, ${placeholder},
				true
			)
			RETURNING id
		`
		return rows[0]!.id
	})

	const cleanup = (id: string) =>
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql`DELETE FROM channel_connections WHERE id = ${id}`
		})

	const readGrant = (id: string) =>
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const rows = yield* sql<{
				grantStatus: string
				grantLastError: string | null
				grantLastSeenAt: Date | null
			}>`
				SELECT grant_status AS "grantStatus",
				       grant_last_error AS "grantLastError",
				       grant_last_seen_at AS "grantLastSeenAt"
				FROM channel_connections WHERE id = ${id}
			`
			return rows[0]
		})

	beforeAll(async () => {
		// Seed once for the whole suite — each test stubs a different probe
		// outcome and calls `probe.tick`, which only updates this one row.
		mailboxId = await Effect.runPromise(
			seedMailbox.pipe(Effect.provide(PgLive)) as Effect.Effect<
				string,
				never,
				never
			>,
		)
	})

	afterAll(async () => {
		if (mailboxId) {
			await Effect.runPromise(
				cleanup(mailboxId).pipe(Effect.provide(PgLive)) as Effect.Effect<
					void,
					never,
					never
				>,
			)
		}
	})

	describe('when MailTransport.probe resolves successfully', () => {
		it('should update grant_status to connected and clear grant_last_error', async () => {
			// GIVEN a stubbed probe that succeeds
			// WHEN MailboxHealthProbe.tick walks the active mailboxes
			await Effect.runPromise(
				Effect.gen(function* () {
					const probe = yield* MailboxHealthProbe
					yield* probe.tick
				}).pipe(
					Effect.provide(provideTestLayers(() => Effect.void)),
				) as Effect.Effect<void, never, never>,
			)

			// THEN the mailbox row should report connected, no error, fresh seen-at
			const grant = await Effect.runPromise(
				readGrant(mailboxId).pipe(Effect.provide(PgLive)) as Effect.Effect<
					GrantRow | undefined,
					never,
					never
				>,
			)
			expect(grant?.grantStatus).toBe('connected')
			expect(grant?.grantLastError).toBeNull()
			expect(grant?.grantLastSeenAt).toBeInstanceOf(Date)
		})
	})

	describe('when MailTransport.probe fails with GrantAuthFailed', () => {
		it('should update grant_status to auth_failed and persist the upstream detail', async () => {
			// GIVEN a stubbed probe that returns auth_failed
			const detail = 'AUTHENTICATIONFAILED test-detail'

			// WHEN the probe ticks
			await Effect.runPromise(
				Effect.gen(function* () {
					const probe = yield* MailboxHealthProbe
					yield* probe.tick
				}).pipe(
					Effect.provide(
						provideTestLayers(creds =>
							Effect.fail(
								new GrantAuthFailed({ mailboxId: creds.connectionId, detail }),
							),
						),
					),
				) as Effect.Effect<void, never, never>,
			)

			// THEN auth_failed should be persisted with the detail
			const grant = await Effect.runPromise(
				readGrant(mailboxId).pipe(Effect.provide(PgLive)) as Effect.Effect<
					GrantRow | undefined,
					never,
					never
				>,
			)
			expect(grant?.grantStatus).toBe('auth_failed')
			expect(grant?.grantLastError).toBe(detail)
		})
	})

	describe('when MailTransport.probe fails with GrantConnectFailed', () => {
		it('should update grant_status to connect_failed and persist the upstream detail', async () => {
			// GIVEN a stubbed probe that returns connect_failed
			const detail = 'ECONNREFUSED test-detail'

			// WHEN the probe ticks
			await Effect.runPromise(
				Effect.gen(function* () {
					const probe = yield* MailboxHealthProbe
					yield* probe.tick
				}).pipe(
					Effect.provide(
						provideTestLayers(creds =>
							Effect.fail(
								new GrantConnectFailed({
									mailboxId: creds.connectionId,
									detail,
								}),
							),
						),
					),
				) as Effect.Effect<void, never, never>,
			)

			// THEN connect_failed should be persisted with the detail
			const grant = await Effect.runPromise(
				readGrant(mailboxId).pipe(Effect.provide(PgLive)) as Effect.Effect<
					GrantRow | undefined,
					never,
					never
				>,
			)
			expect(grant?.grantStatus).toBe('connect_failed')
			expect(grant?.grantLastError).toBe(detail)
		})
	})

	describe('when an mailbox row is inactive', () => {
		it('should skip the mailbox in the probe loop', async () => {
			// GIVEN the seeded mailbox is flipped to inactive AND the prior test
			// left it on connect_failed
			await Effect.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`UPDATE channel_connections SET active = false WHERE id = ${mailboxId}`
				}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
			)

			// WHEN the probe ticks with a stub that would fail loudly if invoked
			await Effect.runPromise(
				Effect.gen(function* () {
					const probe = yield* MailboxHealthProbe
					yield* probe.tick
				}).pipe(
					Effect.provide(
						provideTestLayers(() =>
							Effect.die('probe should not be called for inactive mailboxes'),
						),
					),
				) as Effect.Effect<void, never, never>,
			)

			// THEN the row's grant_status from the previous test is unchanged
			const grant = await Effect.runPromise(
				readGrant(mailboxId).pipe(Effect.provide(PgLive)) as Effect.Effect<
					GrantRow | undefined,
					never,
					never
				>,
			)
			expect(grant?.grantStatus).toBe('connect_failed')

			// Restore active=true so subsequent tests in the same file work.
			await Effect.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`UPDATE channel_connections SET active = true WHERE id = ${mailboxId}`
				}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
			)
		})
	})

	describe('over multiple iterations', () => {
		it('should transition a recovered mailbox from auth_failed to connected', async () => {
			// GIVEN the mailbox is on auth_failed (set by an earlier tick)
			await Effect.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`UPDATE channel_connections SET grant_status = 'auth_failed' WHERE id = ${mailboxId}`
				}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
			)

			// WHEN the probe ticks with a now-succeeding stub
			await Effect.runPromise(
				Effect.gen(function* () {
					const probe = yield* MailboxHealthProbe
					yield* probe.tick
				}).pipe(
					Effect.provide(provideTestLayers(() => Effect.void)),
				) as Effect.Effect<void, never, never>,
			)

			// THEN the row should recover to connected
			const grant = await Effect.runPromise(
				readGrant(mailboxId).pipe(Effect.provide(PgLive)) as Effect.Effect<
					GrantRow | undefined,
					never,
					never
				>,
			)
			expect(grant?.grantStatus).toBe('connected')
			expect(grant?.grantLastError).toBeNull()
		})
	})
})
