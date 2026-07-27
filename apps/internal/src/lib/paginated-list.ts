/**
 * The shape every paginated list endpoint returns: one page of items, the
 * window that produced it, whether asking again would bring anything more,
 * and how many rows match in total. `@batuda/controllers` describes it as a
 * schema builder (`PaginatedList` in src/pagination.ts), so loaders and
 * components here annotate against this plain-type mirror of the same shape.
 *
 * `total` is null when the request did not ask to be counted, which is a
 * different thing from "none matched" — so read `hasMore` to decide whether
 * to ask for another page, and treat a null total as "not known yet" rather
 * than as zero.
 */
export type PaginatedList<T> = {
	readonly items: ReadonlyArray<T>
	readonly total: number | null
	readonly limit: number
	readonly offset: number
	readonly hasMore: boolean
}
