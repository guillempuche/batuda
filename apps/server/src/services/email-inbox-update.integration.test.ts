// PgLive reads DATABASE_URL at layer-build time (no default). Set it so the
// suite runs without a loaded .env, matching the other integration tests.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
	CurrentOrg,
	GrantAuthFailed,
	SessionContext,
} from '@batuda/controllers'

import { PgLive } from '../db/client.js'
import { CalendarService } from './calendar.js'
import {
	CredentialCrypto,
	decryptWithKey,
	encryptWithKey,
} from './credential-crypto.js'
import { EmailService } from './email.js'
import { EmailAttachmentStaging } from './email-attachment-staging.js'
import { DraftStore } from './email-draft-store.js'
import { EmailProvider } from './email-provider.js'
import { type DecryptedCreds, MailTransport } from './mail-transport.js'
import { StorageProvider } from './storage-provider.js'
import { TimelineActivityService } from './timeline-activity.js'

// Real Postgres + real SqlClient + stubbed MailTransport/CredentialCrypto. The
// contract under test is updateInbox's re-probe: a credential or transport
// change must run a fresh probe and persist the real outcome, while a
// metadata-only edit must not probe at all. The cipher round-trip and the live
// IMAP/SMTP probe are owned by their own suites.

const TEST_ORG = 'inbox-update-test-org'
const TEST_USER = 'inbox-update-test-user'

const stubTransport = (
	probe: (creds: DecryptedCreds) => Effect.Effect<void, unknown>,
) =>
	Layer.succeed(MailTransport, {
		probe,
		send: () => Effect.die('send not used in this test'),
		appendToSent: () => Effect.die('appendToSent not used in this test'),
	} as never)

const stubCrypto = Layer.succeed(CredentialCrypto, {
	encryptPassword: () => ({
		ciphertext: new Uint8Array([0]),
		nonce: new Uint8Array([0]),
		tag: new Uint8Array([0]),
	}),
	decryptPassword: () => 'stubbed-password',
} as never)

// updateInbox/reprobeInbox only touch sql, crypto, transport and CurrentOrg.
// The other EmailService dependencies are captured at construction but never
// called on this path, so empty stubs are enough to build the layer.
const serviceLayer = (
	probe: (creds: DecryptedCreds) => Effect.Effect<void, unknown>,
) =>
	EmailService.layer.pipe(
		Layer.provide([
			stubCrypto,
			stubTransport(probe),
			Layer.succeed(EmailProvider, {} as never),
			Layer.succeed(TimelineActivityService, {} as never),
			Layer.succeed(EmailAttachmentStaging, {} as never),
			Layer.succeed(DraftStore, {} as never),
			Layer.succeed(CalendarService, {} as never),
			Layer.succeed(StorageProvider, {} as never),
		]),
		Layer.provide(PgLive),
	)

const orgContext = Layer.succeed(CurrentOrg, { id: TEST_ORG } as never)
const sessionContext = Layer.succeed(SessionContext, {
	userId: TEST_USER,
} as never)

interface GrantRow {
	readonly grantStatus: string
	readonly grantLastError: string | null
	readonly displayName: string | null
}

