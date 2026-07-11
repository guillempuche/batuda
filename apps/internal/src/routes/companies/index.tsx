import { useAtomValue } from '@effect/atom-react'
import { useLingui } from '@lingui/react/macro'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Schema } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import {
	Check,
	ChevronsUpDown,
	Columns3,
	LayoutGrid,
	Search,
	X,
} from 'lucide-react'
import { LayoutGroup, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriInput, PriSelect } from '@batuda/ui/pri'

import {
	COMPANIES_PAGE_SIZE,
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
	STATUS_ORDER,
	StatusBadge,
} from '#/components/shared/status-badge'
import { useQuickCapture } from '#/context/quick-capture-context'
import { dehydrateAtom } from '#/lib/atom-hydration'
import { useOrgMembers } from '#/lib/org-members'
import { validateSearchWith } from '#/lib/search-schema'
import { getServerCookieHeader } from '#/lib/server-cookie'
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
	readonly ownerId: string | null
}

/**
 * TanStack Router `validateSearch` — runs on every search-param change
 * and produces the canonical `CompaniesSearch` shape. Empty strings and
 * non-numeric priorities are dropped entirely so the URL stays clean
 * (`?status=prospect` instead of `?status=prospect&query=&priority=`).
 *
 * `priority` accepts either a parsed number (client navigations where
 * TanStack already decoded the param) or a numeric string (raw URL on
 * first hit). Both decode to `number`.
 */
const validateSearch = validateSearchWith({
	status: Schema.NonEmptyString,
	region: Schema.NonEmptyString,
	industry: Schema.NonEmptyString,
	priority: Schema.Union([Schema.Number, Schema.NumberFromString]),
	owner: Schema.NonEmptyString,
	sort: Schema.NonEmptyString,
	query: Schema.NonEmptyString,
})

/**
 * Server-only load: forwards the incoming Better-Auth cookie and runs
 * the typed HttpApi call. Same pattern the dashboard uses — dynamically
 * imports the server module so Vite tree-shakes it out of the client
 * bundle.
 */
async function loadCompaniesOnServer(
	search: CompaniesSearch,
): Promise<{ companies: ReadonlyArray<unknown> }> {
	const [{ Effect }, { makeBatudaApiServer }, cookie] = await Promise.all([
		import('effect'),
		import('#/lib/batuda-api-server'),
		getServerCookieHeader(),
	])
	const program = Effect.gen(function* () {
		const client = yield* makeBatudaApiServer(cookie ?? undefined)
		return yield* client.companies.list({
			query: { ...search, limit: COMPANIES_PAGE_SIZE },
		})
	})
	const companies = await Effect.runPromise(program)
	return { companies }
}

export const Route = createFileRoute('/companies/')({
	validateSearch,
	loaderDeps: ({ search }) => ({ search }),
	loader: async ({ deps: { search } }) => {
		if (!import.meta.env.SSR) {
			// Client-side navigation: let the atom refetch via `BatudaApiAtom`
			// using the browser session cookie. Empty dehydration leaves the
			// registry alone and the component renders the loading state.
			return { dehydrated: [] as const }
		}
		try {
			const { companies } = await loadCompaniesOnServer(search)
			return {
				dehydrated: [
					dehydrateAtom(
						companiesSearchAtom(search, COMPANIES_PAGE_SIZE),
						AsyncResult.success(companies),
					),
				] as const,
			}
		} catch (error) {
			console.warn('[CompaniesLoader] falling back to empty hydration:', error)
			return { dehydrated: [] as const }
		}
	},
	head: () => ({ meta: [{ title: 'Companies — Batuda' }] }),
	component: CompaniesListPage,
})

/**
 * Debounce window for the search input before we push to the URL. 300ms
 * strikes the usual balance — long enough to not hammer the API on every
 * keystroke, short enough that typing feels responsive.
 */
const SEARCH_DEBOUNCE_MS = 300

const ALL = '__all__'

function isNonEmpty(value: string | null): value is string {
	return value !== null && value !== ''
}

