import { useAtomRefresh, useAtomSet } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { DateTime, Schema } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import { ChevronsUpDown, Search, X } from 'lucide-react'
import { LayoutGroup, motion } from 'motion/react'
import { css, styled } from 'next-yak'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { CommaList } from '@batuda/controllers'
import {
	ATTENTION_FILTERS,
	type AttentionFilter,
	AttentionFilter as AttentionFilterSchema,
	COMPANY_SORTS,
	type CompanySort,
	CompanySort as CompanySortSchema,
} from '@batuda/domain'
import { PriButton, PriInput, PriSelect, usePriToast } from '@batuda/ui/pri'

import {
	COMPANIES_FIRST_PAGE,
	COMPANIES_PAGE_SIZE,
	type CompaniesSearch,
	canonicalSearchKey,
	companiesSearchAtom,
} from '#/atoms/companies-atoms'
import { restoreCompanyAtom } from '#/atoms/company-atoms'
import { companyFacetsAtom, facetsQuery } from '#/atoms/company-facets-atoms'
import { CompaniesHeader } from '#/components/companies/companies-header'
import { SavedViews } from '#/components/companies/saved-views'
import { CompanyCard } from '#/components/shared/company-card'
import { EmptyState } from '#/components/shared/empty-state'
import { ErrorState } from '#/components/shared/error-state'
import { InfiniteListFooter } from '#/components/shared/infinite-list-footer'
import { LoadingSpinner } from '#/components/shared/loading-spinner'
import { MultiSelectFilter } from '#/components/shared/multi-select-filter'
import {
	PRIORITY_LEVELS,
	priorityShortLabels,
} from '#/components/shared/priority-dot'
import { SrOnly } from '#/components/shared/sr-only'
import {
	type CompanyStatus,
	STATUS_ORDER,
	StatusBadge,
} from '#/components/shared/status-badge'
import { useQuickCapture } from '#/context/quick-capture-context'
import { useCompanyFilterOptions } from '#/hooks/use-company-filter-options'
import { useInfiniteList } from '#/hooks/use-infinite-list'
import { dehydrateAtom } from '#/lib/atom-hydration'
import { companiesSearchToQuery } from '#/lib/companies-search-params'
import { useOrgMembers } from '#/lib/org-members'
import { validateSearchWith } from '#/lib/search-schema'
import { getServerCookieHeader } from '#/lib/server-cookie'
import { brushedMetalPlate } from '#/lib/workshop-mixins'

/**
 * Narrow row shape for the list view. The server returns `Schema.Unknown`
 * so we runtime-narrow at the boundary. Shares the same fields the
 * dashboard needs.
 */
type CompanyRow = {
	readonly id: string
	readonly slug: string
	readonly name: string
	readonly status: string
	readonly industry: string | null
	readonly location: string | null
	readonly country: string | null
	readonly priority: number | null
	readonly lastContactedAt: string | null
	readonly ownerId: string | null
}

// A filter holding several values arrives one of two ways, and both have to
// decode: comma-separated from a link somebody wrote or a link this page built,
// and as a list from the router's own round-trip of what it last put in the URL.
// The same two cases `priority` already had, for the same reason.
const ValueList = Schema.Union([Schema.Array(Schema.NonEmptyString), CommaList])

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
	status: ValueList,
	country: ValueList,
	industry: Schema.NonEmptyString,
	priority: Schema.Union([Schema.Number, Schema.NumberFromString]),
	owner: ValueList,
	// What a research run concluded. Not a closed set: nothing stops a run
	// writing a word nobody listed, and a company carrying one still has to be
	// findable.
	fitVerdict: ValueList,
	tags: ValueList,
	sort: CompanySortSchema,
	query: Schema.NonEmptyString,
	// Set when arriving from a dashboard heading, so the list opens on exactly
	// what that heading was counting rather than on everything.
	attention: AttentionFilterSchema,
	staleDays: Schema.Union([Schema.Number, Schema.NumberFromString]),
	// Shows the ones taken out of view, so somebody can put one back. Absent
	// means the companies in use, which is the page's ordinary job. A URL
	// carrying anything else is dropped rather than passed on as a filter the
	// server would not recognise.
	deleted: Schema.Literals(['only']),
})