describe('EmailService.updateInbox re-probe', () => {
	let inboxId: string

	const seedInbox = Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const placeholder = new Uint8Array([0])
		const rows = yield* sql<{ id: string }>`
			INSERT INTO inboxes (
				organization_id, email, display_name, purpose, owner_user_id,
				imap_host, imap_port, imap_security,
				smtp_host, smtp_port, smtp_security,
				username, password_ciphertext, password_nonce, password_tag,
				active, grant_status
			) VALUES (
				${TEST_ORG}, 'update@test.local', 'Baseline', 'human', ${TEST_USER},
				'imap.test.local', 993, 'tls',
				'smtp.test.local', 587, 'starttls',
				'update@test.local', ${placeholder}, ${placeholder}, ${placeholder},
				true, 'connected'
			)
			RETURNING id
		`
		return rows[0]!.id
	})

	const resetRow = (id: string) =>
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* sql`
				UPDATE inboxes
				SET grant_status = 'connected',
				    grant_last_error = NULL,
				    display_name = 'Baseline'
				WHERE id = ${id}
			`
		})

	const readGrant = (id: string) =>
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const rows = yield* sql<GrantRow>`
				SELECT grant_status AS "grantStatus",
				       grant_last_error AS "grantLastError",
				       display_name AS "displayName"
				FROM inboxes WHERE id = ${id}
			`
			return rows[0]
		})

	beforeAll(async () => {
		inboxId = await Effect.runPromise(
			seedInbox.pipe(Effect.provide(PgLive)) as Effect.Effect<
				string,
				never,
				never
			>,
		)
	})

	afterAll(async () => {
		if (inboxId) {
			await Effect.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`DELETE FROM inboxes WHERE id = ${inboxId}`
				}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
			)
		}
	})

	beforeEach(async () => {
		await Effect.runPromise(
			resetRow(inboxId).pipe(Effect.provide(PgLive)) as Effect.Effect<
				void,
				never,
				never
			>,
		)
	})

	describe('when the password changes and the probe fails to authenticate', () => {
		it('should persist auth_failed with the upstream detail', async () => {
			// [email.ts:1956 — updateInbox: credentialsChanged → reprobeInbox(id)]
			// GIVEN a probe that rejects the new credentials
			const detail = 'NO Invalid login or password'

			// WHEN the password is updated
			await Effect.runPromise(
				Effect.gen(function* () {
					const svc = yield* EmailService
					yield* svc.updateInbox(inboxId, { password: 'app-pw-wrong' })
				}).pipe(
					Effect.provide(
						serviceLayer(creds =>
							Effect.fail(
								new GrantAuthFailed({ inboxId: creds.inboxId, detail }),
							),
						),
					),
					Effect.provide(orgContext),
					Effect.provide(sessionContext),
				) as Effect.Effect<void, never, never>,
			)

			// THEN the row reflects the real probe outcome, not an optimistic
			// connected
			const grant = await Effect.runPromise(
				readGrant(inboxId).pipe(Effect.provide(PgLive)) as Effect.Effect<
					GrantRow | undefined,
					never,
					never
				>,
			)
			expect(grant?.grantStatus).toBe('auth_failed')
			expect(grant?.grantLastError).toBe(detail)
		})
	})

	describe('when the password changes and the probe succeeds', () => {
		it('should persist connected and clear the previous error', async () => {
			// [email.ts:466 — reprobeInbox writes connected and clears grant_last_error]
			// GIVEN the row was previously failing
			await Effect.runPromise(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`UPDATE inboxes SET grant_status = 'auth_failed', grant_last_error = 'stale' WHERE id = ${inboxId}`
				}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
			)

			// WHEN the user pastes a working app password
			await Effect.runPromise(
				Effect.gen(function* () {
					const svc = yield* EmailService
					yield* svc.updateInbox(inboxId, { password: 'app-pw-good' })
				}).pipe(
					Effect.provide(serviceLayer(() => Effect.void)),
					Effect.provide(orgContext),
					Effect.provide(sessionContext),
				) as Effect.Effect<void, never, never>,
			)

			// THEN the inbox recovers to connected with no error
			const grant = await Effect.runPromise(
				readGrant(inboxId).pipe(Effect.provide(PgLive)) as Effect.Effect<
					GrantRow | undefined,
					never,
					never
				>,
			)
			expect(grant?.grantStatus).toBe('connected')
			expect(grant?.grantLastError).toBeNull()
		})
	})

	describe('when only metadata changes', () => {
		it('should not probe and should leave grant_status untouched', async () => {
			// [email.ts:1912 — credentialsChanged is false, so no reprobe on a metadata-only edit]
			// GIVEN the row is connected and a probe that fails loudly if called
			// WHEN only the display name is edited
			await Effect.runPromise(
				Effect.gen(function* () {
					const svc = yield* EmailService
					yield* svc.updateInbox(inboxId, { displayName: 'Renamed' })
				}).pipe(
					Effect.provide(
						serviceLayer(() =>
							Effect.die('probe must not run for a metadata-only edit'),
						),
					),
					Effect.provide(orgContext),
					Effect.provide(sessionContext),
				) as Effect.Effect<void, never, never>,
			)

			// THEN the name changed but the grant state is untouched
			const grant = await Effect.runPromise(
				readGrant(inboxId).pipe(Effect.provide(PgLive)) as Effect.Effect<
					GrantRow | undefined,
					never,
					never
				>,
			)
			expect(grant?.displayName).toBe('Renamed')
			expect(grant?.grantStatus).toBe('connected')
		})
	})
})

