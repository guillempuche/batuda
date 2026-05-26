import {
	oauthProviderAuthServerMetadata,
	oauthProviderOpenIdConfigMetadata,
} from '@better-auth/oauth-provider'
import { NodeHttpServerRequest } from '@effect/platform-node'
import { fromNodeHeaders } from 'better-auth/node'
import { Effect, Layer } from 'effect'
import {
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
} from 'effect/unstable/http'

import { Auth } from './auth'
import { EnvVars } from './env'

// OAuth 2.1 discovery documents, re-served at the host ROOT. The `oauthProvider`
// plugin mounts its own discovery under the Better Auth base path
// (`/auth/.well-known/...`), but MCP clients (ChatGPT, Claude.ai) probe at the
// origin root per RFC 9728/8414. The endpoints these documents advertise stay
// under `/auth` — clients follow whatever the metadata names.

// Build a Fetch `Request` from the Effect request (GET, no body): the Better
// Auth metadata helpers answer against a `Request`.
const toFetchRequest = (base: string) =>
	Effect.gen(function* () {
		const req = yield* HttpServerRequest.HttpServerRequest
		const incomingMessage = NodeHttpServerRequest.toIncomingMessage(req)
		return new Request(new URL(req.url, base), {
			method: 'GET',
			headers: fromNodeHeaders(incomingMessage.headers),
		})
	})

const authServerMetadata = Effect.gen(function* () {
	const { instance } = yield* Auth
	const env = yield* EnvVars
	const fetchRequest = yield* toFetchRequest(env.BETTER_AUTH_BASE_URL)
	const response = yield* Effect.promise(() =>
		oauthProviderAuthServerMetadata(instance)(fetchRequest),
	)
	return HttpServerResponse.fromWeb(response)
})

const openIdConfig = Effect.gen(function* () {
	const { instance } = yield* Auth
	const env = yield* EnvVars
	const fetchRequest = yield* toFetchRequest(env.BETTER_AUTH_BASE_URL)
	const response = yield* Effect.promise(() =>
		oauthProviderOpenIdConfigMetadata(instance)(fetchRequest),
	)
	return HttpServerResponse.fromWeb(response)
})

// RFC 9728 Protected Resource Metadata — oauth-provider ships no helper for it.
// `resource` MUST equal the access-token audience and the `/mcp` URL the
// WWW-Authenticate challenge points clients at; the lone authorization server is
// this origin (its AS metadata is served above).
const protectedResource = Effect.gen(function* () {
	const env = yield* EnvVars
	return yield* HttpServerResponse.json({
		resource: `${env.BETTER_AUTH_BASE_URL}/mcp`,
		authorization_servers: [env.BETTER_AUTH_BASE_URL],
		scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
		bearer_methods_supported: ['header'],
	})
})

export const WellKnownLive = Layer.mergeAll(
	HttpRouter.add(
		'GET',
		'/.well-known/oauth-authorization-server',
		authServerMetadata,
	),
	HttpRouter.add('GET', '/.well-known/openid-configuration', openIdConfig),
	HttpRouter.add(
		'GET',
		'/.well-known/oauth-protected-resource',
		protectedResource,
	),
	// RFC 9728 §3.1 path insertion: clients derive this from `resource`'s path.
	HttpRouter.add(
		'GET',
		'/.well-known/oauth-protected-resource/mcp',
		protectedResource,
	),
)