/** Strip `status` from the search when linking to the board — its columns are
 * the statuses, so a status filter there makes no sense. */
function boardSearch(search: CompaniesSearch): CompaniesSearch {
	const { status: _status, ...rest } = search
	return rest
}

function CompaniesListPage() {
	const { t } = useLingui()
	const search = Route.useSearch()
	const navigate = useNavigate({ from: Route.fullPath })
	const { open: openQuickCapture } = useQuickCapture()
	const { members, meUserId } = useOrgMembers()

	// "Load more" grows the fetched window; reset it whenever the filters change.
	const searchKey = canonicalSearchKey(search)
	const [visibleLimit, setVisibleLimit] = useState(COMPANIES_PAGE_SIZE)
	useEffect(() => {
		setVisibleLimit(COMPANIES_PAGE_SIZE)
	}, [searchKey])

	const atom = useMemo(
		() => companiesSearchAtom(search, visibleLimit),
		// searchKey + visibleLimit fully identify the atom; `search` is unstable.
		// biome-ignore lint/correctness/useExhaustiveDependencies: keyed by searchKey
		[searchKey, visibleLimit],
	)
	const result = useAtomValue(atom)

	const companies = useMemo<ReadonlyArray<CompanyRow>>(
		() => (AsyncResult.isSuccess(result) ? narrowCompanies(result.value) : []),
		[result],
	)
	const isLoading = AsyncResult.isInitial(result)
	const isFailure = AsyncResult.isFailure(result)
	// A full window came back, so there is probably another page to load.
	const hasMore = companies.length >= visibleLimit

	// ── Search input (debounced URL write) ──────────────────────
	const [searchInput, setSearchInput] = useState(search.query ?? '')
	useEffect(() => {
		setSearchInput(search.query ?? '')
	}, [search.query])
	useEffect(() => {
		const current = search.query ?? ''
		if (searchInput === current) return
		const timer = window.setTimeout(() => {
			void navigate({
				to: '/companies',
				search: prev => mergeSearch(prev, { query: searchInput }),
				replace: true,
			})
		}, SEARCH_DEBOUNCE_MS)
		return () => {
			window.clearTimeout(timer)
		}
	}, [searchInput, search.query, navigate])

	// ── Filter handlers ─────────────────────────────────────────
	const applyPatch = useCallback(
		(patch: Parameters<typeof mergeSearch>[1]) => {
			void navigate({
				to: '/companies',
				search: prev => mergeSearch(prev, patch),
			})
		},
		[navigate],
	)
	const handleStatusFilter = useCallback(
		(status: CompanyStatus | undefined) => {
			applyPatch({ status })
		},
		[applyPatch],
	)
	const handleClearFilters = useCallback(() => {
		setSearchInput('')
		void navigate({ to: '/companies', search: {} })
	}, [navigate])

	// ── Row actions ─────────────────────────────────────────────
	const handleLogInteraction = useCallback(
		(company: CompanyRow) => {
			openQuickCapture({ companyId: company.id, companyName: company.name })
		},
		[openQuickCapture],
	)

	// Region + industry options are the distinct values present in the loaded
	// companies — international, never a hardcoded Spanish vocabulary. Priority
	// and sort are fixed, geography-neutral sets.
	const regionOptions = useMemo(
		() => [...new Set(companies.map(c => c.region).filter(isNonEmpty))].sort(),
		[companies],
	)
	const industryOptions = useMemo(
		() =>
			[...new Set(companies.map(c => c.industry).filter(isNonEmpty))].sort(),
		[companies],
	)

	const activeFilters = hasActiveFilters(search)
	const countLabel = activeFilters
		? t`${companies.length} companies with filters applied`
		: companies.length === 1
			? t`1 company`
			: t`${companies.length} companies`

	const regionItems = [
		{ value: ALL, label: t`All regions` },
		...regionOptions.map(r => ({ value: r, label: r })),
	]
	const industryItems = [
		{ value: ALL, label: t`All industries` },
		...industryOptions.map(r => ({ value: r, label: r })),
	]
	const priorityItems = [
		{ value: ALL, label: t`Any priority` },
		{ value: '1', label: t`Hot` },
		{ value: '2', label: t`Medium` },
		{ value: '3', label: t`Cold` },
	]
	const ownerItems = [
		{ value: ALL, label: t`All owners` },
		...(meUserId ? [{ value: meUserId, label: t`My leads` }] : []),
		{ value: 'none', label: t`Unassigned` },
		...members
			.filter(m => m.userId !== meUserId)
			.map(m => ({ value: m.userId, label: m.name })),
	]
	const sortItems = [
		{ value: 'priority', label: t`Priority` },
		{ value: 'name', label: t`Name` },
		{ value: 'recent_contact', label: t`Recently contacted` },
		{ value: 'recent_update', label: t`Recently updated` },
	]

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
				<TopRow>
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
							data-testid='companies-search'
						/>
					</SearchWrap>
					<ViewToggle role='group' aria-label={t`Switch view`}>
						<ViewLink
							$active
							href='/companies'
							data-testid='companies-view-list'
							aria-current='page'
						>
							<LayoutGrid size={14} aria-hidden />
							<span>{t`List`}</span>
						</ViewLink>
						<ViewLink
							href={boardHref(boardSearch(search))}
							data-testid='companies-view-board'
						>
							<Columns3 size={14} aria-hidden />
							<span>{t`Board`}</span>
						</ViewLink>
					</ViewToggle>
				</TopRow>

				<StatusFilters role='group' aria-label={t`Filter by status`}>
					<StatusFilterButton
						type='button'
						$active={search.status === undefined}
						onClick={() => handleStatusFilter(undefined)}
						data-testid='companies-status-all'
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
							data-testid={`companies-status-${status}`}
						>
							<StatusBadge status={status} />
						</StatusFilterButton>
					))}
				</StatusFilters>

				<DropdownRow>
					<FilterSelect
						label={t`Region`}
						value={search.region ?? ALL}
						options={regionItems}
						onChange={v => applyPatch({ region: v === ALL ? undefined : v })}
						testId='companies-filter-region'
					/>
					<FilterSelect
						label={t`Industry`}
						value={search.industry ?? ALL}
						options={industryItems}
						onChange={v => applyPatch({ industry: v === ALL ? undefined : v })}
						testId='companies-filter-industry'
					/>
					<FilterSelect
						label={t`Priority`}
						value={
							search.priority !== undefined ? String(search.priority) : ALL
						}
						options={priorityItems}
						onChange={v =>
							applyPatch({ priority: v === ALL ? undefined : Number(v) })
						}
						testId='companies-filter-priority'
					/>
					<FilterSelect
						label={t`Owner`}
						value={search.owner ?? ALL}
						options={ownerItems}
						onChange={v => applyPatch({ owner: v === ALL ? undefined : v })}
						testId='companies-filter-owner'
					/>
					<FilterSelect
						label={t`Sort`}
						value={search.sort ?? 'priority'}
						options={sortItems}
						onChange={v => applyPatch({ sort: v })}
						testId='companies-filter-sort'
					/>
					{activeFilters && (
						<PriButton
							type='button'
							$variant='outlined'
							onClick={handleClearFilters}
							data-testid='companies-clear-filters'
						>
							<X size={14} aria-hidden />
							<span>{t`Clear filters`}</span>
						</PriButton>
					)}
				</DropdownRow>
			</Filters>

			{isLoading ? (
				<LoadingSpinner label={t`Loading companies…`} />
			) : isFailure ? (
				<EmptyState
					title={t`Could not load companies`}
					description={t`Check that your session is valid or try again.`}
				/>
			) : companies.length === 0 ? (
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
										data-testid='companies-clear-filters-empty'
									>
										<X size={14} aria-hidden />
										<span>{t`Clear filters`}</span>
									</PriButton>
								),
							}
						: {})}
				/>
			) : (
				<>
					<LayoutGroup>
						<Grid layout>
							{companies.map(company => (
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
					{hasMore && (
						<LoadMoreWrap>
							<PriButton
								type='button'
								$variant='outlined'
								onClick={() => setVisibleLimit(l => l + COMPANIES_PAGE_SIZE)}
								data-testid='companies-load-more'
							>
								<span>{t`Load more`}</span>
							</PriButton>
						</LoadMoreWrap>
					)}
				</>
			)}
		</Page>
	)
}

