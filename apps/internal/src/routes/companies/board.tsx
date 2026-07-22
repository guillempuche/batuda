import { useLingui } from '@lingui/react/macro'
import { ClientOnly, createFileRoute } from '@tanstack/react-router'
import { Schema } from 'effect'
import styled from 'styled-components'

import type { CompaniesSearch } from '#/atoms/companies-atoms'
import { CompaniesHeader } from '#/components/companies/companies-header'
import { PipelineBoard } from '#/components/companies/pipeline-board'
import { LoadingSpinner } from '#/components/shared/loading-spinner'
import { validateSearchWith } from '#/lib/search-schema'

// Same filters as the list minus `status` — the board's columns are the statuses.
const validateSearch = validateSearchWith({
	country: Schema.NonEmptyString,
	industry: Schema.NonEmptyString,
	priority: Schema.Union([Schema.Number, Schema.NumberFromString]),
	owner: Schema.NonEmptyString,
	sort: Schema.NonEmptyString,
	query: Schema.NonEmptyString,
})

export const Route = createFileRoute('/companies/board')({
	validateSearch,
	head: () => ({ meta: [{ title: 'Board — Batuda' }] }),
	component: BoardPage,
})

function BoardPage() {
	const { t } = useLingui()
	const search = Route.useSearch()

	// Carry the active filters back to the list view.
	const listHref = (() => {
		const params = new URLSearchParams()
		if (search.country) params.set('country', search.country)
		if (search.industry) params.set('industry', search.industry)
		if (search.priority !== undefined)
			params.set('priority', String(search.priority))
		if (search.owner) params.set('owner', search.owner)
		if (search.sort) params.set('sort', search.sort)
		if (search.query) params.set('query', search.query)
		const qs = params.toString()
		return qs ? `/companies?${qs}` : '/companies'
	})()

	return (
		<Page>
			<CompaniesHeader
				view='board'
				title={t`Pipeline board`}
				subtitle={t`Drag a lead across stages, or use its Move menu.`}
				listHref={listHref}
				boardHref='/companies/board'
			/>

			<ClientOnly fallback={<LoadingSpinner label={t`Loading board…`} />}>
				<PipelineBoard search={search as CompaniesSearch} />
			</ClientOnly>
		</Page>
	)
}

// Full-bleed on purpose: the pipeline is a horizontal kanban whose columns
// need the whole sheet width, so this view is not capped like the list.
const Page = styled.div.withConfig({ displayName: 'BoardPage' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`