/**
 * Server-only load: forwards the incoming Better-Auth cookie and runs
 * the typed HttpApi call. Same pattern the dashboard uses — dynamically
 * imports the server module so Vite tree-shakes it out of the client
 * bundle.
 */
async function loadCompaniesOnServer(search: CompaniesSearch) {
	const [{ Effect }, { makeBatudaApiServer }, cookie] = await Promise.all([
		import('effect'),
		import('#/lib/batuda-api-server'),
		getServerCookieHeader(),
	])
	const program = Effect.gen(function* () {
		const client = yield* makeBatudaApiServer(cookie ?? undefined)
		// Asked for side by side, each allowed to come back empty-handed on its
		// own: the counts fill the filter menus and the list fills the page, so
		// losing one is no reason to give up the other, and asking in turn would
		// put the two waits end to end for nothing.
		return yield* Effect.all(
			{
				// Matches `companiesSearchAtom` exactly, counting included — the
				// browser picks this answer up by the shape of the question, so a
				// difference here means the page silently refetches and shows no
				// count meanwhile.
				companies: client.companies
					.list({
						query: {
							...search,
							limit: COMPANIES_PAGE_SIZE,
							count: 'exact' as const,
						},
					})
					.pipe(Effect.catchCause(() => Effect.succeed(undefined))),
				// Fetched with the page rather than after it: a menu that arrives
				// late repopulates under the reader's cursor, so a name they were
				// already reaching for moves and the press lands on its neighbour.
				facets: client.companies
					.facets({ query: facetsQuery(search) })
					.pipe(Effect.catchCause(() => Effect.succeed(undefined))),
			},
			{ concurrency: 2 },
		)
	})
	return await Effect.runPromise(program)
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
			const { companies, facets } = await loadCompaniesOnServer(search)
			// Whichever arrived is handed over. The other is left for the browser to
			// ask for again, rather than costing the page the half that did arrive.
			return {
				dehydrated: [
					...(companies === undefined
						? []
						: [
								dehydrateAtom(
									companiesSearchAtom(search, COMPANIES_FIRST_PAGE),
									AsyncResult.success(companies),
								),
							]),
					...(facets === undefined
						? []
						: [
								dehydrateAtom(
									companyFacetsAtom(search),
									AsyncResult.success(facets),
								),
							]),
				],
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

/** Strip `status` from the search when linking to the board — its columns are
 * the statuses, so a status filter there makes no sense. Everything else goes
 * across, including what needs attention: a heading on the dashboard opens a
 * narrowed list, and dropping a filter on the way would quietly widen it
 * again. */
function boardSearch(search: CompaniesSearch): CompaniesSearch {
	const { status: _status, ...rest } = search
	return rest
}

function CompaniesListPage() {
	const { i18n, t } = useLingui()
	const search = Route.useSearch()
	const navigate = useNavigate({ from: Route.fullPath })
	const { open: openQuickCapture } = useQuickCapture()
	const { members, meUserId } = useOrgMembers()

	// The list grows as the reader reaches the end of it; the filters identify
	// which list that is, so changing them starts over at the first page.
	const searchKey = canonicalSearchKey(search)
	const list = useInfiniteList({
		resetKey: `companies:${searchKey}`,
		pageSize: COMPANIES_PAGE_SIZE,
		count: 'exact',
		atomFor: page => companiesSearchAtom(search, page),
	})

	const companies = useMemo<ReadonlyArray<CompanyRow>>(
		() => narrowCompanies(list.items),
		[list.items],
	)
	const isLoading = list.isLoadingFirstPage
	const isFailure = list.isError
	const refreshCompanies = list.refresh
	// Until the list actually loads there is no count to show — a failed or
	// still-loading fetch must not read as "0 companies", an empty pipeline.
	const hasResult = !isLoading && !isFailure
	// How many companies match the filters in total, not just the ones fetched
	// so far: `companies` stops at the window loaded, so its length would
	// under-report for any org with more than one page of them.
	const total = list.total

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
	// Ticking a value works off the search the router is about to hand back, not
	// the one this render captured: two ticks land inside one navigation window
	// often enough — that is what the popover is for — and building both on the
	// same captured list would let the second quietly undo the first.
	const toggleValue = useCallback(
		(
			key: 'status' | 'tags' | 'fitVerdict' | 'country' | 'owner',
			value: string,
		) => {
			void navigate({
				to: '/companies',
				search: prev => {
					const chosen = prev[key] ?? []
					const next = chosen.includes(value)
						? chosen.filter(other => other !== value)
						: [...chosen, value]
					return mergeSearch(prev, {
						[key]: next.length === 0 ? undefined : next,
					})
				},
			})
		},
		[navigate],
	)
	// Stages are alternatives, so picking a second widens rather than narrows:
	// "everything mid-conversation" is one question, asked of one control.
	const chosenStatuses = search.status ?? []
	const toggleStatus = useCallback(
		(status: CompanyStatus) => {
			toggleValue('status', status)
		},
		[toggleValue],
	)
	const clearStatus = useCallback(() => {
		applyPatch({ status: undefined })
	}, [applyPatch])
	const toast = usePriToast()
	const restoreCompany = useAtomSet(restoreCompanyAtom, { mode: 'promiseExit' })
	// The menus are counted from the same companies the list holds, so putting
	// one back has to re-ask for them: otherwise its country stays on offer in
	// the bin it just left.
	const refreshFilterOptions = useAtomRefresh(companyFacetsAtom(search))
	const [restoringId, setRestoringId] = useState<string | null>(null)
	const handleRestore = useCallback(
		async (id: string, name: string) => {
			setRestoringId(id)
			const exit = await restoreCompany({ params: { id } } as never)
			setRestoringId(null)
			if (exit._tag === 'Success') {
				toast.add({ title: t`${name} is back`, type: 'success' })
				list.refresh()
				refreshFilterOptions()
				return
			}
			// The usual reason is that the name was taken while it was away, and
			// that is the caller's to sort out, so it is said rather than swallowed.
			toast.add({
				title: t`Could not restore ${name}`,
				description: t`Another company may be using its name now.`,
				type: 'error',
			})
		},
		[restoreCompany, toast, t, list, refreshFilterOptions],
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

	// Counted against the filters already set, and asked for in the same words as
	// the list itself: a menu offers a narrowing that finds something, plus
	// whatever is already chosen so it can be taken off again.
	const { countries, industries, tags, fitVerdicts, industryValue } =
		useCompanyFilterOptions(search)

	const activeFilters = hasActiveFilters(search)
	// Both counts have a singular form: narrowing down to a single match is
	// ordinary, and "1 companies" reads as a bug.
	const countLabel = activeFilters
		? total === 1
			? t`1 company with filters applied`
			: t`${total} companies with filters applied`
		: total === 1
			? t`1 company`
			: t`${total} companies`

	const countryOptions = countries
	// Filtered by the web-address form, which is what the row carries and what a
	// shared link keeps working with; the name is what the reader picks from.
	const industryItems = [
		{ value: ALL, label: t`All industries` },
		...industries.map(i => ({ value: i.value, label: i.label })),
	]
	const priorityItems = [
		{ value: ALL, label: t`Any priority` },
		...PRIORITY_LEVELS.map(p => ({
			value: String(p),
			label: i18n._(priorityShortLabels[p]),
		})),
	]
	// No counts: the colleagues come from the organisation's own list, not from a
	// tally of the companies, so there is no number to put beside a name.
	const ownerOptions = [
		...(meUserId ? [{ value: meUserId, label: t`My leads` }] : []),
		{ value: 'none', label: t`Unassigned` },
		...members
			.filter(m => m.userId !== meUserId)
			.map(m => ({ value: m.userId, label: m.name })),
	]
	// Read off the orders the server actually holds, so a new one cannot be
	// offered here and quietly ignored there — nor added there and missed here,
	// since a word without a label below fails to compile.
	// Each one names the order rather than the field, because the trigger shows
	// only the value it is set to: a bare "Priority" would sit beside the priority
	// filter's own "Any priority" and the two would read as the same control.
	const sortLabels: Record<CompanySort, string> = {
		priority: t`By priority`,
		name: t`By name`,
		recent_contact: t`By last contact`,
		recent_update: t`By last update`,
	}
	const sortItems = COMPANY_SORTS.map(value => ({
		value,
		label: sortLabels[value],
	}))
	// The threshold rides in the label rather than getting a control of its own:
	// it only qualifies "gone quiet" and means nothing beside it, but it changes
	// what the words are worth, so a reader arriving from a heading counted at
	// sixty days should not read them as the usual fortnight.
	const attentionLabels: Record<AttentionFilter, string> = {
		overdue: t`Overdue`,
		stale:
			search.staleDays === undefined
				? t`Gone quiet`
				: t`Gone quiet · ${search.staleDays}+ days`,
		'no-next-action': t`Nothing planned`,
	}
	const attentionItems = [
		{ value: ALL, label: t`Anything` },
		...ATTENTION_FILTERS.map(value => ({
			value,
			label: attentionLabels[value],
		})),
	]

	return (
		<Page>
			<CompaniesHeader
				view='list'
				title={t`Companies`}
				listHref='/companies'
				boardHref={boardHref(boardSearch(search))}
				{...(hasResult && total !== undefined ? { subtitle: countLabel } : {})}
			/>

			{/* Every control in the bar below changes the list without the keyboard
			 * moving anywhere, so anyone not looking at the screen gets no sign of
			 * it — including when a control quietly lifts another filter, as the
			 * bin and what-needs-doing do to each other. This line sits outside the
			 * block that swaps, because a spoken message that disappears with the
			 * list it describes is often never read out. */}
			<SrOnly
				role='status'
				aria-live='polite'
				data-testid='companies-count-announcement'
			>
				{hasResult && total !== undefined ? countLabel : ''}
			</SrOnly>

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
						data-testid='companies-search'
					/>
				</SearchWrap>

				<StatusFilters role='group' aria-label={t`Filter by status`}>
					<StatusFilterButton
						type='button'
						$active={chosenStatuses.length === 0}
						onClick={clearStatus}
						// It is the one chip that lights up while carrying no state a
						// listener can hear, so the strip reads as eight toggles and one
						// plain button with no way to tell which is on. And "All" alone
						// says nothing about what it is all of.
						aria-pressed={chosenStatuses.length === 0}
						aria-label={t`All stages`}
						data-testid='companies-status-all'
					>
						{t`All`}
					</StatusFilterButton>
					{STATUS_ORDER.map(status => (
						<StatusFilterButton
							key={status}
							type='button'
							$active={chosenStatuses.includes(status)}
							onClick={() => toggleStatus(status)}
							aria-pressed={chosenStatuses.includes(status)}
							data-testid={`companies-status-${status}`}
						>
							<StatusBadge status={status} />
						</StatusFilterButton>
					))}
					{/* Separate from the stages on purpose: a deleted company has a
					    stage too, so this is a different question about the same list. */}
					<StatusFilterButton
						type='button'
						$active={search.deleted === 'only'}
						onClick={() =>
							applyPatch({
								deleted: search.deleted === 'only' ? undefined : 'only',
								// A stage filter would narrow the deleted ones by a stage
								// nobody is working, which reads as "none of them".
								status: undefined,
								// What needs doing is worse: a deleted company is on none of
								// those lists by definition, so the two together find nothing
								// at all, every time, with nothing on screen to say why.
								attention: undefined,
							})
						}
						aria-pressed={search.deleted === 'only'}
						data-testid='companies-filter-deleted'
					>
						{t`Deleted`}
					</StatusFilterButton>
				</StatusFilters>

				<SavedViews
					current={search}
					onApply={next => {
						setSearchInput(next.query ?? '')
						void navigate({ to: '/companies', search: next })
					}}
				/>

				<DropdownRow>
					<MultiSelectFilter
						label={t`Country`}
						options={countryOptions}
						selected={search.country ?? []}
						onToggle={value => toggleValue('country', value)}
						onClear={() => applyPatch({ country: undefined })}
						describeCount={count => t`${count} companies`}
						testId='companies-filter-country'
					/>
					<FilterSelect
						label={t`Industry`}
						value={industryValue ?? ALL}
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
					<MultiSelectFilter
						label={t`Owner`}
						options={ownerOptions}
						selected={search.owner ?? []}
						onToggle={value => toggleValue('owner', value)}
						onClear={() => applyPatch({ owner: undefined })}
						describeCount={count => t`${count} companies`}
						testId='companies-filter-owner'
					/>
					<FilterSelect
						label={t`Attention`}
						value={search.attention ?? ALL}
						options={attentionItems}
						onChange={v =>
							applyPatch({
								attention: v === ALL ? undefined : (v as AttentionFilter),
								// The threshold only qualifies "gone quiet"; left behind on
								// any other choice it would sit in the link meaning nothing.
								...(v === 'stale' ? {} : { staleDays: undefined }),
								// Nothing on these lists is deleted, so asking for both finds
								// nothing — put the bin down rather than empty the list.
								...(v === ALL ? {} : { deleted: undefined }),
							})
						}
						testId='companies-filter-attention'
					/>
					<MultiSelectFilter
						label={t`Tags`}
						options={tags}
						selected={search.tags ?? []}
						onToggle={value => toggleValue('tags', value)}
						onClear={() => applyPatch({ tags: undefined })}
						describeCount={count => t`${count} companies`}
						testId='companies-filter-tags'
					/>
					<MultiSelectFilter
						label={t`Fit`}
						options={fitVerdicts}
						selected={search.fitVerdict ?? []}
						onToggle={value => toggleValue('fitVerdict', value)}
						onClear={() => applyPatch({ fitVerdict: undefined })}
						describeCount={count => t`${count} companies`}
						testId='companies-filter-fit'
						countsStandAlone
					/>
					<FilterSelect
						label={t`Sort`}
						value={search.sort ?? 'priority'}
						options={sortItems}
						onChange={v => applyPatch({ sort: v as CompanySort })}
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
				<ErrorState
					data-testid='companies-error'
					title={t`Could not load companies`}
					description={t`The list could not be fetched. Check that the session is valid, then try again.`}
					onRetry={refreshCompanies}
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
					{search.deleted === 'only' ? (
						// Deliberately not the usual card: a deleted company's page is
						// closed, so a card linking to it would be a dead end. What is
						// useful here is its name and a way back.
						<DeletedList role='list'>
							{companies.map(company => (
								<DeletedRow
									key={company.id}
									role='listitem'
									data-testid='company-deleted-row'
								>
									<DeletedName>{company.name}</DeletedName>
									<PriButton
										type='button'
										$variant='text'
										// Every one of these says "Restore", so without the name
										// a screen reader listing the buttons reads the same word
										// over and over with nothing to tell them apart.
										aria-label={t`Restore ${company.name}`}
										disabled={restoringId === company.id}
										focusableWhenDisabled
										aria-busy={restoringId === company.id}
										onClick={() => void handleRestore(company.id, company.name)}
										data-testid={`company-restore-${company.slug}`}
									>
										{restoringId === company.id ? (
											<Trans>Restoring…</Trans>
										) : (
											<Trans>Restore</Trans>
										)}
									</PriButton>
								</DeletedRow>
							))}
						</DeletedList>
					) : (
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
											country: company.country,
											priority: company.priority,
											ownerId: company.ownerId,
											lastContactedAt: company.lastContactedAt,
										}}
										actions={{
											onLogInteraction: () => handleLogInteraction(company),
											// Changing the owner is the company's own decision to
											// make, so the card sends the reader there rather than
											// growing a picker of its own.
											onAssign: () =>
												void navigate({
													to: '/companies/$slug',
													params: { slug: company.slug },
												}),
										}}
									/>
								))}
							</Grid>
						</LayoutGroup>
					)}
					<InfiniteListFooter list={list} testId='companies' />
				</>
			)}
		</Page>
	)
}