describe('EmailService.listProviderPresets', () => {
	describe('when read through the service', () => {
		it('should expose appPasswordUrl and passwordAuthSupported, with Gmail/M365 unsupported', async () => {
			// [email.ts:1649 — listProviderPresets returns PROVIDER_PRESETS]
			// GIVEN the built-in preset list
			// WHEN it is read through the service
			const presets = await Effect.runPromise(
				Effect.gen(function* () {
					const svc = yield* EmailService
					return yield* svc.listProviderPresets()
				}).pipe(Effect.provide(serviceLayer(() => Effect.void)), Effect.orDie),
			)

			// THEN every entry carries the two hint fields with the right types
			for (const preset of presets) {
				expect(typeof preset.appPasswordUrl).toBe('string')
				expect(typeof preset.passwordAuthSupported).toBe('boolean')
			}

			const byName = (name: string) => presets.find(p => p.name === name)

			// AND the two OAuth-only providers are flagged unsupported
			expect(byName('Gmail Workspace')?.passwordAuthSupported).toBe(false)
			expect(byName('Microsoft 365')?.passwordAuthSupported).toBe(false)

			// AND app-password providers are supported with a creation link
			expect(byName('Infomaniak')?.passwordAuthSupported).toBe(true)
			expect(byName('Infomaniak')?.appPasswordUrl).toContain('infomaniak.com')
			expect(byName('iCloud Mail')?.appPasswordUrl).toContain('apple.com')
			expect(byName('Yahoo Mail')?.appPasswordUrl).toContain('yahoo.com')
		})
	})
})

