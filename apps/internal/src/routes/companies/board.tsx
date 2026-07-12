import { useLingui } from '@lingui/react/macro'
import { ClientOnly, createFileRoute } from '@tanstack/react-router'
import { Schema } from 'effect'
import { Columns3, LayoutGrid } from 'lucide-react'
import styled from 'styled-components'

import type { CompaniesSearch } from '#/atoms/companies-atoms'
import { PipelineBoard } from '#/components/companies/pipeline-board'
import { LoadingSpinner } from '#/components/shared/loading-spinner'
import { validateSearchWith } from '#/lib/search-schema'
import { rulerUnderRule, stenciledTitle } from '#/lib/workshop-mixins'

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
		const p = new URLSearchParams()
		if (search.country) p.set('country', search.country)
		if (search.industry) p.set('industry', search.industry)
		if (search.priority !== undefined)
			p.set('priority', String(search.priority))
		if (search.owner) p.set('owner', search.owner)
		if (search.sort) p.set('sort', search.sort)
		if (search.query) p.set('query', search.query)
		const qs = p.toString()
		return qs ? `/companies?${qs}` : '/companies'
	})()

	return (
		<Page>
			<Intro>
				<TitleRow>
					<Title>{t`Pipeline board`}</Title>
					<ViewToggle role='group' aria-label={t`Switch view`}>
						<ViewLink href={listHref} data-testid='board-view-list'>
							<LayoutGrid size={14} aria-hidden />
							<span>{t`List`}</span>
						</ViewLink>
						<ViewLink
							$active
							href='/companies/board'
							aria-current='page'
							data-testid='board-view-board'
						>
							<Columns3 size={14} aria-hidden />
							<span>{t`Board`}</span>
						</ViewLink>
					</ViewToggle>
				</TitleRow>
				<Subtitle>{t`Drag a lead across stages, or use its Move menu.`}</Subtitle>
			</Intro>

			<ClientOnly fallback={<LoadingSpinner label={t`Loading board…`} />}>
				<PipelineBoard search={search as CompaniesSearch} />
			</ClientOnly>
		</Page>
	)
}

const Page = styled.div.withConfig({ displayName: 'BoardPage' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`

const Intro = styled.div.withConfig({ displayName: 'BoardIntro' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const TitleRow = styled.div.withConfig({ displayName: 'BoardTitleRow' })`
	${rulerUnderRule}
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	padding-bottom: var(--space-sm);
`

const Title = styled.h2.withConfig({ displayName: 'BoardTitle' })`
	${stenciledTitle}
	margin: 0;
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
`

const Subtitle = styled.p.withConfig({ displayName: 'BoardSubtitle' })`
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
`

const ViewToggle = styled.div.withConfig({ displayName: 'BoardViewToggle' })`
	display: inline-flex;
	align-items: stretch;
	border: 2px solid var(--color-outline);
	border-radius: var(--shape-2xs);
	overflow: hidden;
`

const ViewLink = styled.a.withConfig({
	displayName: 'BoardViewLink',
	shouldForwardProp: prop => prop !== '$active',
})<{ $active?: boolean }>`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-sm);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	text-decoration: none;
	background: ${p => (p.$active ? 'var(--color-primary)' : 'transparent')};
	color: ${p => (p.$active ? 'var(--color-on-primary)' : 'var(--color-on-surface)')};

	& + & {
		border-left: 2px solid var(--color-outline);
	}

	&:hover {
		color: ${p => (p.$active ? 'var(--color-on-primary)' : 'var(--color-primary)')};
	}
`
