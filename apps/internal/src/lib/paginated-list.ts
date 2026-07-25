/**
 * The shape every paginated list endpoint returns: one page of items plus
 * how many rows match in total. `@batuda/controllers` describes it as a
 * schema builder (`PaginatedList` in src/pagination.ts), so loaders and
 * components here annotate against this plain-type mirror of the same shape.
 */
export type PaginatedList<T> = {
	readonly items: ReadonlyArray<T>
	readonly total: number
	readonly limit: number
	readonly offset: number
}
