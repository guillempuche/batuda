import { Layer } from 'effect'
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient'
import { AtomHttpApi } from 'effect/unstable/reactivity'

import { BatudaApi } from '@batuda/controllers'

// Wrap the native fetch to always include credentials. We override the
// FetchHttpClient.Fetch reference instead of providing RequestInit
// because AtomHttpApi.Service prunes unrequired services from the layer
// — RequestInit never reaches the fiber, but Fetch does (it's a Ref).
const credentialsFetch: typeof globalThis.fetch = (input, init) =>
	globalThis.fetch(input, { ...init, credentials: 'include' })

const BatudaHttpClientLive = FetchHttpClient.layer.pipe(
	Layer.provide(Layer.succeed(FetchHttpClient.Fetch, credentialsFetch)),
)

/**
 * Derives the absolute API host. In production an explicit
 * `VITE_SERVER_URL` is required (built into the bundle). In dev on
 * `*.batuda.localhost` we fall back to a runtime derivation from
 * `window.location.host` so worktree subdomains (e.g.
 * `feature-x.batuda.localhost`) automatically talk to their matching
 * worktree API (`feature-x.api.batuda.localhost`) without a
 * per-worktree env file.
 */
function deriveDevApiOrigin(): string | null {
	if (typeof window === 'undefined') return null
	const host = window.location.host
	const marker = 'batuda.localhost'
	if (!host.endsWith(marker)) return null
	const apiHost = host.replace(marker, `api.${marker}`)
	return `${window.location.protocol}//${apiHost}`
}

/**
 * `AtomHttpApi.Service` derives `.query(group, endpoint, request)` and
 * `.mutation(group, endpoint)` accessors directly from the `BatudaApi`
 * spec in `@batuda/controllers`. Both are fully typed from the spec:
 *
 *   BatudaApiAtom.query('companies', 'list', { query: { status: 'meeting' } })
 *   // → Atom<AsyncResult.AsyncResult<ReadonlyArray<Company>, BatudaError>>
 *
 * See `docs/repos/effect/packages/effect/src/unstable/reactivity/AtomHttpApi.ts:145`
 * for the constructor signature.
 *
 * `baseUrl` points at the absolute API host. The browser fetches
 * `/v1/*` cross-origin and Better Auth's session cookie travels via
 * `credentials: 'include'` because the parent-domain cookie is
 * accepted under real TLDs in prod and host-only on the API subdomain
 * in dev (the Vite `/auth/*` proxy lives only for the auth surface, so
 * Set-Cookie arrives on `<host>.batuda.localhost` for the gate path;
 * the API still recognises the cookie when the browser posts it back
 * to `<host>.api.batuda.localhost` because Better Auth validates by
 * name, not by which host minted it).
 */
export class BatudaApiAtom extends AtomHttpApi.Service<BatudaApiAtom>()(
	'BatudaApi',
	{
		api: BatudaApi,
		httpClient: BatudaHttpClientLive,
		baseUrl:
			import.meta.env['VITE_SERVER_URL'] ??
			deriveDevApiOrigin() ??
			'https://api.batuda.localhost',
	},
) {}
