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

const DEV_MARKER = 'batuda.localhost'

/**
 * Pure core of the dev API-origin derivation: given the page's location
 * parts, build the matching cross-origin API host, or null off a
 * `batuda.localhost` host (production). Split out from the `window` read so
 * the host/port logic is unit-testable without a DOM.
 *
 * A worktree on `feature-x.batuda.localhost` talks to its matching API at
 * `feature-x.api.batuda.localhost`, on whatever port portless bound.
 */
export function buildDevApiOrigin(
	hostname: string,
	port: string,
	protocol: string,
): string | null {
	// Match on a label boundary so a lookalike host like `xbatuda.localhost`
	// can't masquerade as a dev origin.
	if (hostname !== DEV_MARKER && !hostname.endsWith(`.${DEV_MARKER}`)) {
		return null
	}
	const apiHost = hostname.replace(DEV_MARKER, `api.${DEV_MARKER}`)
	// Keep portless's port (e.g. :1355 when it can't bind 443) so the
	// cross-origin /v1 calls reach the API portless actually serves; the
	// browser omits the default :443 from the origin it sends.
	const portSuffix = port && port !== '443' ? `:${port}` : ''
	return `${protocol}//${apiHost}${portSuffix}`
}

/**
 * In dev, derives the cross-origin API host from the page so a worktree
 * automatically talks to its matching worktree API with no per-worktree env
 * file. Returns null off a dev host (production), where `VITE_SERVER_URL`
 * (built into the bundle) is the absolute API origin instead.
 */
function deriveDevApiOrigin(): string | null {
	if (typeof window === 'undefined') return null
	const { hostname, port, protocol } = window.location
	return buildDevApiOrigin(hostname, port, protocol)
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
		// Dev derives the worktree's own API origin from the page (so it carries
		// portless's port); `VITE_SERVER_URL` is the prod-only absolute origin
		// baked into the bundle, used once the page is off a batuda.localhost host.
		baseUrl:
			deriveDevApiOrigin() ??
			import.meta.env['VITE_SERVER_URL'] ??
			'https://api.batuda.localhost',
	},
) {}