/** Build the /companies/board URL, carrying the shared filters as query params. */
function boardHref(search: CompaniesSearch): string {
	return `/companies/board${companiesSearchToQuery(search)}`
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
			<PriSelect.Options
				items={options}
				sideOffset={6}
				optionTestId={v => `${testId}-option-${v}`}
			/>
		</PriSelect.Root>
	)
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Produce the next `CompaniesSearch` from a partial patch while keeping the
 * result strict: any value in `next` that is undefined, blank, or an empty list
 * is *dropped* from the result instead of set to undefined. That is the only way
 * to clear a search param under `exactOptionalPropertyTypes` — assigning
 * `undefined` to an optional field is a TS error.
 *
 * Written once over whatever the search holds, rather than a block per field: a
 * block per field has to be extended for every new filter, and a filter that is
 * missed simply never clears.
 */
function mergeSearch(
	prev: CompaniesSearch,
	next: Partial<{
		[K in keyof CompaniesSearch]: CompaniesSearch[K] | undefined
	}>,
): CompaniesSearch {
	const merged: Record<string, unknown> = { ...prev, ...next }
	const result: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(merged)) {
		if (value === undefined || value === null || value === '') continue
		if (Array.isArray(value)) {
			const values = (value as ReadonlyArray<string>).filter(v => v !== '')
			if (values.length === 0) continue
			result[key] = values
			continue
		}
		result[key] = value
	}
	return result as CompaniesSearch
}

