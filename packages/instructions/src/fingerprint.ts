import { createHash } from 'node:crypto'

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