/** Build the /companies/board URL, carrying the shared filters as query params. */
function boardHref(search: CompaniesSearch): string {
	const params = new URLSearchParams()
	if (search.region) params.set('region', search.region)
	if (search.industry) params.set('industry', search.industry)
	if (search.priority !== undefined)
		params.set('priority', String(search.priority))
	if (search.owner) params.set('owner', search.owner)
	if (search.sort) params.set('sort', search.sort)
	if (search.query) params.set('query', search.query)
	const qs = params.toString()
	return qs ? `/companies/board?${qs}` : '/companies/board'
}

function FilterSelect({
	label,
	value,
	options,
	onChange,
	testId,
}: {
	readonly label: string
	readonly value: string
	readonly options: ReadonlyArray<{ value: string; label: string }>
	readonly onChange: (value: string) => void
	readonly testId: string
}) {
	return (
		<PriSelect.Root
			items={options}
			value={value}
			onValueChange={v => {
				if (typeof v === 'string') onChange(v)
			}}
		>
			<PriSelect.Trigger data-testid={testId} aria-label={label}>
				<PriSelect.Value />
				<PriSelect.Icon>
					<ChevronsUpDown size={14} aria-hidden />
				</PriSelect.Icon>
			</PriSelect.Trigger>
			<PriSelect.Portal>
				<PriSelect.Positioner sideOffset={6}>
					<PriSelect.Popup>
						{options.map(opt => (
							<PriSelect.Item
								key={opt.value}
								value={opt.value}
								data-testid={`${testId}-option-${opt.value}`}
							>
								<PriSelect.ItemIndicator>
									<Check size={12} aria-hidden />
								</PriSelect.ItemIndicator>
								<PriSelect.ItemText>{opt.label}</PriSelect.ItemText>
							</PriSelect.Item>
						))}
					</PriSelect.Popup>
				</PriSelect.Positioner>
			</PriSelect.Portal>
		</PriSelect.Root>
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
		owner: string | undefined
		sort: string | undefined
		query: string | undefined
	}>,
): CompaniesSearch {
	const result: {
		status?: string
		region?: string
		industry?: string
		priority?: number
		owner?: string
		sort?: string
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

	const owner = 'owner' in next ? next.owner : prev.owner
	if (owner !== undefined && owner !== '') result.owner = owner

	const sort = 'sort' in next ? next.sort : prev.sort
	if (sort !== undefined && sort !== '') result.sort = sort

	return result
}

function hasActiveFilters(search: CompaniesSearch): boolean {
	return (
		search.status !== undefined ||
		search.region !== undefined ||
		search.industry !== undefined ||
		search.priority !== undefined ||
		search.owner !== undefined ||
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
			ownerId: typeof r['ownerId'] === 'string' ? r['ownerId'] : null,
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

const TopRow = styled.div.withConfig({ displayName: 'CompaniesListTopRow' })`
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-sm);

	@media (min-width: 640px) {
		flex-wrap: nowrap;
	}

	& > :first-child {
		flex: 1 1 12rem;
	}
`

const ViewToggle = styled.div.withConfig({
	displayName: 'CompaniesListViewToggle',
})`
	display: inline-flex;
	align-items: stretch;
	border: 2px solid var(--color-outline);
	border-radius: var(--shape-2xs);
	overflow: hidden;
	flex-shrink: 0;
`

const ViewLink = styled.a.withConfig({
	displayName: 'CompaniesListViewLink',
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

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const DropdownRow = styled.div.withConfig({
	displayName: 'CompaniesListDropdownRow',
})`
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-2xs);
`

const LoadMoreWrap = styled.div.withConfig({
	displayName: 'CompaniesListLoadMore',
})`
	display: flex;
	justify-content: center;
	padding: var(--space-md) 0;
`
