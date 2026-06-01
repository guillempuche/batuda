// Pins the open Dynamic Client Registration path that MCP clients (Claude.ai,
// ChatGPT, Codex) traverse before the user ever sees a sign-in page. The
// /oauth2/register endpoint must accept an unauthenticated POST and the AS
// metadata must advertise that public clients are supported — both gated by
// `allowUnauthenticatedClientRegistration` on the oauthProvider plugin. A
// regression here means new connectors fail to register on their first call
// and the connection never starts; this exact failure was observed against
// api.batuda.co/mcp before the flag was added.

import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider'
import { type Config, Effect, ManagedRuntime } from 'effect'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applyTestEnv } from '../test-env'
import { Auth } from './auth'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const BASE_URL = process.env['BETTER_AUTH_BASE_URL'] as string
const CLIENT_NAME_PREFIX = 'dcr-it-'

let pool: pg.Pool
let runtime: ManagedRuntime.ManagedRuntime<Auth, Config.ConfigError>

const callAuth = (
	path: string,
	init?: {
		method?: string
		jsonBody?: unknown
		headers?: Record<string, string>
	},
): Promise<Response> =>
	runtime.runPromise(
		Effect.gen(function* () {
			const auth = yield* Auth
			const headers = new Headers(init?.headers)
			const url = new URL(path, BASE_URL).toString()
			const method = init?.method ?? 'GET'
			const hasBody = init?.jsonBody !== undefined
			if (hasBody) headers.set('content-type', 'application/json')
			const request = hasBody
				? new Request(url, {
						method,
						headers,
						body: JSON.stringify(init?.jsonBody),
					})
				: new Request(url, { method, headers })
			return yield* Effect.promise(() => auth.instance.handler(request))
		}),
	)

const registerClient = (jsonBody: Record<string, unknown>) =>
	callAuth('/auth/oauth2/register', { method: 'POST', jsonBody })

// Mirrors what well-known.ts does — the live root .well-known document is
// rendered by this helper, not by `instance.handler`. Better Auth's own warning
// ("Please ensure '/.well-known/oauth-authorization-server' exists") points
// here.
const fetchAuthServerMetadata = (): Promise<Response> =>
	runtime.runPromise(
		Effect.gen(function* () {
			const auth = yield* Auth
			const request = new Request(
				new URL('/.well-known/oauth-authorization-server', BASE_URL).toString(),
			)
			return yield* Effect.promise(() =>
				oauthProviderAuthServerMetadata(auth.instance)(request),
			)
		}),
	)

