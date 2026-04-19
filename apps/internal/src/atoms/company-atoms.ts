import { BatudaApiAtom } from '#/lib/batuda-api-atom'

/**
 * Id/slug-keyed atom factories for the Company Detail page.
 *
 * The company-detail route loader fetches the company + four parallel
 * relations (contacts, interactions, tasks, proposals) and needs to
 * hydrate five distinct atoms. These atoms are parameterized by runtime
 * ids (slug for the company, companyId for the relations) so we can't
 * just export a module-level constant — we need one atom *per* company.
 *
 * Both the loader (server) and the component (client) call the same
 * factory with the same key to get the *same* atom identity. That
 * identity is what lets `RegistryProvider.initialValues` / the
 * `HydrationBoundary` seed the atom the component will read, so the
 * first render has data without a shimmer.
 *
 * Cache semantics: entries are never evicted. Company detail pages are
 * visited occasionally by a single operator, and the registry nodes are
 * ~KB each — over a long session that's still a negligible footprint.
 * Promote to an LRU only if memory becomes a measurable concern.
 */

const companyCache = new Map<string, ReturnType<typeof makeCompanyAtom>>()
const contactsCache = new Map<string, ReturnType<typeof makeContactsAtom>>()
const interactionsCache = new Map<
	string,
	ReturnType<typeof makeInteractionsAtom>
>()
const companyTasksCache = new Map<
	string,
	ReturnType<typeof makeCompanyTasksAtom>
>()
const timelineCache = new Map<string, ReturnType<typeof makeTimelineAtom>>()

function makeCompanyAtom(slug: string) {
	return BatudaApiAtom.query('companies', 'get', { params: { slug } })
}

function makeContactsAtom(companyId: string) {
	return BatudaApiAtom.query('contacts', 'list', {
		query: { companyId },
	})
}

function makeInteractionsAtom(companyId: string) {
	return BatudaApiAtom.query('interactions', 'list', {
		query: { companyId, limit: 20 },
	})
}

function makeCompanyTasksAtom(companyId: string) {
	return BatudaApiAtom.query('tasks', 'list', {
		query: { companyId },
	})
}

function makeTimelineAtom(companyId: string) {
	return BatudaApiAtom.query('timeline', 'list', {
		query: { companyId, limit: 50 },
	})
}

/**
 * Company header atom (one per slug). Hydrated by the `/companies/$slug`
 * loader with the result of `companies.get({ params: { slug } })`.
 */
export function companyAtomFor(slug: string) {
	const existing = companyCache.get(slug)
	if (existing !== undefined) return existing
	const atom = makeCompanyAtom(slug)
	companyCache.set(slug, atom)
	return atom
}

/**
 * Contacts-by-company atom (one per companyId). Hydrated alongside the
 * company atom so the Contactes tab has data on first paint.
 */
export function contactsAtomFor(companyId: string) {
	const existing = contactsCache.get(companyId)
	if (existing !== undefined) return existing
	const atom = makeContactsAtom(companyId)
	contactsCache.set(companyId, atom)
	return atom
}

/**
 * Interactions-by-company atom (one per companyId, limit 20). Hydrated
 * alongside the company atom so the always-visible timeline has data on
 * first paint. After logging a new interaction via Quick Capture, call
 * `useAtomRefresh` on this atom + the company atom (the server updates
 * `lastContactedAt` + `nextAction` in the same transaction).
 */
export function interactionsAtomFor(companyId: string) {
	const existing = interactionsCache.get(companyId)
	if (existing !== undefined) return existing
	const atom = makeInteractionsAtom(companyId)
	interactionsCache.set(companyId, atom)
	return atom
}

/**
 * Tasks-by-company atom (one per companyId). Distinct from the global
 * `openTasksAtom` (pipeline + tasks page): this one returns *all* tasks
 * for a single company — both open and completed — so the detail page
 * can show historical context next to the open ones.
 */
export function companyTasksAtomFor(companyId: string) {
	const existing = companyTasksCache.get(companyId)
	if (existing !== undefined) return existing
	const atom = makeCompanyTasksAtom(companyId)
	companyTasksCache.set(companyId, atom)
	return atom
}

/**
 * Timeline-by-company atom (one per companyId, limit 50). Surfaces the
 * polymorphic activity log — emails, calls, meetings, documents,
 * proposals, research runs, system events — ordered by `occurredAt DESC`.
 * Refresh alongside the interactions atom after logging new activity.
 */
export function timelineAtomFor(companyId: string) {
	const existing = timelineCache.get(companyId)
	if (existing !== undefined) return existing
	const atom = makeTimelineAtom(companyId)
	timelineCache.set(companyId, atom)
	return atom
}
