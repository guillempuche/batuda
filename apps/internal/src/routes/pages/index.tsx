import { useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Schema } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import { ExternalLink } from 'lucide-react'
import { useMemo, useState } from 'react'
import styled from 'styled-components'

import {
	canonicalKey,
	type PagesSearch,
	pagesSearchAtom,
} from '#/atoms/pages-atoms'
import { EmptyState } from '#/components/shared/empty-state'
import { LoadingSpinner } from '#/components/shared/loading-spinner'
import { RelativeDate } from '#/components/shared/relative-date'
import { dehydrateAtom } from '#/lib/atom-hydration'
import { validateSearchWith } from '#/lib/search-schema'
import { getServerCookieHeader } from '#/lib/server-cookie'
import {
	agedPaperSurface,
	brushedMetalPlate,
	ruledLedgerRow,
	stenciledTitle,
} from '#/lib/workshop-mixins'

type PageRow = {
	readonly id: string
	readonly slug: string
	readonly lang: string
	readonly title: string
	readonly status: string
	readonly template: string | null
	readonly viewCount: number
	readonly publishedAt: string | null
	readonly companyId: string | null
}

const validateSearch = validateSearchWith({
	companyId: Schema.NonEmptyString,
	status: Schema.NonEmptyString,
	lang: Schema.NonEmptyString,
})

async function loadPagesOnServer(
	search: PagesSearch,
): Promise<{ pages: ReadonlyArray<unknown> }> {
	const [{ Effect }, { makeBatudaApiServer }, cookie] = await Promise.all([
		import('effect'),
		import('#/lib/batuda-api-server'),
		getServerCookieHeader(),
	])
	const program = Effect.gen(function* () {
		const client = yield* makeBatudaApiServer(cookie ?? undefined)
		return yield* client.pages.list({ query: search })
	})
	const pages = await Effect.runPromise(program)
	return { pages }
}

export const Route = createFileRoute('/pages/')({
	validateSearch,
	loaderDeps: ({ search }) => ({ search }),
	loader: async ({ deps: { search } }) => {
		if (!import.meta.env.SSR) {
			return { dehydrated: [] as const }
		}
		try {
			const { pages } = await loadPagesOnServer(search)
			return {
				dehydrated: [
					dehydrateAtom(pagesSearchAtom(search), AsyncResult.success(pages)),
				] as const,
			}
		} catch (error) {
			console.warn('[PagesLoader] falling back to empty hydration:', error)
			return { dehydrated: [] as const }
		}
	},
	component: PagesListPage,
})

function PagesListPage() {
	const { t } = useLingui()
	const search = Route.useSearch()
	const navigate = useNavigate({ from: Route.fullPath })

	const searchKey = canonicalKey(search)
	const atom = useMemo(() => pagesSearchAtom(search), [searchKey])
	const result = useAtomValue(atom)

	const pages = useMemo<ReadonlyArray<PageRow>>(
		() => (AsyncResult.isSuccess(result) ? narrowPages(result.value) : []),
		[result],
	)
	const isLoading = AsyncResult.isInitial(result)

	const [statusFilter, setStatusFilter] = useState(search.status ?? '')

	return (
		<Page>
			<Header>
				<Title>
					<Trans>Pages</Trans>
				</Title>
				<HeaderActions>
					<StatusFilter
						data-testid='pages-status-filter'
						value={statusFilter}
						onChange={e => {
							const nextStatus = e.target.value
							setStatusFilter(nextStatus)
							if (nextStatus) {
								void navigate({ search: { ...search, status: nextStatus } })
							} else {
								// Drop `status` entirely rather than setting it to '' —
								// `exactOptionalPropertyTypes` rejects `undefined` here
								// and an empty string would show up in the URL.
								const { status: _, ...rest } = search
								void navigate({ search: rest })
							}
						}}
					>
						<option value=''>{t`All statuses`}</option>
						<option value='draft'>{t`Draft`}</option>
						<option value='published'>{t`Published`}</option>
					</StatusFilter>
				</HeaderActions>
			</Header>

			{isLoading ? (
				<LoadingSpinner />
			) : pages.length === 0 ? (
				<EmptyState
					title={t`No pages yet`}
					description={t`Create a prospect landing page from a company detail view or via the MCP tools.`}
				/>
			) : (
				<Table>
					<thead>
						<tr>
							<Th>{t`Title`}</Th>
							<Th>{t`Slug`}</Th>
							<Th>{t`Lang`}</Th>
							<Th>{t`Status`}</Th>
							<Th>{t`Views`}</Th>
							<Th>{t`Published`}</Th>
							<Th />
						</tr>
					</thead>
					<tbody>
						{pages.map(page => (
							<Row key={page.id} data-testid={`page-row-${page.slug}`}>
								<Td>
									<PageTitleCell>
										<Link to='/pages/$id' params={{ id: page.id }}>
											{page.title}
										</Link>
									</PageTitleCell>
								</Td>
								<TdMono>{page.slug}</TdMono>
								<Td>{page.lang}</Td>
								<Td>
									<StatusDot $published={page.status === 'published'} />
									{page.status}
								</Td>
								<Td>{page.viewCount}</Td>
								<Td>
									<RelativeDate value={page.publishedAt} fallback={t`—`} />
								</Td>
								<Td>
									{page.status === 'published' && (
										<PreviewLink
											href={`https://engranatge.localhost/${page.lang}/${page.slug}`}
											target='_blank'
											rel='noopener noreferrer'
											aria-label={t`Preview`}
										>
											<ExternalLink size={14} aria-hidden />
										</PreviewLink>
									)}
								</Td>
							</Row>
						))}
					</tbody>
				</Table>
			)}
		</Page>
	)
}

