import { useAtomValue } from '@effect/atom-react'
import { useLingui } from '@lingui/react/macro'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import { Search, X } from 'lucide-react'
import { LayoutGroup, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriInput } from '@engranatge/ui/pri'

import {
	type CompaniesSearch,
	canonicalSearchKey,
	companiesSearchAtom,
} from '#/atoms/companies-atoms'
import { CompanyCard } from '#/components/shared/company-card'
import { EmptyState } from '#/components/shared/empty-state'
import { KpiCounter } from '#/components/shared/kpi-counter'
import { LoadingSpinner } from '#/components/shared/loading-spinner'
import {
	type CompanyStatus,
	StatusBadge,
} from '#/components/shared/status-badge'
import { useQuickCapture } from '#/context/quick-capture-context'
import { dehydrateAtom } from '#/lib/atom-hydration'
import {
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

/**
 * Narrow row shape for the list view. The server returns `Schema.Unknown`
 * so we runtime-narrow at the boundary. Shares the same fields the
 * dashboard needs plus `region` (used by the Region filter).
 */
type CompanyRow = {
	readonly id: string
	readonly slug: string
	readonly name: string
	readonly status: string
	readonly industry: string | null
	readonly location: string | null
	readonly region: string | null
	readonly priority: number | null
	readonly lastContactedAt: string | null
}

/**
 * TanStack Router `validateSearch` — runs on every search-param change
 * and produces the canonical `CompaniesSearch` shape. Empty strings and
 * non-numeric priorities are dropped entirely so the URL stays clean
 * (`?status=prospect` instead of `?status=prospect&query=&priority=`).
 */
function validateSearch(raw: Record<string, unknown>): CompaniesSearch {
	const out: {
		status?: string
		region?: string
		industry?: string
		priority?: number
		query?: string
	} = {}

	if (typeof raw['status'] === 'string' && raw['status'] !== '') {
		out.status = raw['status']
	}
	if (typeof raw['region'] === 'string' && raw['region'] !== '') {
		out.region = raw['region']
	}
	if (typeof raw['industry'] === 'string' && raw['industry'] !== '') {
		out.industry = raw['industry']
	}
	if (typeof raw['priority'] === 'number' && Number.isFinite(raw['priority'])) {
		out.priority = raw['priority']
	} else if (typeof raw['priority'] === 'string' && raw['priority'] !== '') {
		const parsed = Number(raw['priority'])
		if (Number.isFinite(parsed)) out.priority = parsed
	}
	if (typeof raw['query'] === 'string' && raw['query'] !== '') {
		out.query = raw['query']
	}

	return out
}

/**
 * Server-only load: forwards the incoming Better-Auth cookie and runs
 * the typed HttpApi call. Same pattern the dashboard uses — dynamically
 * imports the server module so Vite tree-shakes it out of the client
 * bundle.
 */
async function loadCompaniesOnServer(
	search: CompaniesSearch,
): Promise<{ companies: ReadonlyArray<unknown> }> {
	const [{ Effect }, { getRequestHeader }, { makeForjaApiServer }] =
		await Promise.all([
			import('effect'),
			import('@tanstack/react-start/server'),
			import('#/lib/forja-api-server'),
		])
	const cookie = getRequestHeader('cookie')
	const program = Effect.gen(function* () {
		const client = yield* makeForjaApiServer(cookie)
		return yield* client.companies.list({ query: search })
	})
	const companies = await Effect.runPromise(program)
	return { companies }
}

export const Route = createFileRoute('/companies/')({
	validateSearch,
	loaderDeps: ({ search }) => ({ search }),
	loader: async ({ deps: { search } }) => {
		if (!import.meta.env.SSR) {
			// Client-side navigation: let the atom refetch via `ForjaApiAtom`
			// using the browser session cookie. Empty dehydration leaves the
			// registry alone and the component renders the loading state.
			return { dehydrated: [] as const }
		}
		try {
			const { companies } = await loadCompaniesOnServer(search)
			return {
				dehydrated: [
					dehydrateAtom(
						companiesSearchAtom(search),
						AsyncResult.success(companies),
					),
				] as const,
			}
		} catch (error) {
			console.warn('[CompaniesLoader] falling back to empty hydration:', error)
			return { dehydrated: [] as const }
		}
	},
	component: CompaniesListPage,
})

/**
 * Debounce window for the search input before we push to the URL. 300ms
 * strikes the usual balance — long enough to not hammer the API on every
 * keystroke, short enough that typing feels responsive.
 */
const SEARCH_DEBOUNCE_MS = 300

/**
 * Status pill order on the filter bar. Matches the enum order in
 * `packages/domain/src/schema/companies.ts` and the dashboard's
 * `STATUS_ORDER`.
 */
const STATUS_ORDER: ReadonlyArray<CompanyStatus> = [
	'prospect',
	'contacted',
	'responded',
	'meeting',
	'proposal',
	'client',
	'closed',
	'dead',
]

function CompaniesListPage() {
	const { t } = useLingui()
	const search = Route.useSearch()
	const navigate = useNavigate({ from: Route.fullPath })
	const { open: openQuickCapture } = useQuickCapture()

	// The atom identity depends on the search's canonical key, not its
	// object reference — so memo on the key to avoid re-subscribing the
	// registry just because TanStack Router re-created the search object.
	const searchKey = canonicalSearchKey(search)
	const atom = useMemo(() => companiesSearchAtom(search), [searchKey])
	const result = useAtomValue(atom)

	const companies = useMemo<ReadonlyArray<CompanyRow>>(
		() => (AsyncResult.isSuccess(result) ? narrowCompanies(result.value) : []),
		[result],
	)
	const isLoading = AsyncResult.isInitial(result)
	const isFailure = AsyncResult.isFailure(result)

	// ── Search input (debounced URL write) ──────────────────────
	const [searchInput, setSearchInput] = useState(search.query ?? '')

	// Sync the controlled input back to URL state when the URL changes
	// out-of-band (back button, link click, etc).
	useEffect(() => {
		setSearchInput(search.query ?? '')
	}, [search.query])

	// Push the debounced input to the URL. Only navigates when the value
	// actually differs from what's already in the URL, otherwise we'd
	// loop through the URL-sync effect above.
	useEffect(() => {
		const current = search.query ?? ''
		if (searchInput === current) return
		const timer = window.setTimeout(() => {
			void navigate({
				to: '/companies',
				search: prev => mergeSearch(prev, { query: searchInput }),
			})
		}, SEARCH_DEBOUNCE_MS)
		return () => {
			window.clearTimeout(timer)
		}
	}, [searchInput, search.query, navigate])

	// ── Filter handlers ─────────────────────────────────────────
	const handleStatusFilter = useCallback(
		(status: CompanyStatus | undefined) => {
			void navigate({
				to: '/companies',
				search: prev => mergeSearch(prev, { status }),
			})
		},
		[navigate],
	)

	const handleClearFilters = useCallback(() => {
		setSearchInput('')
		void navigate({ to: '/companies', search: {} })
	}, [navigate])

	// ── Row actions ─────────────────────────────────────────────
	const handleLogInteraction = useCallback(
		(company: CompanyRow) => {
			openQuickCapture({
				companyId: company.id,
				companyName: company.name,
			})
		},
		[openQuickCapture],
	)

	// Client-side sort: priority ASC (1 first, then 2, 3, null), then
	// last-contacted DESC within priority buckets so recently-touched
	// companies surface first.
	const sorted = useMemo(
		() =>
			[...companies].sort((a, b) => {
				const pa = a.priority ?? Number.POSITIVE_INFINITY
				const pb = b.priority ?? Number.POSITIVE_INFINITY
				if (pa !== pb) return pa - pb
				const la = a.lastContactedAt ? Date.parse(a.lastContactedAt) : 0
				const lb = b.lastContactedAt ? Date.parse(b.lastContactedAt) : 0
				return lb - la
			}),
		[companies],
	)

	const activeFilters = hasActiveFilters(search)
	const countLabel = activeFilters
		? t`${companies.length} companies with filters applied`
		: companies.length === 1
			? t`1 company`
			: t`${companies.length} companies`

	return (
		<Page>
			<Intro>
				<TitleRow>
					<Title>{t`Companies`}</Title>
					<Subtitle>{countLabel}</Subtitle>
				</TitleRow>
				<KpiCounter value={companies.length} label={t`In pipeline`} />
			</Intro>

			<Filters role='group' aria-label={t`Filter companies`}>
				<SearchWrap>
					<SearchIcon>
						<Search size={16} aria-hidden />
					</SearchIcon>
					<PriInput
						type='search'
						placeholder={t`Search by name, industry, or location…`}
						value={searchInput}
						onChange={event => setSearchInput(event.target.value)}
						aria-label={t`Search companies`}
						style={{ paddingLeft: 'calc(var(--space-sm) * 2 + 16px)' }}
					/>
				</SearchWrap>

				<StatusFilters role='group' aria-label={t`Filter by status`}>
					<StatusFilterButton
						type='button'
						$active={search.status === undefined}
						onClick={() => handleStatusFilter(undefined)}
					>
						{t`All`}
					</StatusFilterButton>
					{STATUS_ORDER.map(status => (
						<StatusFilterButton
							key={status}
							type='button'
							$active={search.status === status}
							onClick={() =>
								handleStatusFilter(
									search.status === status ? undefined : status,
								)
							}
							aria-pressed={search.status === status}
						>
							<StatusBadge status={status} />
						</StatusFilterButton>
					))}
				</StatusFilters>

				{activeFilters && (
					<PriButton
						type='button'
						$variant='outlined'
						onClick={handleClearFilters}
					>
						<X size={14} aria-hidden />
						<span>{t`Clear filters`}</span>
					</PriButton>
				)}
			</Filters>

			{isLoading ? (
				<LoadingSpinner label={t`Loading companies…`} />
			) : isFailure ? (
				<EmptyState
					title={t`Could not load companies`}
					description={t`Check that your session is valid or try again.`}
				/>
			) : sorted.length === 0 ? (
				<EmptyState
					title={
						activeFilters
							? t`No companies match the filters`
							: t`No companies yet`
					}
					{...(activeFilters
						? {
								description: t`Try different criteria or clear the filters.`,
								action: (
									<PriButton
										type='button'
										$variant='outlined'
										onClick={handleClearFilters}
									>
										<X size={14} aria-hidden />
										<span>{t`Clear filters`}</span>
									</PriButton>
								),
							}
						: {})}
				/>
			) : (
				<LayoutGroup>
					<Grid layout>
						{sorted.map(company => (
							<CompanyCard
								key={company.id}
								company={{
									slug: company.slug,
									name: company.name,
									status: company.status,
									industry: company.industry,
									location: company.location,
									region: company.region,
									priority: company.priority,
									lastContactedAt: company.lastContactedAt,
								}}
								actions={{
									onLogInteraction: () => handleLogInteraction(company),
								}}
							/>
						))}
					</Grid>
				</LayoutGroup>
			)}
		</Page>
	)
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Produce the next `CompaniesSearch` from a partial patch while keeping
 * the result strict: any field in `next` that's undefined or empty is
 * *dropped* from the result instead of set to undefined. This is the
 * only way to clear a search param under `exactOptionalPropertyTypes`
 * — assigning `undefined` to an optional field is a TS error.
 */
function mergeSearch(
	prev: CompaniesSearch,
	next: Partial<{
		status: string | undefined
		region: string | undefined
		industry: string | undefined
		priority: number | undefined
		query: string | undefined
	}>,
): CompaniesSearch {
	const result: {
		status?: string
		region?: string
		industry?: string
		priority?: number
		query?: string
	} = {}

	const status = 'status' in next ? next.status : prev.status
	if (status !== undefined && status !== '') result.status = status

	const region = 'region' in next ? next.region : prev.region
	if (region !== undefined && region !== '') result.region = region

	const industry = 'industry' in next ? next.industry : prev.industry
	if (industry !== undefined && industry !== '') result.industry = industry

	const priority = 'priority' in next ? next.priority : prev.priority
	if (priority !== undefined) result.priority = priority

	const query = 'query' in next ? next.query : prev.query
	if (query !== undefined && query !== '') result.query = query

	return result
}

function hasActiveFilters(search: CompaniesSearch): boolean {
	return (
		search.status !== undefined ||
		search.region !== undefined ||
		search.industry !== undefined ||
		search.priority !== undefined ||
		search.query !== undefined
	)
}

function narrowCompanies(
	rows: ReadonlyArray<unknown>,
): ReadonlyArray<CompanyRow> {
	const out: Array<CompanyRow> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		if (typeof r['slug'] !== 'string') continue
		if (typeof r['name'] !== 'string') continue
		if (typeof r['status'] !== 'string') continue
		out.push({
			id: r['id'],
			slug: r['slug'],
			name: r['name'],
			status: r['status'],
			industry: typeof r['industry'] === 'string' ? r['industry'] : null,
			location: typeof r['location'] === 'string' ? r['location'] : null,
			region: typeof r['region'] === 'string' ? r['region'] : null,
			priority: typeof r['priority'] === 'number' ? r['priority'] : null,
			lastContactedAt:
				typeof r['lastContactedAt'] === 'string' ? r['lastContactedAt'] : null,
		})
	}
	return out
}

// ── Styles ───────────────────────────────────────────────────────

const Page = styled.div.withConfig({ displayName: 'CompaniesListPage' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`

const Intro = styled.div.withConfig({ displayName: 'CompaniesListIntro' })`
	display: grid;
	gap: var(--space-md);
	align-items: end;

	@media (min-width: 768px) {
		grid-template-columns: 1fr auto;
	}
`

const TitleRow = styled.div.withConfig({
	displayName: 'CompaniesListTitleRow',
})`
	${rulerUnderRule}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-bottom: var(--space-sm);
`

const Title = styled.h2.withConfig({ displayName: 'CompaniesListTitle' })`
	${stenciledTitle}
	margin: 0;
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
`

const Subtitle = styled.p.withConfig({ displayName: 'CompaniesListSubtitle' })`
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	letter-spacing: var(--typescale-body-large-tracking);
	color: var(--color-on-surface-variant);
	font-style: italic;
`

const Filters = styled.div.withConfig({ displayName: 'CompaniesListFilters' })`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md);
	border-radius: var(--shape-2xs);
`

const SearchWrap = styled.div.withConfig({
	displayName: 'CompaniesListSearchWrap',
})`
	position: relative;
	display: flex;
	align-items: center;
`

const SearchIcon = styled.span.withConfig({
	displayName: 'CompaniesListSearchIcon',
})`
	position: absolute;
	left: var(--space-sm);
	display: inline-flex;
	color: var(--color-on-surface-variant);
	pointer-events: none;
	z-index: 2;
`

const StatusFilters = styled.div.withConfig({
	displayName: 'CompaniesListStatusFilters',
})`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-2xs);
`

const StatusFilterButton = styled.button.withConfig({
	displayName: 'CompaniesListStatusFilterButton',
	shouldForwardProp: prop => prop !== '$active',
})<{ $active: boolean }>`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-sm);
	background: ${p => (p.$active ? 'var(--color-primary)' : 'transparent')};
	color: ${p =>
		p.$active ? 'var(--color-on-primary)' : 'var(--color-on-surface)'};
	border: 2px
		${p => (p.$active ? 'solid' : 'dashed')}
		${p =>
			p.$active
				? 'color-mix(in oklab, var(--color-primary) 70%, black)'
				: 'var(--color-outline)'};
	border-radius: var(--shape-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	line-height: var(--typescale-label-small-line);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	cursor: pointer;
	transition:
		background 160ms ease,
		color 160ms ease,
		border-color 160ms ease;

	${p =>
		p.$active &&
		`
			text-shadow: var(--text-shadow-engrave);
			box-shadow:
				inset 0 1px 3px rgba(0, 0, 0, 0.25),
				0 1px 0 rgba(255, 255, 255, 0.15);
		`}

	&:hover:not(:disabled) {
		border-color: var(--color-primary);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const Grid = styled(motion.div).withConfig({
	displayName: 'CompaniesListGrid',
})`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-md);

	@media (min-width: 768px) {
		grid-template-columns: 1fr 1fr;
	}

	@media (min-width: 1024px) {
		grid-template-columns: 1fr 1fr 1fr;
	}

	/* Micro-rotation to break grid rhythm. See CompanyCard for the
	 * --card-rotate hook and hover straighten. */
	& > * {
		--card-rotate: 0deg;
	}
	& > :nth-child(3n + 1) {
		--card-rotate: -0.35deg;
	}
	& > :nth-child(3n + 2) {
		--card-rotate: 0.25deg;
	}
	& > :nth-child(3n + 3) {
		--card-rotate: -0.15deg;
	}
`
