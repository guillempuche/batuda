/**
 * The shape of a research request as the dialog assembles it, and a comparable
 * fingerprint of one.
 *
 * The server prices a fan-out before it starts, answers with a quote, and then
 * trusts a later `confirm: true` without re-checking what it quoted. So the one
 * thing standing between an approved small run and a much larger one starting is
 * the caller noticing that the request changed underneath the quote. That check
 * lives here, away from the dialog, so it can be tested.
 */

/** Everything the discovery scope fields contribute to a request. */
export type ResearchScope = {
	// Present for a run pinned to one company; absent for a discovery run.
	readonly companyId?: string | undefined
	readonly location: string
	readonly language: string
	readonly filterStatus: string
	readonly filterIndustry: string
	readonly filterCountry: string
	readonly filterTags: string
}

/** A request as it goes to the server, minus the confirm flag. */
export type ResearchRequest = {
	readonly query: string
	readonly schema: string
	readonly stackId: string
	readonly templateIds: ReadonlyArray<string>
	readonly context: Record<string, unknown> | undefined
}

/**
 * Turn the scope fields into the `context` the create endpoint reads. A company
 * id pins the run to that company; otherwise the filters pick out companies
 * already tracked and the hints steer a search for new ones. Blank fields are
 * left out entirely rather than sent empty, and a section that ends up with
 * nothing in it is dropped, so two ways of saying "no scope" produce one shape.
 */
export function buildResearchContext(
	scope: ResearchScope,
): Record<string, unknown> | undefined {
	const context: Record<string, unknown> = {}
	// An id that is there but empty names no company, so it is read the same way
	// a missing one is rather than sent as a lookup that cannot succeed.
	if (scope.companyId !== undefined && scope.companyId.length > 0) {
		context['subjects'] = [{ table: 'companies', id: scope.companyId }]
		return context
	}

	const filter: Record<string, unknown> = {}
	if (scope.filterStatus) filter['status'] = scope.filterStatus
	if (scope.filterIndustry.trim())
		filter['industry'] = scope.filterIndustry.trim()
	if (scope.filterCountry.trim()) filter['country'] = scope.filterCountry.trim()
	const tags = scope.filterTags
		.split(',')
		.map(tag => tag.trim())
		.filter(Boolean)
	if (tags.length > 0) filter['tags'] = tags
	if (Object.keys(filter).length > 0) {
		context['selector'] = { table: 'companies', filter }
	}

	const hints: Record<string, unknown> = {}
	if (scope.language) hints['language'] = scope.language
	if (scope.location.trim()) hints['location'] = scope.location.trim()
	if (Object.keys(hints).length > 0) context['hints'] = hints

	return Object.keys(context).length > 0 ? context : undefined
}

/**
 * A comparable string covering everything the server reads to decide how many
 * runs a request starts and what they cost. Two requests that would be priced
 * the same produce the same key; change anything that moves the price and the
 * key moves with it, which is what withdraws a quote that no longer applies.
 *
 * The query is trimmed because that is how it is sent, so trailing whitespace
 * is not treated as a different question. Template order is kept because it is
 * the order the instructions are layered in, and so part of the request.
 */
export function researchRequestKey(request: ResearchRequest): string {
	return JSON.stringify([
		request.query.trim(),
		request.schema,
		request.stackId,
		request.templateIds,
		request.context ?? null,
	])
}
