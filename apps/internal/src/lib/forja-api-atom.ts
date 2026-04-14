import { Layer } from 'effect'
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient'
import { AtomHttpApi } from 'effect/unstable/reactivity'

import { ForjaApi } from '@engranatge/controllers'

// Wrap the native fetch to always include credentials. We override the
// FetchHttpClient.Fetch reference instead of providing RequestInit
// because AtomHttpApi.Service prunes unrequired services from the layer
// — RequestInit never reaches the fiber, but Fetch does (it's a Ref).
const credentialsFetch: typeof globalThis.fetch = (input, init) =>
	globalThis.fetch(input, { ...init, credentials: 'include' })

const ForjaHttpClientLive = FetchHttpClient.layer.pipe(
	Layer.provide(Layer.succeed(FetchHttpClient.Fetch, credentialsFetch)),
)

/**
 * `AtomHttpApi.Service` derives `.query(group, endpoint, request)` and
 * `.mutation(group, endpoint)` accessors directly from the `ForjaApi`
 * spec in `@engranatge/controllers`. Both are fully typed from the spec:
 *
 *   ForjaApiAtom.query('companies', 'list', { query: { status: 'meeting' } })
 *   // → Atom<AsyncResult.AsyncResult<ReadonlyArray<Company>, ForjaError>>
 *
 * See `docs/repos/effect/packages/effect/src/unstable/reactivity/AtomHttpApi.ts:145`
 * for the constructor signature.
 */
export class ForjaApiAtom extends AtomHttpApi.Service<ForjaApiAtom>()(
	'ForjaApi',
	{
		api: ForjaApi,
		httpClient: ForjaHttpClientLive,
		baseUrl:
			import.meta.env['VITE_SERVER_URL'] ?? 'https://api.engranatge.localhost',
	},
) {}
