import { Effect } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'

import { attributeDeclarationsAtom } from '#/atoms/attribute-atoms'
import { type DehydratedAtomValue, dehydrateAtom } from '#/lib/atom-hydration'
import type { BatudaApiServerClient } from '#/lib/batuda-api-server'

/**
 * The attributes the organisation declares, fetched with a page so the first
 * frame already knows what a company may carry: labels do not flash from bare
 * keys, and the list filter does not appear under the reader's hand.
 *
 * A page still reads without them, so a failed fetch hands nothing over rather
 * than costing the page its whole server-rendered frame. The browser then asks
 * for them itself, the way it does for anything a loader left out.
 */
export const fetchAttributeDeclarations = (client: BatudaApiServerClient) =>
	client.instructions
		.listAttributes({ query: {} })
		.pipe(Effect.catchCause(() => Effect.succeed(undefined)))

// The handover for the declarations a loader fetched, or nothing when the
// fetch failed, so the atom is left for the browser to fill.
export const dehydrateAttributeDeclarations = (
	declarations: unknown,
): ReadonlyArray<DehydratedAtomValue> =>
	declarations === undefined
		? []
		: [
				dehydrateAtom(
					attributeDeclarationsAtom,
					AsyncResult.success(declarations),
				),
			]