describe('EmailService.updateInbox re-probe — real credential round-trip', () => {
	// Real AES-GCM round-trip (HKDF subkey per inbox id); only the network
	// probe is stubbed, and it captures the credentials it receives. This proves
	// the part the stubbed-crypto suite above cannot see: that the password the
	// caller passes is encrypted, stored, re-read and decrypted back to the
	// exact value handed to the probe.
	const TEST_KEY = Buffer.alloc(32, 7)
	const ORIGINAL_PW = 'original-app-pw'

	const realCrypto = Layer.succeed(CredentialCrypto, {
		encryptPassword: (input: { inboxId: string; plain: string }) =>
			encryptWithKey(TEST_KEY, input),
		decryptPassword: (input: {
			inboxId: string
			ciphertext: Uint8Array
			nonce: Uint8Array
			tag: Uint8Array
		}) => decryptWithKey(TEST_KEY, input),
	} as never)

	const probeCalls: Array<DecryptedCreds> = []
	const capturingTransport = Layer.succeed(MailTransport, {
		probe: (creds: DecryptedCreds) => {
			probeCalls.push(creds)
			return Effect.void
		},
		send: () => Effect.die('send not used in this test'),
		appendToSent: () => Effect.die('appendToSent not used in this test'),
	} as never)

	const realServiceLayer = EmailService.layer.pipe(
		Layer.provide([
			realCrypto,
			capturingTransport,
			Layer.succeed(EmailProvider, {} as never),
			Layer.succeed(TimelineActivityService, {} as never),
			Layer.succeed(EmailAttachmentStaging, {} as never),
			Layer.succeed(DraftStore, {} as never),
			Layer.succeed(CalendarService, {} as never),
			Layer.succeed(StorageProvider, {} as never),
		]),
		Layer.provide(PgLive),
	)

	const inboxId = randomUUID()

	const seedOriginal = Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const enc = encryptWithKey(TEST_KEY, { inboxId, plain: ORIGINAL_PW })
		yield* sql`
			UPDATE inboxes
			SET password_ciphertext = ${enc.ciphertext},
			    password_nonce = ${enc.nonce},
			    password_tag = ${enc.tag},
			    imap_host = 'imap.test.local',
			    grant_status = 'connected',
			    grant_last_error = NULL
			WHERE id = ${inboxId}
		`
	})

	beforeAll(async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				const enc = encryptWithKey(TEST_KEY, { inboxId, plain: ORIGINAL_PW })
				yield* sql`
					INSERT INTO inboxes (
						id, organization_id, email, display_name, purpose, owner_user_id,
						imap_host, imap_port, imap_security,
						smtp_host, smtp_port, smtp_security,
						username, password_ciphertext, password_nonce, password_tag,
						active, grant_status
					) VALUES (
						${inboxId}, ${TEST_ORG}, 'roundtrip@test.local', 'Roundtrip', 'human', ${TEST_USER},
						'imap.test.local', 993, 'tls',
						'smtp.test.local', 587, 'starttls',
						'roundtrip@test.local', ${enc.ciphertext}, ${enc.nonce}, ${enc.tag},
						true, 'connected'
					)
				`
			}).pipe(Effect.provide(PgLive), Effect.orDie),
		)
	})

	afterAll(async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				yield* sql`DELETE FROM inboxes WHERE id = ${inboxId}`
			}).pipe(Effect.provide(PgLive), Effect.orDie),
		)
	})

	beforeEach(async () => {
		await Effect.runPromise(
			seedOriginal.pipe(Effect.provide(PgLive), Effect.orDie),
		)
		probeCalls.length = 0
	})

	describe('when the password is rotated', () => {
		it('should probe with the newly entered password', async () => {
			// [email.ts:1956 — reprobeInbox re-reads and decrypts the freshly stored ciphertext]
			// GIVEN a working inbox
			// WHEN the password is changed to a fresh app password
			await Effect.runPromise(
				Effect.gen(function* () {
					const svc = yield* EmailService
					yield* svc.updateInbox(inboxId, { password: 'rotated-app-pw' })
				}).pipe(
					Effect.provide(realServiceLayer),
					Effect.provide(orgContext),
					Effect.provide(sessionContext),
					Effect.orDie,
				),
			)

			// THEN the probe received exactly the new password — proving the
			// encrypt → store → re-read → decrypt chain on the update path
			expect(probeCalls).toHaveLength(1)
			expect(probeCalls[0]?.password).toBe('rotated-app-pw')
		})
	})

	describe('when only the transport changes', () => {
		it('should probe with the decrypted stored password and the new host', async () => {
			// [email.ts:1912 — transport change triggers reprobe with the decrypted stored password]
			// GIVEN the stored password is left unchanged
			// WHEN only the IMAP host is edited
			await Effect.runPromise(
				Effect.gen(function* () {
					const svc = yield* EmailService
					yield* svc.updateInbox(inboxId, {
						imapHost: 'imap.rotated.example',
					})
				}).pipe(
					Effect.provide(realServiceLayer),
					Effect.provide(orgContext),
					Effect.provide(sessionContext),
					Effect.orDie,
				),
			)

			// THEN the probe used the decrypted stored password against the new
			// host
			expect(probeCalls).toHaveLength(1)
			expect(probeCalls[0]?.password).toBe(ORIGINAL_PW)
			expect(probeCalls[0]?.imapHost).toBe('imap.rotated.example')
		})
	})
})
