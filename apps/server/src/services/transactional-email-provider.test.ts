import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Cause, Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { EmailSendError } from '@batuda/controllers'

import { LocalTransactionalProviderLive } from './local-transactional-provider.js'
import { ResendTransactionalProviderLive } from './resend-transactional-provider.js'
import { TransactionalEmailProvider } from './transactional-email-provider.js'

// Walks the Cause tree and returns the first Fail error matching our
// expected EmailSendError shape — vitest can't pattern-match on Effect's
// Cause directly, so this normalizer keeps assertions readable. Uses
// Cause.findErrorOption (v4 API) to walk the tree.
const failureFrom = (cause: Cause.Cause<unknown>): EmailSendError | null => {
	const option = Cause.findErrorOption(cause)
	if (!option || option._tag !== 'Some') return null
	const value = option.value
	return value instanceof EmailSendError ? value : null
}

// Local provider tests are integration: they exercise the real FS writer
// (the dev-inbox reader contract is the file format on disk). Resend
// tests are unit: they stub `fetch` because the contract under test is
// the request shape sent to Resend's REST API.

describe('TransactionalEmailProvider — Local (integration)', () => {
	let inboxRoot: string

	beforeEach(async () => {
		// LocalTransactionalProviderLive resolves the inbox dir relative to
		// `import.meta.dirname` of the impl file — we can't redirect that
		// without monkey-patching, so the test asserts files appeared in
		// the real `apps/server/.dev-inbox/`. Each test stamps its messages
		// with a unique recipient so the isolation comes from the slug, not
		// the directory.
		inboxRoot = await mkdtemp(join(tmpdir(), 'batuda-inbox-test-'))
	})

	afterEach(async () => {
		await rm(inboxRoot, { recursive: true, force: true })
	})

	const program = (
		effect: Effect.Effect<unknown, unknown, TransactionalEmailProvider>,
	) =>
		Effect.runPromise(
			effect.pipe(Effect.provide(LocalTransactionalProviderLive)),
		)

	describe('sendInvitation', () => {
		describe('when called with valid params', () => {
			it('should write a .md file under apps/server/.dev-inbox/ with labels: invitation', async () => {
				// GIVEN the local transactional provider
				// AND a unique recipient address scoped to this test
				const recipient = `it-invitation-${Date.now()}@example.com`
				const expiresAt = new Date('2026-06-01T00:00:00Z')

				// WHEN we send an invitation
				await program(
					Effect.gen(function* () {
						const provider = yield* TransactionalEmailProvider
						yield* provider.sendInvitation({
							email: recipient,
							inviterName: 'Alice Admin',
							organizationName: 'Taller Demo',
							inviteUrl:
								'https://api.batuda.localhost/auth/magic-link/verify?token=abc&callbackURL=/accept-invitation/inv-1',
							expiresAt,
						})
					}),
				)

				// THEN a .md file should appear in the dev-inbox dir
				const inbox = join(__dirname, '..', '..', '.dev-inbox')
				const files = await readdir(inbox)
				const match = files.find(name =>
					name.includes(recipient.split('@')[0]!),
				)
				expect(
					match,
					'expected a file matching the recipient slug',
				).toBeTruthy()

				// AND the frontmatter should carry labels: ['invitation']
				const body = await readFile(join(inbox, match!), 'utf8')
				expect(body).toMatch(/labels:\s*\n\s+- invitation/)

				// AND the body should include the inviter name, org name, and URL
				expect(body).toContain('Alice Admin')
				expect(body).toContain('Taller Demo')
				expect(body).toContain('/accept-invitation/inv-1')

				// AND the expiry date should be surfaced so the recipient knows by when
				expect(body).toContain(expiresAt.toISOString())

				// Cleanup so subsequent runs don't accumulate test inbox noise.
				await rm(join(inbox, match!), { force: true })
			})
		})
	})

	describe('sendMagicLink (regression — must still work after sendInvitation lands)', () => {
		describe('when called with valid params', () => {
			it('should write a .md file with labels: magic-link', async () => {
				// GIVEN the same provider used for invitations
				const recipient = `it-magiclink-${Date.now()}@example.com`

				// WHEN we send a magic link
				await program(
					Effect.gen(function* () {
						const provider = yield* TransactionalEmailProvider
						yield* provider.sendMagicLink({
							email: recipient,
							url: 'https://example.com/magic',
							token: 'tok_test',
						})
					}),
				)

				// THEN the file's labels frontmatter should still read magic-link
				const inbox = join(__dirname, '..', '..', '.dev-inbox')
				const files = await readdir(inbox)
				const match = files.find(name =>
					name.includes(recipient.split('@')[0]!),
				)
				expect(match).toBeTruthy()
				const body = await readFile(join(inbox, match!), 'utf8')
				expect(body).toMatch(/labels:\s*\n\s+- magic-link/)
				await rm(join(inbox, match!), { force: true })
			})
		})
	})
})

