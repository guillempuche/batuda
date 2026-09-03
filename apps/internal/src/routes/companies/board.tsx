import { useLingui } from '@lingui/react/macro'
import { ClientOnly, createFileRoute } from '@tanstack/react-router'
import { Schema } from 'effect'
import styled from 'styled-components'

import { CommaList } from '@batuda/controllers'
import {
	AttentionFilter as AttentionFilterSchema,
	CompanySort as CompanySortSchema,
} from '@batuda/domain'

import { CompaniesHeader } from '#/components/companies/companies-header'
import { PipelineBoard } from '#/components/companies/pipeline-board'
import { LoadingSpinner } from '#/components/shared/loading-spinner'
import { companiesSearchToQuery } from '#/lib/companies-search-params'
import { validateSearchWith } from '#/lib/search-schema'

// Either comma-separated text from a link somebody wrote, or the list the router
// hands back from what it last put in the address.
const ValueList = Schema.Union([Schema.Array(Schema.NonEmptyString), CommaList])

// Same filters as the list minus `status` — the board's columns are the statuses.
//
// Every one of the others is named here, including what needs doing: a filter
// left out is not merely unshown, it is dropped, so arriving from a dashboard
// heading and switching to the board would silently widen the list.
const validateSearch = validateSearchWith({
	country: ValueList,
	industry: Schema.NonEmptyString,
	priority: Schema.Union([Schema.Number, Schema.NumberFromString]),
	owner: ValueList,
	fitVerdict: ValueList,
	tags: ValueList,
	sort: CompanySortSchema,
	query: Schema.NonEmptyString,
	attention: AttentionFilterSchema,
	staleDays: Schema.Union([Schema.Number, Schema.NumberFromString]),
	// Carried like the rest: the list hands over whatever it holds, and a filter
	// this route does not name is not merely unshown, it is dropped — so going
	// from the bin to the board would quietly show the live pipeline instead.
	deleted: Schema.Literals(['only']),
})

export const Route = createFileRoute('/companies/board')({
	validateSearch,
	head: () => ({ meta: [{ title: 'Board — Batuda' }] }),
	component: BoardPage,
})

function BoardPage() {
	const { t } = useLingui()
	const search = Route.useSearch()

	// Carry the active filters back to the list view — all of them, through the
	// one place that knows how to write them.
	const listHref = `/companies${companiesSearchToQuery(search)}`

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
				<PipelineBoard search={search} />
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
