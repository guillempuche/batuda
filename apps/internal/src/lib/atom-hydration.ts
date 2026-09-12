/**
 * Atom SSR hydration helper.
 *
 * TanStack Start serializes loader return values with Seroval so they can
 * be embedded in the SSR HTML and picked up by the hydrated client. Atom
 * instances (the objects produced by `BatudaApiAtom.query(...)`) are NOT
 * serializable — they hold Effect runtime references, schemas, and
 * closures that Seroval can't encode. Returning an atom from a loader
 * makes the streamed reply throw inside TanStack's `<AwaitInner>` and
 * tears down the whole route tree.
 *
 * Instead we return `DehydratedAtomValue` — the same shape used by
 * `effect/unstable/reactivity/Hydration`. It's a plain object with a
 * string `key` (derived by the atom's `SerializableTypeId.key`) and a
 * schema-encoded `value` (pure JSON, since `AsyncResult.Schema` encodes
 * to tagged unions of primitive/object data). The root route collects
 * every matched route's dehydrated array and feeds it to
 * `<HydrationBoundary>` from `@effect/atom-react`, which calls
 * `registry.setSerializable(key, value)` — later, when a component
 * subscribes to the matching atom via `useAtomValue`, the registry's
 * `ensureNode` sees the pre-loaded key and decodes the value into the
 * node before first render.
 *
 * This means:
 *   - Loader data is fully serializable (no atoms cross SSR/client).
 *   - Atom identity on the client is whatever the component's factory
 *     produces — the hydration matches by string key, not by instance.
 *   - First paint still has data, so there's no loading flash.
 */

import { notFound } from '@tanstack/react-router'
import type { Effect } from 'effect'
import { Atom } from 'effect/unstable/reactivity'

import type { BatudaApiServerClient } from './batuda-api-server'

/**
 * Serializable dehydrated atom value. Shape matches
 * `effect/unstable/reactivity/Hydration.DehydratedAtomValue` verbatim —
 * we redeclare here so loaders don't pull in the Hydration module
 * (keeps the server-only code path lean).
 */
export type DehydratedAtomValue = {
	readonly '~effect/reactivity/DehydratedAtom': true
	readonly key: string
	readonly value: unknown
	readonly dehydratedAt: number
}

/**
 * Encode an atom value into the serializable dehydrated shape. The atom
 * must be serializable (created via `Atom.serializable(...)` — every
 * `AtomHttpApi.query(...)` result qualifies because `AtomHttpApi` wraps
 * atoms automatically, see
 * `effect/unstable/reactivity/AtomHttpApi.ts:229`).
 *
 * Throws at runtime if the atom isn't serializable — this is a
 * programmer error, not a recoverable state.
 */
export function dehydrateAtom<A>(
	atom: Atom.Atom<A>,
	value: A,
): DehydratedAtomValue {
	if (!Atom.isSerializable(atom)) {
		throw new Error(
			'dehydrateAtom: atom is not serializable — wrap with Atom.serializable() or use AtomHttpApi.query().',
		)
	}
	// `Atom.isSerializable` narrows to `Atom<any> & Serializable<any>`, whose
	// `encode` accepts `any`. We pass the caller's `A` through — the schema
	// at the call site is what actually validates the shape, so this cast
	// is safe.
	const meta = atom[Atom.SerializableTypeId]
	return {
		'~effect/reactivity/DehydratedAtom': true,
		key: meta.key,
		value: meta.encode(value),
		dehydratedAt: Date.now(),
	}
}

/** What a loader returns: the snapshots for the page, plus anything else it names. */
export type HandedOver = {
	readonly dehydrated: ReadonlyArray<DehydratedAtomValue>
}

/** Whether an API failure says the record does not exist. */
export function isNotFoundError(error: unknown): boolean {
	if (!error || typeof error !== 'object') return false
	return (error as Record<string, unknown>)['_tag'] === 'NotFound'
}

/**
 * The shape every loader that fetches ahead of the page follows, written
 * once. In the browser it returns `empty` straight away: loaders only fetch on
 * the server, the atoms fetch for themselves on a later navigation. On the
 * server it runs `fetch` against the API as the visitor whose page this is,
 * and a fetch that fails is logged under `label` and degrades to `empty`, so
 * the page still renders and asks the API itself.
 *
 * `handOver` runs outside that safety net on purpose: it only fails through a
 * programming mistake, an atom with no serialization key, and that has to
 * break the page rather than quietly turn into a refetch on every visit.
 *
 * `notFoundWhen` lets a page give up instead of degrading: a record that does
 * not exist becomes a "not found" page, not an empty one that fetches again.
 *
 * The API client is imported here, inside the server-only branch, so the
 * browser bundle never carries it; a route file names only its type.
 */
export async function handOverFromServer<A, E, R extends HandedOver>(options: {
	readonly label: string
	readonly empty: NoInfer<R>
	readonly fetch: (client: BatudaApiServerClient) => Effect.Effect<A, E>
	readonly handOver: (data: A) => R
	readonly notFoundWhen?: (error: unknown) => boolean
}): Promise<R> {
	if (!import.meta.env.SSR) return options.empty
	let data: A
	try {
		const { withServerApi } = await import('./batuda-api-server')
		data = await withServerApi(options.fetch)
	} catch (error) {
		if (options.notFoundWhen?.(error)) throw notFound()
		console.warn(`[${options.label}] falling back to empty hydration:`, error)
		return options.empty
	}
	return options.handOver(data)
}