// The two the search holds that do not narrow it: the order to read it in, and
// how long counts as quiet, which only qualifies the attention filter and means
// nothing on its own.
const NON_NARROWING_KEYS = new Set(['sort', 'staleDays'])

/**
 * Whether anything is narrowing the list.
 *
 * Asking the object rather than naming the filters is what stops a new filter
 * from narrowing the list with nothing on screen offering to clear it.
 */
function hasActiveFilters(search: CompaniesSearch): boolean {
	return Object.entries(search).some(([key, value]) => {
		if (NON_NARROWING_KEYS.has(key)) return false
		if (value === undefined || value === null || value === '') return false
		if (Array.isArray(value)) return value.length > 0
		return true
	})
}

// Typed date fields decode to DateTime.Utc on the wire; fall back to their
// string form for anything already an ISO string.
function dateToIsoOrNull(value: unknown): string | null {
	if (typeof value === 'string') return value
	if (DateTime.isDateTime(value)) return DateTime.formatIso(value)
	return null
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
			country: typeof r['country'] === 'string' ? r['country'] : null,
			priority: typeof r['priority'] === 'number' ? r['priority'] : null,
			lastContactedAt: dateToIsoOrNull(r['lastContactedAt']),
			ownerId: typeof r['ownerId'] === 'string' ? r['ownerId'] : null,
		})
	}
	return out
}

