import { Schema } from 'effect'

import {
	ATTRIBUTES_PER_STACK_MAX,
	ResearchAttributeDeclaration,
} from '@batuda/domain'

const decodeDeclaration = Schema.decodeUnknownExit(ResearchAttributeDeclaration)

/**
 * The declarations a run row carries, read back with care: the column is JSON
 * an earlier build wrote, so an entry this build cannot read is left out rather
 * than stopping the run, and more than a stack may declare are cut.
 */
export const parseAttributeDeclarations = (
	raw: unknown,
): ReadonlyArray<ResearchAttributeDeclaration> => {
	if (!Array.isArray(raw)) return []
	const declarations: ResearchAttributeDeclaration[] = []
	for (const entry of raw) {
		const decoded = decodeDeclaration(entry)
		if (decoded._tag === 'Success') declarations.push(decoded.value)
		if (declarations.length === ATTRIBUTES_PER_STACK_MAX) break
	}
	return declarations
}