const uniqueName = (label: string) =>
	`${CLIENT_NAME_PREFIX}${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 })
	runtime = ManagedRuntime.make(Auth.layer)
}, 60_000)

afterAll(async () => {
	// Cleanup only the rows this file wrote — the prefix scopes the delete so
	// sibling test files keep their fixtures.
	await pool.query(`DELETE FROM "oauthClient" WHERE name LIKE $1`, [
		`${CLIENT_NAME_PREFIX}%`,
	])
	await runtime.dispose()
	await pool.end()
})

describe('Public Dynamic Client Registration', () => {
	describe('when an MCP client POSTs /oauth2/register with no session', () => {
		it('should issue a public client_id without authentication', async () => {
			// GIVEN no session cookie and a Claude.ai-style payload that
			// already self-declares as a public client
			// WHEN POST /auth/oauth2/register hits the server handler
			const response = await registerClient({
				client_name: uniqueName('public'),
				redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
				token_endpoint_auth_method: 'none',
			})

			// THEN the server returns 200 with a client_id, no secret, and
			// confirms the public auth method — the response Claude reads to
			// start the authorize step.
			expect(response.status).toBe(200)
			const data = (await response.json()) as Record<string, unknown>
			expect(typeof data['client_id']).toBe('string')
			expect((data['client_id'] as string).length).toBeGreaterThan(0)
			expect(data['client_secret']).toBeUndefined()
			expect(data['token_endpoint_auth_method']).toBe('none')
		})

		it('should rewrite client_secret_post to "none" per RFC 7591 §3.2.1', async () => {
			// GIVEN real MCP clients (Claude, Codex, Factory Droid) send
			// token_endpoint_auth_method: "client_secret_post" by default
			// WHEN they register without authentication
			const response = await registerClient({
				client_name: uniqueName('post'),
				redirect_uris: ['https://example.test/callback'],
				token_endpoint_auth_method: 'client_secret_post',
			})

			// THEN the server transparently downgrades the auth method to none
			// and issues no secret — both signals tell the client the actual
			// shape of the registered client so it can adjust.
			expect(response.status).toBe(200)
			const data = (await response.json()) as Record<string, unknown>
			expect(data['token_endpoint_auth_method']).toBe('none')
			expect(data['client_secret']).toBeUndefined()
		})

		it('should rewrite client_secret_basic to "none" per RFC 7591 §3.2.1', async () => {
			// GIVEN another confidential method that the unauthenticated path
			// must override (mirrors the upstream regression test)
			// WHEN registering without authentication
			const response = await registerClient({
				client_name: uniqueName('basic'),
				redirect_uris: ['https://example.test/callback'],
				token_endpoint_auth_method: 'client_secret_basic',
			})

			// THEN the same downgrade applies — the rule is "no session → public".
			expect(response.status).toBe(200)
			const data = (await response.json()) as Record<string, unknown>
			expect(data['token_endpoint_auth_method']).toBe('none')
			expect(data['client_secret']).toBeUndefined()
		})

		it('should reject a client_credentials registrant', async () => {
			// GIVEN an unauthenticated registrant asking for the m2m grant —
			// which inherently requires a confidential client and can't be
			// granted without a logged-in owner
			// WHEN the registration is attempted
			const response = await registerClient({
				client_name: uniqueName('m2m'),
				redirect_uris: ['https://example.test/callback'],
				grant_types: ['client_credentials'],
			})

			// THEN it is refused with 400 + invalid_client_metadata — closes
			// the only escalation path from public DCR to confidential.
			expect(response.status).toBe(400)
			const data = (await response.json()) as Record<string, unknown>
			expect(data['error']).toBe('invalid_client_metadata')
		})

		it('should reject a registration that omits redirect_uris', async () => {
			// GIVEN an authorization_code registrant (default) without any
			// redirect_uris — the validator must fail closed
			// WHEN the registration is attempted
			const response = await registerClient({
				client_name: uniqueName('no-redir'),
				token_endpoint_auth_method: 'none',
			})

			// THEN the request is rejected — confirms input validation runs
			// before any client row is written.
			expect(response.status).toBeGreaterThanOrEqual(400)
			expect(response.status).toBeLessThan(500)
		})
	})

	describe('OAuth Authorization Server metadata document', () => {
		it('should advertise "none" as a supported token_endpoint_auth_method', async () => {
			// GIVEN allowUnauthenticatedClientRegistration is on
			// WHEN an MCP client fetches the AS metadata at discovery time
			const response = await fetchAuthServerMetadata()
			expect(response.status).toBe(200)
			const data = (await response.json()) as Record<string, unknown>

			// THEN the supported auth methods include "none" — the signal MCP
			// clients use to learn public clients are accepted before they
			// POST to /register.
			const methods = data['token_endpoint_auth_methods_supported']
			expect(Array.isArray(methods)).toBe(true)
			expect(methods as string[]).toContain('none')
		})

		it('should expose /auth/oauth2/register as the registration_endpoint', async () => {
			// GIVEN the AS metadata document well-known.ts serves at the root
			// WHEN a client reads registration_endpoint
			const response = await fetchAuthServerMetadata()
			const data = (await response.json()) as Record<string, unknown>

			// THEN it points at the same handler the unauthenticated cases
			// above hit — a single source of truth, so a misconfig in either
			// place fails this test rather than the wild.
			expect(data['registration_endpoint']).toBe(
				`${BASE_URL}/auth/oauth2/register`,
			)
		})
	})
})