// ── Styles ───────────────────────────────────────────────────────

const Page = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);

	/* Cap the reading column and centre it so the header, filters, and card
	 * grid don't stretch edge-to-edge on wide monitors — matching the
	 * research list convention. */
	width: 100%;
	max-width: 64rem;
	margin-inline: auto;

	/* Measure children against this element's own width, not the window's.
	 * The card list keys its column count off the space it actually has —
	 * the capped column here, narrowed further by the fixed side rail —
	 * instead of the raw viewport. */
	container-type: inline-size;
`

const Filters = styled.div`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	/* Padding and gaps shrink with the sheet rather than at a width picked in
	 * advance: on a phone this block used to stand between the reader and the
	 * first company for most of a screen. */
	gap: clamp(var(--space-2xs), 1.5vw, var(--space-sm));
	padding: clamp(var(--space-2xs), 2vw, var(--space-md));
	border-radius: var(--shape-2xs);
`

const SearchWrap = styled.div`
	position: relative;
	display: flex;
	align-items: center;
`

const SearchIcon = styled.span`
	position: absolute;
	left: var(--space-sm);
	display: inline-flex;
	color: var(--color-on-surface-variant);
	pointer-events: none;
	z-index: 2;
`

const StatusFilters = styled.div`
	/* Nine stages on one line that slides, rather than wrapping onto four rows.
	 * Wrapped, they were most of what stood between a phone and the first
	 * company; sliding, they cost one row at every width. The faded ends say
	 * there is more either side, the same as the tab strip. */
	display: flex;
	flex-wrap: nowrap;
	overflow-x: auto;
	overflow-y: hidden;
	gap: var(--space-2xs);
	padding-bottom: var(--space-3xs);
	scrollbar-width: none;
	scroll-snap-type: x proximity;
	mask-image: linear-gradient(
		to right,
		transparent 0,
		black 1rem,
		black calc(100% - 1rem),
		transparent 100%
	);

	&::-webkit-scrollbar {
		display: none;
	}

	> * {
		flex: 0 0 auto;
		scroll-snap-align: start;
	}
