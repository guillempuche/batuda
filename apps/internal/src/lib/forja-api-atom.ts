import { Layer } from 'effect'
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient'
import { AtomHttpApi } from 'effect/unstable/reactivity'

import { ForjaApi } from '@engranatge/controllers'

/**
 * Browser-side HttpClient Layer for Forja.
 *
 * `FetchHttpClient.layer` reads the `FetchHttpClient.RequestInit` service
 * from fiber services on every call and spreads it into the fetch options
 * (see FetchHttpClient.ts:31). To forward Better-Auth session cookies on
 * every request we merge in a Layer providing `RequestInit` with
 * `credentials: 'include'`. The server's `SessionMiddlewareLive` reads
 * the cookie and populates `SessionContext` — our side does nothing with
 * the cookie directly.
 */
const ForjaHttpClientLive = Layer.mergeAll(
	FetchHttpClient.layer,
	Layer.succeed(FetchHttpClient.RequestInit, {
		credentials: 'include',
	} satisfies globalThis.RequestInit),
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
		baseUrl: import.meta.env['VITE_SERVER_URL'] ?? 'http://localhost:3010',
	},
) {}