function narrowPages(rows: ReadonlyArray<unknown>): ReadonlyArray<PageRow> {
	const out: Array<PageRow> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		if (typeof r['slug'] !== 'string') continue
		if (typeof r['title'] !== 'string') continue
		out.push({
			id: r['id'],
			slug: r['slug'],
			lang: typeof r['lang'] === 'string' ? r['lang'] : 'en',
			title: r['title'],
			status: typeof r['status'] === 'string' ? r['status'] : 'draft',
			template: typeof r['template'] === 'string' ? r['template'] : null,
			viewCount: typeof r['viewCount'] === 'number' ? r['viewCount'] : 0,
			publishedAt:
				typeof r['publishedAt'] === 'string' ? r['publishedAt'] : null,
			companyId: typeof r['companyId'] === 'string' ? r['companyId'] : null,
		})
	}
	return out
}

const Page = styled.div.withConfig({ displayName: 'PagesListPage' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`

const Header = styled.header.withConfig({ displayName: 'PagesListHeader' })`
	${brushedMetalPlate}
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: var(--space-md) var(--space-lg);
	gap: var(--space-md);
`

const Title = styled.h2.withConfig({ displayName: 'PagesListTitle' })`
	${stenciledTitle}
	font-size: var(--typescale-headline-medium-size);
	line-height: var(--typescale-headline-medium-line);
	letter-spacing: 0.06em;
	margin: 0;
`

const HeaderActions = styled.div.withConfig({
	displayName: 'PagesListHeaderActions',
})`
	display: flex;
	align-items: center;
	gap: var(--space-sm);
`

const StatusFilter = styled.select.withConfig({
	displayName: 'PagesListStatusFilter',
})`
	padding: var(--space-xs) var(--space-sm);
	border-radius: 6px;
	border: 1px solid var(--color-outline);
	background: var(--color-surface);
	color: var(--color-on-surface);
	font-size: var(--typescale-body-medium-size);
`

const Table = styled.table.withConfig({ displayName: 'PagesListTable' })`
	${agedPaperSurface}
	width: 100%;
	border-collapse: collapse;
`

const Th = styled.th.withConfig({ displayName: 'PagesListTh' })`
	text-align: left;
	padding: var(--space-sm) var(--space-md);
	font-size: var(--typescale-label-large-size);
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: var(--color-on-surface-variant);
	border-bottom: 2px solid var(--color-outline);
`

const Row = styled.tr.withConfig({ displayName: 'PagesListRow' })`
	${ruledLedgerRow}
`

const Td = styled.td.withConfig({ displayName: 'PagesListTd' })`
	padding: var(--space-sm) var(--space-md);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
	vertical-align: middle;
`

const TdMono = styled(Td).withConfig({ displayName: 'PagesListTdMono' })`
	font-family: var(--font-mono, monospace);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const PageTitleCell = styled.span.withConfig({
	displayName: 'PagesListPageTitleCell',
})`
	& a {
		color: var(--color-primary);
		text-decoration: none;
		font-weight: var(--font-weight-medium);
	}

	& a:hover {
		text-decoration: underline;
	}
`

const StatusDot = styled.span.withConfig({
	displayName: 'PagesListStatusDot',
	shouldForwardProp: prop => prop !== '$published',
})<{ $published: boolean }>`
	display: inline-block;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	margin-right: var(--space-xs);
	background: ${p =>
		p.$published
			? 'var(--color-status-client)'
			: 'var(--color-status-prospect)'};
`

const PreviewLink = styled.a.withConfig({
	displayName: 'PagesListPreviewLink',
})`
	display: inline-flex;
	align-items: center;
	color: var(--color-on-surface-variant);

	&:hover {
		color: var(--color-primary);
	}
`
