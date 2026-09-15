import { useAtomValue } from '@effect/atom-react'
import { Option } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import { useMemo } from 'react'

import { attributeDeclarationsAtom } from '#/atoms/attribute-atoms'
import {
	type AttributeDeclaration,
	narrowAttributes,
} from '#/components/instructions/attribute-shapes'

export type AttributeDeclarationsState = {
	// The list once an answer is in, null while none is (still loading, or
	// the fetch failed and nothing was ever loaded).
	readonly declarations: ReadonlyArray<AttributeDeclaration> | null
	// Whether the last fetch failed. A page that was already showing a list
	// keeps showing it, and says so; a page that never got one can offer a
	// retry rather than a loading line that never ends.
	readonly failed: boolean
}

// Reads the raw answer, keeping the last one that arrived when a refresh
// fails: an admin flicking a switch during a blip should not watch the whole
// list vanish into a spinner.
function rawDeclarations(
	result: AsyncResult.AsyncResult<unknown, unknown>,
): unknown {
	if (AsyncResult.isSuccess(result)) return result.value
	if (AsyncResult.isFailure(result) && Option.isSome(result.previousSuccess)) {
		return result.previousSuccess.value.value
	}
	return undefined
}

/**
 * The declarations as the page knows them, with whether the last fetch failed.
 *
 * "Not known yet" and "none declared" are kept apart on purpose. A screen that
 * read the first as the second would file every value a company holds under
 * keys nobody declares, and offer to clear them.
 */
export function useAttributeDeclarationsState(): AttributeDeclarationsState {
	const result = useAtomValue(attributeDeclarationsAtom)
	return useMemo(() => {
		const raw = rawDeclarations(result)
		return {
			declarations: raw === undefined ? null : narrowAttributes(raw),
			failed: AsyncResult.isFailure(result),
		}
	}, [result])
}

// The list alone, for the surfaces that only read it.
export function useAttributeDeclarations(): ReadonlyArray<AttributeDeclaration> | null {
	return useAttributeDeclarationsState().declarations
}
