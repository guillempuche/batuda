import { createHash } from 'node:crypto'

import type { ResearchAttributeDeclaration } from '@batuda/domain'

// A stable content fingerprint of the ordered templates that shaped a prompt,
// keyed on each template's id + last-updated time in resolution order. Editing
// a template's body (which bumps its `updated_at`), swapping the stack, or
// reordering it all change the fingerprint — and therefore the research cache
// key — so an edited template never serves a stale cached run, while an
// unchanged stack keeps hitting the cache.
//
// The empty case (no templates resolved) hashes to a fixed value; folding that
// into existing cache keys re-warms them exactly once, then they stabilise.
export const fingerprintTemplates = (
	templates: ReadonlyArray<{ readonly id: string; readonly updatedAt: string }>,
): string => {
	const canonical = templates.map(t => `${t.id}@${t.updatedAt}`).join('|')
	return createHash('sha256').update(canonical).digest('hex')
}

// The same idea for the attributes a run is asked to fill. Everything that
// reaches a prompt is in the hash — the key, the label, the kind, the choice
// words, the unit and the description — so two runs asked for the same facts
// share one name and an edit to any of them gives a new one. Sorted by key, so
// the order the rows came back in never matters. No attributes hashes to a
// fixed value.
export const fingerprintAttributes = (
	declarations: ReadonlyArray<ResearchAttributeDeclaration>,
): string => {
	const canonical = [...declarations]
		.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
		.map(attribute =>
			JSON.stringify([
				attribute.key,
				attribute.label,
				attribute.kind,
				attribute.enumValues,
				attribute.unit,
				attribute.description,
			]),
		)
		.join('\n')
	return createHash('sha256').update(canonical).digest('hex')
}