`

const StatusFilterButton = styled.button<{ $active: boolean }>`
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
		css`
			text-shadow: var(--text-shadow-engrave);
			box-shadow:
				inset 0 1px 3px var(--shadow-color-deep),
				0 1px 0 var(--highlight-inset-soft);
		`}

	&:hover:not(:disabled) {
		border-color: var(--color-primary);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const Grid = styled(motion.div)`
	display: grid;
	/* minmax(0, …) not a bare 1fr: a plain 1fr track keeps its default
	 * auto minimum, which is the card's min-content width (the status
	 * badge + last-contact row can't shrink). On a narrow phone that
	 * min-content is wider than the column, so the track grows past the
	 * sheet and the whole list scrolls sideways. Flooring the track at 0
	 * lets the card shrink and its own text ellipsis take over instead. */
	grid-template-columns: minmax(0, 1fr);
	gap: var(--space-md);

	/* Two columns once the list's own width — not the window's — has room
	 * for them; a single card fills a desktop sheet comfortably at two, so
	 * the list tops out there rather than cramming a third. */
	@container (min-width: 40rem) {
		grid-template-columns: repeat(2, minmax(0, 1fr));
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

const DropdownRow = styled.div`
	display: flex;
	flex-wrap: wrap;
	/* Stretch, not centre: one control carries a longer label than the rest —
	 * "Gone quiet · 30+ days" — and on a narrow row it takes two lines. Centred,
	 * it would stand taller than its neighbours and the row would read as broken;
	 * stretched, every control on a line is the same height whatever its label
	 * does. */
	align-items: stretch;
	gap: var(--space-2xs);

	/* Each dropdown takes a share of the line and stops shrinking once it is
	 * still readable, so five sit on one line on a monitor and two or three per
	 * line on a phone — continuously, with no width to cross. Aimed at the
	 * buttons rather than at every child: each dropdown also plants a hidden
	 * input beside its trigger, and a grid would have given those a column. */
	> button {
		flex: 1 1 8rem;
		min-width: 0;
	}
`

// A deleted company shows as a line rather than a card: there is no page to
// open behind it, so the only thing worth offering is putting it back.
const DeletedList = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const DeletedRow = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	padding: var(--space-sm) var(--space-md);
	border: 1px solid var(--color-outline-variant);
	border-radius: var(--radius-md);
	background: var(--color-surface-container-low);
`

const DeletedName = styled.span`
	font: var(--type-body-medium);
	color: var(--color-on-surface-variant);
`
