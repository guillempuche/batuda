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

	describe('sendMemberAdded', () => {
		const readInbox = async (recipient: string) => {
			const inbox = join(__dirname, '..', '..', '.dev-inbox')
			const files = await readdir(inbox)
			const match = files.find(name => name.includes(recipient.split('@')[0]!))
			expect(match, 'expected a file matching the recipient slug').toBeTruthy()
			const body = await readFile(join(inbox, match!), 'utf8')
			return { body, cleanup: () => rm(join(inbox, match!), { force: true }) }
		}

		describe('when called with valid params', () => {
			it('should write a .md file under apps/server/.dev-inbox/ with labels: member-added', async () => {
				// GIVEN the local transactional provider
				// AND a unique recipient address scoped to this test
				const recipient = `it-member-added-${Date.now()}@example.com`

				// WHEN we tell someone they were added to an organization
				await program(
					Effect.gen(function* () {
						const provider = yield* TransactionalEmailProvider
						yield* provider.sendMemberAdded({
							email: recipient,
							addedByName: 'Alice Admin',
							organizationName: 'Taller Demo',
							signInUrl: 'https://batuda.localhost/login',
							locale: 'en',
						})
					}),
				)

				// THEN the frontmatter should carry labels: ['member-added']
				const { body, cleanup } = await readInbox(recipient)
				expect(body).toMatch(/labels:\s*\n\s+- member-added/)

				// AND the body should name who added them, the org, and where to sign in
				expect(body).toContain('Alice Admin')
				expect(body).toContain('Taller Demo')
				expect(body).toContain('https://batuda.localhost/login')

				// AND it should carry no way into the account — nothing to expire and
				// nothing an intercepted mailbox could replay
				expect(body).not.toMatch(/\/auth\/magic-link\/verify/)
				expect(body).not.toMatch(/token=/)

				// Cleanup so subsequent runs don't accumulate test inbox noise.
				await cleanup()
			})
		})

		describe('when the recipient reads Catalan', () => {
			it('should write the Catalan wording', async () => {
				// GIVEN a recipient whose stored language is Catalan
				const recipient = `it-member-added-ca-${Date.now()}@example.com`

				// WHEN we tell them they were added
				await program(
					Effect.gen(function* () {
						const provider = yield* TransactionalEmailProvider
						yield* provider.sendMemberAdded({
							email: recipient,
							addedByName: 'Alice Admin',
							organizationName: 'Taller Demo',
							signInUrl: 'https://batuda.localhost/login',
							locale: 'ca',
						})
					}),
				)

				// THEN the wording should be Catalan, not the English default
				const { body, cleanup } = await readInbox(recipient)
				expect(body).toContain('t’ha afegit a')
				expect(body).toContain('Inicia la sessió')
				expect(body).not.toContain('added you to')

				await cleanup()
			})
		})

		describe('when the stored language is not one we serve', () => {
			it('should fall back to English rather than render nothing', async () => {
				// GIVEN a stored value that is not a language — an older row, or a key
				// that would otherwise resolve to something that is not a template
				const recipient = `it-member-added-bad-${Date.now()}@example.com`

				// WHEN we tell them they were added
				await program(
					Effect.gen(function* () {
						const provider = yield* TransactionalEmailProvider
						yield* provider.sendMemberAdded({
							email: recipient,
							addedByName: 'Alice Admin',
							organizationName: 'Taller Demo',
							signInUrl: 'https://batuda.localhost/login',
							locale: '__proto__',
						})
					}),
				)

				// THEN the English wording should be used and the subject intact
				const { body, cleanup } = await readInbox(recipient)
				expect(body).toContain('added you to')
				expect(body).not.toContain('undefined')

				await cleanup()
			})
		})
	})

	describe('sendResetPassword', () => {
		describe('when called with valid params', () => {
			it('should write a .md file with labels: password-reset and the expiry inline', async () => {
				// GIVEN the local transactional provider
				// AND a recipient unique to this run
				const recipient = `it-resetpwd-${Date.now()}@example.com`
				const expiresAt = new Date('2026-06-01T12:00:00Z')

				// WHEN we send a reset-password email
				await program(
					Effect.gen(function* () {
						const provider = yield* TransactionalEmailProvider
						yield* provider.sendResetPassword({
							email: recipient,
							url: 'https://api.batuda.localhost/auth/reset-password/tok-1?callbackURL=https://batuda.localhost/reset-password',
							expiresAt,
							locale: 'en',
						})
					}),
				)

				// THEN a .md file should appear in the dev-inbox dir
				//   [local-transactional-provider.ts — sendResetPassword writeMd branch]
				const inbox = join(__dirname, '..', '..', '.dev-inbox')
				const files = await readdir(inbox)
				const match = files.find(name =>
					name.includes(recipient.split('@')[0]!),
				)
				expect(
					match,
					'expected a file matching the recipient slug',
				).toBeTruthy()

				// AND the frontmatter should carry labels: ['password-reset']
				const body = await readFile(join(inbox, match!), 'utf8')
				expect(body).toMatch(/labels:\s*\n\s+- password-reset/)

				// AND the body should include the URL + ISO expiry so the recipient
				// knows whether the link is still good.
				expect(body).toContain('/auth/reset-password/tok-1')
				expect(body).toContain(expiresAt.toISOString())

				await rm(join(inbox, match!), { force: true })
			})
		})
	})

	describe('sendMagicLink', () => {
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
							locale: 'en',
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

	describe('sendMemberAdded', () => {
		describe('when Resend returns 200', () => {
			it('should POST the member-added template to /emails with the configured From', async () => {
				// GIVEN the stub captures the request shape
				const captured: { url?: string; init?: RequestInit } = {}
				const stub: typeof fetch = async (input, init) => {
					captured.url = input.toString()
					if (init) captured.init = init
					return new Response('{}', { status: 200 })
				}

				// WHEN we tell someone they were added
				const exit = await runWith(
					stub,
					Effect.gen(function* () {
						const provider = yield* TransactionalEmailProvider
						yield* provider.sendMemberAdded({
							email: 'newcomer@example.com',
							addedByName: 'Alice Admin',
							organizationName: 'Taller Demo',
							signInUrl: 'https://batuda.co/login',
							locale: 'en',
						})
					}),
				)
				expect(exit._tag, 'exit should be Success').toBe('Success')

				// THEN the URL should be Resend's /emails endpoint
				expect(captured.url).toBe('https://api.resend.com/emails')

				// AND the body should carry the HTML/text + recipient + From
				const body = JSON.parse(String(captured.init?.body))
				expect(body.from).toBe('no-reply@batuda.local')
				expect(body.to).toEqual(['newcomer@example.com'])
				expect(body.subject).toContain('Taller Demo')
				expect(body.text).toContain('Alice Admin')
				expect(body.text).toContain('https://batuda.co/login')
				expect(body.html).toContain('Taller Demo')
				expect(body.html).toContain('href="https://batuda.co/login"')

				// AND it should carry no credential of any kind
				expect(body.text).not.toContain('token=')
				expect(body.html).not.toContain('magic-link/verify')
			})
		})

		describe('when the adder or org name contains HTML control chars', () => {
			it('should escape HTML in subject + html body but leave text body raw', async () => {
				// GIVEN an adder and org whose names contain HTML — a profile name
				// and an org's display name are both user-editable, and email
				// clients (Gmail/Outlook web) render basic tags in HTML bodies.
				const captured: { url?: string; init?: RequestInit } = {}
				const stub: typeof fetch = async (input, init) => {
					captured.url = input.toString()
					if (init) captured.init = init
					return new Response('{}', { status: 200 })
				}

				// WHEN we tell someone they were added
				const exit = await runWith(
					stub,
					Effect.gen(function* () {
						const provider = yield* TransactionalEmailProvider
						yield* provider.sendMemberAdded({
							email: 'newcomer@example.com',
							addedByName: 'Mallory <img src=x onerror=alert(1)>',
							organizationName: '</p><a href="https://evil">click</a>',
							signInUrl: 'https://batuda.co/login',
							locale: 'en',
						})
					}),
				)
				expect(exit._tag).toBe('Success')
				const body = JSON.parse(String(captured.init?.body))

				// THEN the html field must NOT carry raw `<img onerror=` or
				// the malicious anchor. Escaped entities are fine.
				expect(body.html).not.toContain('<img src=x onerror=')
				expect(body.html).not.toContain('<a href="https://evil">click</a>')
				expect(body.html).toContain('&lt;img src=x onerror=')

				// AND the subject must also be escaped — Gmail's preview pane
				// echoes raw subjects in some flows.
				expect(body.subject).not.toContain('<img src=x onerror=alert(1)>')

				// AND the text body keeps the raw values: text/plain is
				// never parsed, so the recipient sees what was entered.
				expect(body.text).toContain('Mallory <img src=x onerror=alert(1)>')
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

				// WHEN sendMemberAdded runs
				const exit = await runWith(
					stub,
					Effect.gen(function* () {
						const provider = yield* TransactionalEmailProvider
						yield* provider.sendMemberAdded({
							email: 'bounced@example.com',
							addedByName: 'Alice',
							organizationName: 'Taller',
							signInUrl: 'https://batuda.co/login',
							locale: 'en',
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

				// WHEN sendMemberAdded runs
				const exit = await runWith(
					stub,
					Effect.gen(function* () {
						const provider = yield* TransactionalEmailProvider
						yield* provider.sendMemberAdded({
							email: 'test@example.com',
							addedByName: 'Alice',
							organizationName: 'Taller',
							signInUrl: 'https://batuda.co/login',
							locale: 'en',
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

		describe('sendResetPassword via Resend', () => {
			it('should POST the reset-password template with the URL inline + ISO expiry', async () => {
				// GIVEN the stub captures the request shape
				//   [resend-transactional-provider.ts — sendResetPassword branch]
				const captured: { url?: string; init?: RequestInit } = {}
				const stub: typeof fetch = async (input, init) => {
					captured.url = input.toString()
					if (init) captured.init = init
					return new Response('{}', { status: 200 })
				}
				const expiresAt = new Date('2026-06-01T12:00:00Z')

				// WHEN we send a reset-password email
				const exit = await runWith(
					stub,
					Effect.gen(function* () {
						const provider = yield* TransactionalEmailProvider
						yield* provider.sendResetPassword({
							email: 'pwd-reset@example.com',
							url: 'https://api.batuda.localhost/auth/reset-password/tok-1?callbackURL=https://batuda.localhost/reset-password',
							expiresAt,
							locale: 'en',
						})
					}),
				)
				expect(exit._tag, 'exit should be Success').toBe('Success')

				// THEN the body carries the URL + recipient + escaped HTML link
				expect(captured.url).toBe('https://api.resend.com/emails')
				const body = JSON.parse(String(captured.init?.body))
				expect(body.to).toEqual(['pwd-reset@example.com'])
				expect(body.subject).toContain('Reset')
				expect(body.text).toContain('/auth/reset-password/tok-1')
				expect(body.text).toContain(expiresAt.toISOString())
				expect(body.html).toContain('href="')
				expect(body.html).toContain(expiresAt.toISOString())
			})
		})

		describe('when fetch throws (DNS / TLS / connection refused)', () => {
			it('should fail with kind=unknown without leaking the API key', async () => {
				// GIVEN fetch rejects with a network-level error
				const stub: typeof fetch = async () => {
					throw new Error('connect ECONNREFUSED 127.0.0.1:443')
				}

				// WHEN sendMemberAdded runs
				const exit = await runWith(
					stub,
					Effect.gen(function* () {
						const provider = yield* TransactionalEmailProvider
						yield* provider.sendMemberAdded({
							email: 'test@example.com',
							addedByName: 'Alice',
							organizationName: 'Taller',
							signInUrl: 'https://batuda.co/login',
							locale: 'en',
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