describe('TransactionalEmailProvider — Resend (unit, stubbed fetch)', () => {
	const ENV_KEY = 'EMAIL_API_KEY_TRANSACTIONAL'
	const ENV_FROM = 'EMAIL_FROM_TRANSACTIONAL'
	const originalEnv = { ...process.env }
	const originalFetch = globalThis.fetch

	beforeEach(() => {
		process.env[ENV_KEY] = 'test_resend_key'
		process.env[ENV_FROM] = 'no-reply@batuda.local'
	})

	afterEach(() => {
		process.env = { ...originalEnv }
		globalThis.fetch = originalFetch
	})

	const runWith = (
		fetchImpl: typeof fetch,
		effect: Effect.Effect<unknown, unknown, TransactionalEmailProvider>,
	) => {
		// Cast: the Effect provided value union includes redacted etc; we
		// only need TransactionalEmailProvider here.
		globalThis.fetch = fetchImpl
		return Effect.runPromiseExit(
			effect.pipe(Effect.provide(ResendTransactionalProviderLive)),
		)
	}

	describe('sendInvitation', () => {
		describe('when Resend returns 200', () => {
			it('should POST the invitation template to /emails with the configured From', async () => {
				// GIVEN the stub captures the request shape
				const captured: { url?: string; init?: RequestInit } = {}
				const stub: typeof fetch = async (input, init) => {
					captured.url = input.toString()
					if (init) captured.init = init
					return new Response('{}', { status: 200 })
				}

				// WHEN we send an invitation
				const exit = await runWith(
					stub,
					Effect.gen(function* () {
						const provider = yield* TransactionalEmailProvider
						yield* provider.sendInvitation({
							email: 'invitee@example.com',
							inviterName: 'Alice Admin',
							organizationName: 'Taller Demo',
							inviteUrl: 'https://example.com/accept-invitation/inv-1',
							expiresAt: new Date('2026-06-01T00:00:00Z'),
						})
					}),
				)
				expect(exit._tag, 'exit should be Success').toBe('Success')

				// THEN the URL should be Resend's /emails endpoint
				expect(captured.url).toBe('https://api.resend.com/emails')

				// AND the body should carry invitation HTML/text + recipient + From
				const body = JSON.parse(String(captured.init?.body))
				expect(body.from).toBe('no-reply@batuda.local')
				expect(body.to).toEqual(['invitee@example.com'])
				expect(body.subject).toContain('Taller Demo')
				expect(body.text).toContain('Alice Admin')
				expect(body.text).toContain(
					'https://example.com/accept-invitation/inv-1',
				)
				expect(body.html).toContain('Taller Demo')
				expect(body.html).toContain(
					'href="https://example.com/accept-invitation/inv-1"',
				)
			})
		})

		describe('when Resend returns 422 (invalid recipient)', () => {
			it('should fail with kind=invalid_recipient carrying the recipient', async () => {
				// GIVEN Resend returns a 4xx
				const stub: typeof fetch = async () =>
					new Response('{"error":"email is not deliverable"}', {
						status: 422,
						statusText: 'Unprocessable Entity',
					})

				// WHEN sendInvitation runs
				const exit = await runWith(
					stub,
					Effect.gen(function* () {
						const provider = yield* TransactionalEmailProvider
						yield* provider.sendInvitation({
							email: 'bounced@example.com',
							inviterName: 'Alice',
							organizationName: 'Taller',
							inviteUrl: 'https://example.com/accept-invitation/x',
							expiresAt: new Date(),
						})
					}),
				)

				// THEN the program should fail with the expected EmailSendError
				expect(exit._tag).toBe('Failure')
				if (exit._tag !== 'Failure') return
				const error = failureFrom(exit.cause)
				expect(error?.kind).toBe('invalid_recipient')
				expect(error?.recipient).toBe('bounced@example.com')
				expect(error?.message).toContain('422')
			})
		})

		describe('when Resend returns 500 (transient)', () => {
			it('should fail with kind=unknown', async () => {
				// GIVEN Resend returns a 5xx
				const stub: typeof fetch = async () =>
					new Response('upstream error', {
						status: 500,
						statusText: 'Internal Server Error',
					})

				// WHEN sendInvitation runs
				const exit = await runWith(
					stub,
					Effect.gen(function* () {
						const provider = yield* TransactionalEmailProvider
						yield* provider.sendInvitation({
							email: 'test@example.com',
							inviterName: 'Alice',
							organizationName: 'Taller',
							inviteUrl: 'https://example.com/accept-invitation/x',
							expiresAt: new Date(),
						})
					}),
				)

				// THEN the failure kind should be 'unknown' (transient/retryable
				// 5xx — distinct from a permanent 4xx invalid_recipient)
				expect(exit._tag).toBe('Failure')
				if (exit._tag !== 'Failure') return
				const error = failureFrom(exit.cause)
				expect(error?.kind).toBe('unknown')
			})
		})

		describe('when fetch throws (DNS / TLS / connection refused)', () => {
			it('should fail with kind=unknown without leaking the API key', async () => {
				// GIVEN fetch rejects with a network-level error
				const stub: typeof fetch = async () => {
					throw new Error('connect ECONNREFUSED 127.0.0.1:443')
				}

				// WHEN sendInvitation runs
				const exit = await runWith(
					stub,
					Effect.gen(function* () {
						const provider = yield* TransactionalEmailProvider
						yield* provider.sendInvitation({
							email: 'test@example.com',
							inviterName: 'Alice',
							organizationName: 'Taller',
							inviteUrl: 'https://example.com/accept-invitation/x',
							expiresAt: new Date(),
						})
					}),
				)

				// THEN the error message should describe the failure but must
				// NOT include the literal API key value (defence against the
				// key escaping into stack traces/logs).
				expect(exit._tag).toBe('Failure')
				if (exit._tag !== 'Failure') return
				const error = failureFrom(exit.cause)
				expect(error?.kind).toBe('unknown')
				expect(error?.message).not.toContain('test_resend_key')
			})
		})
	})
})
