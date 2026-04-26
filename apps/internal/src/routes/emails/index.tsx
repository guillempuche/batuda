import {
	RegistryContext,
	useAtomRefresh,
	useAtomSet,
	useAtomValue,
} from '@effect/atom-react'
import { useLingui } from '@lingui/react/macro'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
	type ColumnDef,
	type ColumnSizingState,
	flexRender,
	getCoreRowModel,
	getSortedRowModel,
	type SortingState,
	type Table as TanstackTable,
	useReactTable,
	type VisibilityState,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Schema } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import {
	AlertTriangle,
	Archive,
	ArchiveRestore,
	ArrowDownLeft,
	ArrowUpRight,
	Check,
	CheckCheck,
	ChevronLeft,
	ChevronRight,
	Columns,
	Eye,
	EyeOff,
	Inbox as InboxIcon,
	Mail,
	Pencil,
	PencilLine,
	Search,
	X,
} from 'lucide-react'
import {
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react'
import styled, { css } from 'styled-components'

import {
	PriButton,
	PriCheckbox,
	PriInput,
	PriPopover,
	PriSelect,
	usePriToast,
} from '@batuda/ui/pri'

import {
	canonicalKey,
	EMAILS_PAGE_SIZE,
	type EmailsSearch,
	emailsSearchAtom,
	inboxesListAtom,
	markThreadReadAtom,
	markThreadUnreadAtom,
	threadAtomFor,
	updateThreadStatusAtom,
} from '#/atoms/emails-atoms'
import { companiesListAtom } from '#/atoms/pipeline-atoms'
import { PriTable } from '#/components/primitives/pri-table'
import { EmptyState } from '#/components/shared/empty-state'
import { RelativeDate } from '#/components/shared/relative-date'
import { SkeletonRows } from '#/components/shared/skeleton-row'
import { useComposeEmail } from '#/context/compose-email-context'
import { dehydrateAtom } from '#/lib/atom-hydration'
import { validateSearchWith } from '#/lib/search-schema'
import { getServerCookieHeader } from '#/lib/server-cookie'
import {
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

type ThreadStatus = 'open' | 'closed' | 'archived'
type Direction = 'inbound' | 'outbound'
type InboundClassification = 'normal' | 'spam' | 'blocked'

type ThreadInbox = {
	readonly email: string
	readonly displayName: string | null
	readonly purpose: 'human' | 'agent' | 'shared'
}

type ThreadRow = {
	readonly id: string
	readonly providerThreadId: string
	readonly subject: string | null
	readonly status: ThreadStatus
	readonly companyId: string | null
	readonly messageCount: number
	readonly lastMessageAt: string | null
	readonly lastMessageDirection: Direction | null
	readonly lastInboundClassification: InboundClassification | null
	readonly isUnread: boolean
	readonly hasDraft: boolean
	readonly updatedAt: string
	readonly inbox: ThreadInbox | null
}

type InboxOption = {
	readonly id: string
	readonly email: string
	readonly displayName: string | null
	readonly purpose: 'human' | 'agent' | 'shared'
}

type ListEnvelope = {
	readonly items: ReadonlyArray<unknown>
	readonly total: number
	readonly limit: number
	readonly offset: number
}

type CompanyLookup = {
	readonly slug: string
	readonly name: string
}

/** Debounce window for the search input before we push to the URL. */
const SEARCH_DEBOUNCE_MS = 300

/**
 * TanStack Router `validateSearch` — runs on every search-param change
 * and produces a canonical `EmailsSearch` plus the `page` URL param.
 * Empty strings and invalid values are dropped entirely so the URL stays
 * clean. `page` accepts either a number or a numeric string (raw URL)
 * and is filtered to positive finite values.
 */
const validateSearch = validateSearchWith({
	inboxId: Schema.NonEmptyString,
	companyId: Schema.NonEmptyString,
	status: Schema.Literals(['open', 'closed', 'archived'] as const),
	purpose: Schema.Literals(['human', 'agent', 'shared'] as const),
	query: Schema.NonEmptyString,
	page: Schema.Union([Schema.Number, Schema.NumberFromString]).pipe(
		Schema.refine((n): n is number => Number.isFinite(n) && n >= 1),
	),
})

/** Convert URL search (with `page`) to the wire-level `EmailsSearch`. */
function toWireSearch(
	search: EmailsSearch & { readonly page?: number },
): EmailsSearch {
	const page = search.page ?? 1
	const offset = (page - 1) * EMAILS_PAGE_SIZE
	const wire: {
		inboxId?: string
		companyId?: string
		status?: 'open' | 'closed' | 'archived'
		purpose?: 'human' | 'agent' | 'shared'
		query?: string
		limit?: number
		offset?: number
	} = { limit: EMAILS_PAGE_SIZE }
	if (offset > 0) wire.offset = offset
	if (search.inboxId !== undefined) wire.inboxId = search.inboxId
	if (search.companyId !== undefined) wire.companyId = search.companyId
	if (search.status !== undefined) wire.status = search.status
	if (search.purpose !== undefined) wire.purpose = search.purpose
	if (search.query !== undefined) wire.query = search.query
	return wire
}

async function loadThreadsOnServer(wire: EmailsSearch): Promise<{
	envelope: ListEnvelope
	inboxes: ReadonlyArray<unknown>
}> {
	const [{ Effect }, { makeBatudaApiServer }, cookie] = await Promise.all([
		import('effect'),
		import('#/lib/batuda-api-server'),
		getServerCookieHeader(),
	])
	const queryForServer: Record<string, string | number> = {}
	if (wire.inboxId !== undefined) queryForServer['inboxId'] = wire.inboxId
	if (wire.companyId !== undefined) queryForServer['companyId'] = wire.companyId
	if (wire.status !== undefined) queryForServer['status'] = wire.status
	if (wire.purpose !== undefined) queryForServer['purpose'] = wire.purpose
	if (wire.query !== undefined) queryForServer['query'] = wire.query
	if (wire.limit !== undefined) queryForServer['limit'] = wire.limit
	if (wire.offset !== undefined) queryForServer['offset'] = wire.offset
	const program = Effect.gen(function* () {
		const client = yield* makeBatudaApiServer(cookie ?? undefined)
		const [envelope, inboxes] = yield* Effect.all(
			[
				client.email.listThreads({ query: queryForServer }),
				client.email.listInboxes({ query: {} }),
			],
			{ concurrency: 2 },
		)
		return { envelope, inboxes }
	})
	return Effect.runPromise(program)
}

export const Route = createFileRoute('/emails/')({
	validateSearch,
	loaderDeps: ({ search }) => ({ search }),
	loader: async ({ deps: { search } }) => {
		if (!import.meta.env.SSR) {
			return { dehydrated: [] as const }
		}
		try {
			const wire = toWireSearch(search)
			const { envelope, inboxes } = await loadThreadsOnServer(wire)
			return {
				dehydrated: [
					dehydrateAtom(emailsSearchAtom(wire), AsyncResult.success(envelope)),
					dehydrateAtom(inboxesListAtom, AsyncResult.success(inboxes)),
				] as const,
			}
		} catch (error) {
			console.warn('[EmailsLoader] falling back to empty hydration:', error)
			return { dehydrated: [] as const }
		}
	},
	component: EmailsIndexPage,
})

const STATUS_OPTIONS: ReadonlyArray<{
	readonly value: ThreadStatus | 'all'
	readonly labelKey:
		| 'filterAll'
		| 'filterOpen'
		| 'filterClosed'
		| 'filterArchived'
}> = [
	{ value: 'all', labelKey: 'filterAll' },
	{ value: 'open', labelKey: 'filterOpen' },
	{ value: 'closed', labelKey: 'filterClosed' },
	{ value: 'archived', labelKey: 'filterArchived' },
]

function EmailsIndexPage() {
	const { t } = useLingui()
	const search = Route.useSearch()
	const navigate = useNavigate({ from: Route.fullPath })
	const { openCompose, drafts } = useComposeEmail()
	const wire = useMemo(() => toWireSearch(search), [search])

	// Atom identity is keyed by the canonical wire-shape key, not by the
	// raw URL search object — so we memo on the key to avoid re-subscribing
	// just because TanStack Router re-created the search on every render.
	const wireKey = canonicalKey(wire)
	const atom = useMemo(() => emailsSearchAtom(wire), [wireKey])
	const result = useAtomValue(atom)
	const refreshList = useAtomRefresh(atom)

	const inboxesResult = useAtomValue(inboxesListAtom)
	const companiesResult = useAtomValue(companiesListAtom)

	const updateStatus = useAtomSet(updateThreadStatusAtom, {
		mode: 'promiseExit',
	})
	const markRead = useAtomSet(markThreadReadAtom, { mode: 'promiseExit' })
	const markUnread = useAtomSet(markThreadUnreadAtom, {
		mode: 'promiseExit',
	})
	const registry = useContext(RegistryContext)
	const toastManager = usePriToast()

	type Overlay = {
		readonly status?: ThreadStatus
		readonly isUnread?: boolean
	}
	const [overlays, setOverlays] = useState<ReadonlyMap<string, Overlay>>(
		new Map(),
	)

	const envelope = useMemo<ListEnvelope | null>(
		() => (AsyncResult.isSuccess(result) ? narrowEnvelope(result.value) : null),
		[result],
	)
	const threadIdsWithDraft = useMemo<ReadonlySet<string>>(() => {
		const set = new Set<string>()
		for (const d of drafts) {
			if (d.threadId !== undefined && d.threadId !== '') set.add(d.threadId)
		}
		return set
	}, [drafts])
	const threads = useMemo<ReadonlyArray<ThreadRow>>(() => {
		const rows = envelope !== null ? narrowThreads(envelope.items) : []
		if (overlays.size === 0 && threadIdsWithDraft.size === 0) return rows
		return rows.map(row => {
			const patch = overlays.get(row.id)
			const hasDraft = threadIdsWithDraft.has(row.id)
			if (patch === undefined && !hasDraft) return row
			return {
				...row,
				...(patch?.status !== undefined && { status: patch.status }),
				...(patch?.isUnread !== undefined && { isUnread: patch.isUnread }),
				...(hasDraft && { hasDraft: true }),
			}
		})
	}, [envelope, overlays, threadIdsWithDraft])
	const total = envelope?.total ?? 0
	const isLoading = AsyncResult.isInitial(result)
	const isFailure = AsyncResult.isFailure(result)

	const inboxOptions = useMemo<ReadonlyArray<InboxOption>>(
		() =>
			AsyncResult.isSuccess(inboxesResult)
				? narrowInboxes(inboxesResult.value)
				: [],
		[inboxesResult],
	)
	const companiesById = useMemo<Map<string, CompanyLookup>>(() => {
		if (!AsyncResult.isSuccess(companiesResult)) return new Map()
		const map = new Map<string, CompanyLookup>()
		for (const row of companiesResult.value as ReadonlyArray<unknown>) {
			if (!row || typeof row !== 'object') continue
			const r = row as Record<string, unknown>
			if (
				typeof r['id'] === 'string' &&
				typeof r['slug'] === 'string' &&
				typeof r['name'] === 'string'
			) {
				map.set(r['id'], { slug: r['slug'], name: r['name'] })
			}
		}
		return map
	}, [companiesResult])

	// ── Search input (debounced URL write) ─────────────────────
	const [searchInput, setSearchInput] = useState(search.query ?? '')
	useEffect(() => {
		setSearchInput(search.query ?? '')
	}, [search.query])
	// Push the debounced input to the URL. Guard against the URL-sync
	// effect above to avoid a loop. Uses `replace: true` so a typing
	// session collapses into one history entry — back escapes the whole
	// search, not one keystroke. Status pills, inbox select, pagination,
	// and Clear all still push (deliberate filter choices).
	useEffect(() => {
		const current = search.query ?? ''
		if (searchInput === current) return
		const timer = window.setTimeout(() => {
			void navigate({
				to: '/emails',
				search: prev =>
					mergeSearch(prev, {
						query: searchInput === '' ? undefined : searchInput,
						page: undefined,
					}),
				replace: true,
			})
		}, SEARCH_DEBOUNCE_MS)
		return () => {
			window.clearTimeout(timer)
		}
	}, [searchInput, search.query, navigate])

	// ── Filter handlers ────────────────────────────────────────
	const handleStatusFilter = useCallback(
		(status: ThreadStatus | undefined) => {
			void navigate({
				to: '/emails',
				search: prev => mergeSearch(prev, { status, page: undefined }),
			})
		},
		[navigate],
	)
	const handleInboxFilter = useCallback(
		(inboxId: string | undefined) => {
			void navigate({
				to: '/emails',
				search: prev => mergeSearch(prev, { inboxId, page: undefined }),
			})
		},
		[navigate],
	)
	const handlePage = useCallback(
		(page: number) => {
			void navigate({
				to: '/emails',
				search: prev =>
					mergeSearch(prev, { page: page <= 1 ? undefined : page }),
			})
		},
		[navigate],
	)
	const handleClearFilters = useCallback(() => {
		setSearchInput('')
		void navigate({ to: '/emails', search: {} })
	}, [navigate])

	// ── Selection state ────────────────────────────────────────
	const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
	// Selection is per-page: drop any selected ids that aren't in the
	// current page so a navigation doesn't leave dangling bulk targets.
	useEffect(() => {
		const visible = new Set(threads.map(t => t.id))
		setSelected(prev => {
			let changed = false
			const next = new Set<string>()
			for (const id of prev) {
				if (visible.has(id)) next.add(id)
				else changed = true
			}
			return changed ? next : prev
		})
	}, [threads])

	const toggleSelect = useCallback((id: string) => {
		setSelected(prev => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}, [])
	const selectAll = useCallback(() => {
		setSelected(new Set(threads.map(t => t.id)))
	}, [threads])
	const clearSelection = useCallback(() => {
		setSelected(new Set())
	}, [])

	// ── Mutations with optimistic overlays ─────────────────────
	const mergeOverlay = useCallback(
		(ids: ReadonlyArray<string>, patch: Overlay) => {
			setOverlays(prev => {
				const next = new Map(prev)
				for (const id of ids) {
					next.set(id, { ...(next.get(id) ?? {}), ...patch })
				}
				return next
			})
		},
		[],
	)
	const clearOverlay = useCallback((ids: ReadonlyArray<string>) => {
		setOverlays(prev => {
			if (prev.size === 0) return prev
			const next = new Map(prev)
			for (const id of ids) next.delete(id)
			return next
		})
	}, [])

	const applyStatus = useCallback(
		async (ids: ReadonlyArray<string>, status: ThreadStatus) => {
			mergeOverlay(ids, { status })
			const exits = await Promise.all(
				ids.map(id =>
					updateStatus({
						params: { threadId: id },
						payload: { status },
					}),
				),
			)
			const failedIds = ids.filter((_, i) => exits[i]?._tag !== 'Success')
			clearOverlay(ids)
			if (failedIds.length > 0) {
				toastManager.add({
					title: t`Status update failed`,
					description: t`${failedIds.length} thread could not be updated.`,
					type: 'error',
				})
			}
			refreshList()
			for (const id of ids) registry.refresh(threadAtomFor(id))
		},
		[
			updateStatus,
			refreshList,
			registry,
			toastManager,
			mergeOverlay,
			clearOverlay,
			t,
		],
	)
	const applyRead = useCallback(
		async (ids: ReadonlyArray<string>, read: boolean) => {
			mergeOverlay(ids, { isUnread: !read })
			const exits = await Promise.all(
				ids.map(id =>
					read
						? markRead({ params: { threadId: id } })
						: markUnread({ params: { threadId: id } }),
				),
			)
			const failedIds = ids.filter((_, i) => exits[i]?._tag !== 'Success')
			clearOverlay(ids)
			if (failedIds.length > 0) {
				toastManager.add({
					title: t`Read state update failed`,
					description: t`${failedIds.length} thread could not be updated.`,
					type: 'error',
				})
			}
			refreshList()
			for (const id of ids) registry.refresh(threadAtomFor(id))
		},
		[
			markRead,
			markUnread,
			refreshList,
			registry,
			toastManager,
			mergeOverlay,
			clearOverlay,
			t,
		],
	)

	// ── Pagination math ────────────────────────────────────────
	const page = search.page ?? 1
	const firstRow = total === 0 ? 0 : (page - 1) * EMAILS_PAGE_SIZE + 1
	const lastRow = Math.min(page * EMAILS_PAGE_SIZE, total)
	const totalPages = Math.max(1, Math.ceil(total / EMAILS_PAGE_SIZE))
	const activeFilters = hasActiveFilters(search)

	const selectedCount = selected.size
	const allSelected = threads.length > 0 && selectedCount === threads.length

	return (
		<Page>
			<Intro>
				<IntroText>
					<Title>{t`Emails`}</Title>
					<Subtitle>{total === 1 ? t`1 thread` : t`${total} threads`}</Subtitle>
				</IntroText>
				<IntroActions>
					<PriButton
						type='button'
						$variant='outlined'
						data-testid='emails-manage-inboxes'
						onClick={() => {
							void navigate({ to: '/emails/inboxes' })
						}}
					>
						<InboxIcon size={14} aria-hidden />
						<span>{t`Manage inboxes`}</span>
					</PriButton>
					<PriButton
						type='button'
						$variant='filled'
						data-testid='emails-compose'
						onClick={() => {
							openCompose({ mode: 'new' })
						}}
					>
						<Pencil size={14} aria-hidden />
						<span>{t`Compose`}</span>
					</PriButton>
				</IntroActions>
			</Intro>

			<Filters role='group' aria-label={t`Filter emails`}>
				<SearchWrap>
					<SearchIcon>
						<Search size={16} aria-hidden />
					</SearchIcon>
					<PriInput
						type='search'
						data-testid='emails-search'
						placeholder={t`Search by subject…`}
						value={searchInput}
						onChange={event => setSearchInput(event.target.value)}
						aria-label={t`Search threads`}
						style={{ paddingLeft: 'calc(var(--space-sm) * 2 + 16px)' }}
					/>
				</SearchWrap>

				<StatusFilters role='group' aria-label={t`Filter by status`}>
					{STATUS_OPTIONS.map(opt => {
						const current = search.status ?? 'all'
						const active = current === opt.value
						const label =
							opt.labelKey === 'filterAll'
								? t`All`
								: opt.labelKey === 'filterOpen'
									? t`Open`
									: opt.labelKey === 'filterClosed'
										? t`Closed`
										: t`Archived`
						return (
							<StatusFilterButton
								key={opt.value}
								type='button'
								$active={active}
								aria-pressed={active}
								data-testid={`emails-status-${opt.value}`}
								onClick={() =>
									handleStatusFilter(
										opt.value === 'all' ? undefined : opt.value,
									)
								}
							>
								{label}
							</StatusFilterButton>
						)
					})}
				</StatusFilters>

				{inboxOptions.length > 0 && (
					<InboxSelectWrap>
						<PriSelect.Root
							value={search.inboxId ?? '__all__'}
							onValueChange={value =>
								handleInboxFilter(
									value === '__all__' ? undefined : String(value),
								)
							}
						>
							<PriSelect.Trigger aria-label={t`Filter by inbox`}>
								<PriSelect.Value placeholder={t`All inboxes`} />
								<PriSelect.Icon>
									<ChevronRight size={14} aria-hidden />
								</PriSelect.Icon>
							</PriSelect.Trigger>
							<PriSelect.Portal>
								<PriSelect.Positioner>
									<PriSelect.Popup>
										<PriSelect.Item value='__all__'>
											<PriSelect.ItemIndicator>
												<Check size={12} aria-hidden />
											</PriSelect.ItemIndicator>
											<PriSelect.ItemText>{t`All inboxes`}</PriSelect.ItemText>
										</PriSelect.Item>
										{inboxOptions.map(inbox => (
											<PriSelect.Item key={inbox.id} value={inbox.id}>
												<PriSelect.ItemIndicator>
													<Check size={12} aria-hidden />
												</PriSelect.ItemIndicator>
												<PriSelect.ItemText>
													{inbox.displayName
														? `${inbox.displayName} <${inbox.email}>`
														: inbox.email}
												</PriSelect.ItemText>
											</PriSelect.Item>
										))}
									</PriSelect.Popup>
								</PriSelect.Positioner>
							</PriSelect.Portal>
						</PriSelect.Root>
					</InboxSelectWrap>
				)}

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

			{selectedCount > 0 && (
				<BulkToolbar role='toolbar' aria-label={t`Bulk thread actions`}>
					<BulkLabel aria-live='polite'>
						{selectedCount === 1
							? t`1 thread selected`
							: t`${selectedCount} threads selected`}
					</BulkLabel>
					<PriButton
						type='button'
						$variant='outlined'
						onClick={() => {
							void applyStatus(Array.from(selected), 'closed')
							clearSelection()
						}}
					>
						<CheckCheck size={14} aria-hidden />
						<span>{t`Close`}</span>
					</PriButton>
					<PriButton
						type='button'
						$variant='outlined'
						onClick={() => {
							void applyStatus(Array.from(selected), 'open')
							clearSelection()
						}}
					>
						<ArchiveRestore size={14} aria-hidden />
						<span>{t`Reopen`}</span>
					</PriButton>
					<PriButton
						type='button'
						$variant='outlined'
						onClick={() => {
							void applyStatus(Array.from(selected), 'archived')
							clearSelection()
						}}
					>
						<Archive size={14} aria-hidden />
						<span>{t`Archive`}</span>
					</PriButton>
					<PriButton
						type='button'
						$variant='outlined'
						onClick={() => {
							void applyRead(Array.from(selected), true)
							clearSelection()
						}}
					>
						<Eye size={14} aria-hidden />
						<span>{t`Mark read`}</span>
					</PriButton>
					<PriButton type='button' $variant='text' onClick={clearSelection}>
						<X size={14} aria-hidden />
						<span>{t`Clear`}</span>
					</PriButton>
				</BulkToolbar>
			)}

			{isLoading ? (
				<SkeletonRows count={8} height='3.5rem' />
			) : isFailure ? (
				<EmptyState
					title={t`Could not load threads`}
					description={t`Check that the session is valid or try again.`}
				/>
			) : threads.length === 0 ? (
				<EmptyState
					icon={Mail}
					title={
						activeFilters ? t`No threads match the filters` : t`No threads yet`
					}
					description={
						activeFilters
							? t`Try different criteria or clear the filters.`
							: t`Inbound and outbound emails will pin to this board once a thread exists.`
					}
					{...(activeFilters
						? {
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
				<>
					{drafts.length > 0 && <DraftsResumeStrip drafts={drafts} />}
					<ThreadsGrid
						threads={threads}
						companiesById={companiesById}
						selected={selected}
						allSelected={allSelected}
						toggleSelect={toggleSelect}
						selectAll={selectAll}
						clearSelection={clearSelection}
						applyStatus={applyStatus}
						applyRead={applyRead}
					/>
				</>
			)}

			{total > EMAILS_PAGE_SIZE && (
				<Pagination>
					<PageLabel>{t`Showing ${firstRow}–${lastRow} of ${total}`}</PageLabel>
					<PageNav>
						<PriButton
							type='button'
							$variant='outlined'
							disabled={page <= 1}
							onClick={() => handlePage(page - 1)}
						>
							<ChevronLeft size={14} aria-hidden />
							<span>{t`Previous`}</span>
						</PriButton>
						<PageIndicator>{t`Page ${page} of ${totalPages}`}</PageIndicator>
						<PriButton
							type='button'
							$variant='outlined'
							disabled={page >= totalPages}
							onClick={() => handlePage(page + 1)}
						>
							<span>{t`Next`}</span>
							<ChevronRight size={14} aria-hidden />
						</PriButton>
					</PageNav>
				</Pagination>
			)}
		</Page>
	)
}

// ── ThreadsGrid: TanStack Table + Virtual + PriTable ──────────────

type ThreadsGridProps = {
	readonly threads: ReadonlyArray<ThreadRow>
	readonly companiesById: Map<string, CompanyLookup>
	readonly selected: ReadonlySet<string>
	readonly allSelected: boolean
	readonly toggleSelect: (id: string) => void
	readonly selectAll: () => void
	readonly clearSelection: () => void
	readonly applyStatus: (
		ids: ReadonlyArray<string>,
		status: ThreadStatus,
	) => Promise<void>
	readonly applyRead: (
		ids: ReadonlyArray<string>,
		read: boolean,
	) => Promise<void>
}

const COLUMN_SIZING_KEY = 'batuda.emails.columnSizing'
const COLUMN_VISIBILITY_KEY = 'batuda.emails.columnVisibility'

function readLocal<T>(key: string, fallback: T): T {
	if (typeof window === 'undefined') return fallback
	try {
		const raw = window.localStorage.getItem(key)
		if (raw === null) return fallback
		const parsed: unknown = JSON.parse(raw)
		if (parsed === null || typeof parsed !== 'object') return fallback
		return parsed as T
	} catch {
		return fallback
	}
}

function writeLocal(key: string, value: unknown): void {
	if (typeof window === 'undefined') return
	try {
		window.localStorage.setItem(key, JSON.stringify(value))
	} catch {
		// ignore quota / private-mode failures
	}
}

function ThreadsGrid({
	threads,
	companiesById,
	selected,
	allSelected,
	toggleSelect,
	selectAll,
	clearSelection,
	applyStatus,
	applyRead,
}: ThreadsGridProps) {
	const { t } = useLingui()
	const navigate = useNavigate({ from: '/emails/' })

	const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() =>
		readLocal<ColumnSizingState>(COLUMN_SIZING_KEY, {}),
	)
	const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
		() => readLocal<VisibilityState>(COLUMN_VISIBILITY_KEY, {}),
	)
	const [sorting, setSorting] = useState<SortingState>([])

	useEffect(() => {
		writeLocal(COLUMN_SIZING_KEY, columnSizing)
	}, [columnSizing])
	useEffect(() => {
		writeLocal(COLUMN_VISIBILITY_KEY, columnVisibility)
	}, [columnVisibility])

	const rowSelection = useMemo<Record<string, boolean>>(() => {
		const obj: Record<string, boolean> = {}
		for (const id of selected) obj[id] = true
		return obj
	}, [selected])

	const columns = useMemo<ColumnDef<ThreadRow>[]>(
		() => [
			{
				id: 'select',
				size: 44,
				enableResizing: false,
				enableHiding: false,
				enableSorting: false,
				header: () => (
					<PriCheckbox.Root
						checked={allSelected}
						onCheckedChange={checked => {
							if (checked) selectAll()
							else clearSelection()
						}}
						aria-label={t`Select all threads on this page`}
					>
						<PriCheckbox.Indicator>
							<Check size={12} aria-hidden />
						</PriCheckbox.Indicator>
					</PriCheckbox.Root>
				),
				cell: ({ row }) => (
					<PriCheckbox.Root
						checked={selected.has(row.original.id)}
						onCheckedChange={() => toggleSelect(row.original.id)}
						aria-label={t`Select thread ${row.original.subject ?? '(no subject)'}`}
					>
						<PriCheckbox.Indicator>
							<Check size={12} aria-hidden />
						</PriCheckbox.Indicator>
					</PriCheckbox.Root>
				),
			},
			{
				id: 'status',
				header: '',
				size: 36,
				enableResizing: false,
				enableHiding: false,
				enableSorting: false,
				cell: ({ row }) => <StatusCell thread={row.original} />,
			},
			{
				id: 'who',
				header: () => t`Who`,
				size: 260,
				accessorFn: r => resolveCompany(r, companiesById)?.name ?? '',
				cell: ({ row }) => (
					<WhoCell
						thread={row.original}
						company={resolveCompany(row.original, companiesById)}
					/>
				),
			},
			{
				id: 'what',
				header: () => t`What`,
				size: 420,
				accessorFn: r => r.subject ?? '',
				cell: ({ row }) => <WhatCell thread={row.original} />,
			},
			{
				id: 'when',
				header: () => t`When`,
				size: 120,
				accessorFn: r => r.lastMessageAt ?? r.updatedAt,
				cell: ({ row }) => (
					<RelativeDate
						value={row.original.lastMessageAt ?? row.original.updatedAt}
					/>
				),
			},
			{
				id: 'actions',
				header: '',
				size: 140,
				enableResizing: false,
				enableHiding: false,
				enableSorting: false,
				cell: ({ row }) => (
					<RowActionsCell
						thread={row.original}
						applyStatus={applyStatus}
						applyRead={applyRead}
					/>
				),
			},
		],
		[
			t,
			companiesById,
			selected,
			allSelected,
			toggleSelect,
			selectAll,
			clearSelection,
			applyStatus,
			applyRead,
		],
	)

	const table = useReactTable({
		data: threads as ThreadRow[],
		columns,
		state: { columnSizing, columnVisibility, sorting, rowSelection },
		getRowId: r => r.id,
		enableRowSelection: true,
		enableColumnResizing: true,
		columnResizeMode: 'onChange',
		onColumnSizingChange: setColumnSizing,
		onColumnVisibilityChange: setColumnVisibility,
		onSortingChange: setSorting,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		defaultColumn: { minSize: 48, maxSize: 800 },
	})

	const scrollRef = useRef<HTMLDivElement>(null)
	const rows = table.getRowModel().rows
	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => 64,
		overscan: 8,
	})
	const virtualRows = virtualizer.getVirtualItems()

	return (
		<GridShell>
			<GridToolbar>
				<ColumnVisibilityMenu table={table} />
			</GridToolbar>
			<GridScroll ref={scrollRef}>
				<PriTable.Root>
					<PriTable.Head>
						{table.getHeaderGroups().map(group => (
							<PriTable.Row key={group.id}>
								{group.headers.map(header => (
									<PriTable.ColumnHeader
										key={header.id}
										style={{ width: header.getSize() }}
										onClick={
											header.column.getCanSort()
												? header.column.getToggleSortingHandler()
												: undefined
										}
									>
										{header.isPlaceholder
											? null
											: flexRender(
													header.column.columnDef.header,
													header.getContext(),
												)}
										{header.column.getIsSorted() === 'asc' && ' ↑'}
										{header.column.getIsSorted() === 'desc' && ' ↓'}
										{header.column.getCanResize() && (
											<PriTable.Resizer
												onMouseDown={header.getResizeHandler()}
												onTouchStart={header.getResizeHandler()}
												$isResizing={header.column.getIsResizing()}
											/>
										)}
									</PriTable.ColumnHeader>
								))}
							</PriTable.Row>
						))}
					</PriTable.Head>
					<PriTable.Body
						style={{
							height: virtualizer.getTotalSize(),
							position: 'relative',
						}}
					>
						{virtualRows.map(vi => {
							const row = rows[vi.index]
							if (row === undefined) return null
							const thread = row.original
							return (
								<PriTable.Row
									key={row.id}
									data-testid={`thread-row-${thread.id}`}
									data-unread={thread.isUnread ? 'true' : 'false'}
									data-draft={thread.hasDraft ? 'true' : 'false'}
									data-selected={selected.has(thread.id) ? 'true' : 'false'}
									style={{
										position: 'absolute',
										top: 0,
										left: 0,
										right: 0,
										transform: `translateY(${vi.start}px)`,
									}}
									onClick={() => {
										void navigate({
											to: '/emails/$threadId',
											params: { threadId: thread.id },
										})
									}}
								>
									{row.getVisibleCells().map(cell => (
										<PriTable.Cell
											key={cell.id}
											style={{ width: cell.column.getSize() }}
											onClick={
												cell.column.id === 'select' ||
												cell.column.id === 'actions'
													? e => e.stopPropagation()
													: undefined
											}
										>
											{flexRender(
												cell.column.columnDef.cell,
												cell.getContext(),
											)}
										</PriTable.Cell>
									))}
								</PriTable.Row>
							)
						})}
					</PriTable.Body>
				</PriTable.Root>
			</GridScroll>
		</GridShell>
	)
}

function resolveCompany(
	thread: ThreadRow,
	companiesById: Map<string, CompanyLookup>,
): CompanyLookup | null {
	if (thread.companyId === null) return null
	return companiesById.get(thread.companyId) ?? null
}

function StatusCell({ thread }: { thread: ThreadRow }) {
	if (thread.hasDraft) {
		return <PencilLine size={14} aria-label='Has draft' />
	}
	if (thread.isUnread) {
		return <UnreadDot aria-label='Unread' />
	}
	if (thread.status === 'closed') {
		return <Check size={14} aria-label='Closed' />
	}
	if (thread.status === 'archived') {
		return <Archive size={14} aria-label='Archived' />
	}
	return null
}

function WhoCell({
	thread,
	company,
}: {
	thread: ThreadRow
	company: CompanyLookup | null
}) {
	const { t } = useLingui()
	const senderLabel =
		thread.inbox?.displayName ?? thread.inbox?.email ?? t`Unknown`
	return (
		<WhoStack>
			<WhoLine1>
				<WhoName>{senderLabel}</WhoName>
				{thread.lastMessageDirection === 'outbound' ? (
					<ArrowUpRight size={12} aria-label={t`Outbound`} />
				) : thread.lastMessageDirection === 'inbound' ? (
					<ArrowDownLeft size={12} aria-label={t`Inbound`} />
				) : null}
			</WhoLine1>
			<WhoLine2>{company?.name ?? '—'}</WhoLine2>
		</WhoStack>
	)
}

function WhatCell({ thread }: { thread: ThreadRow }) {
	const { t } = useLingui()
	const suspicious =
		thread.lastInboundClassification === 'spam' ||
		thread.lastInboundClassification === 'blocked'
	return (
		<WhatStack>
			<WhatLine1 $unread={thread.isUnread}>
				{thread.subject && thread.subject !== '' ? (
					<WhatSubject>{thread.subject}</WhatSubject>
				) : (
					<NoSubject>{t`(no subject)`}</NoSubject>
				)}
				{suspicious && (
					<SuspiciousTag>
						<AlertTriangle size={10} aria-hidden />
						<span>
							{thread.lastInboundClassification === 'spam'
								? t`Spam`
								: t`Blocked`}
						</span>
					</SuspiciousTag>
				)}
			</WhatLine1>
			<WhatLine2>
				{thread.messageCount === 1 ? t`1 msg` : t`${thread.messageCount} msgs`}
			</WhatLine2>
		</WhatStack>
	)
}

function RowActionsCell({
	thread,
	applyStatus,
	applyRead,
}: {
	thread: ThreadRow
	applyStatus: (
		ids: ReadonlyArray<string>,
		status: ThreadStatus,
	) => Promise<void>
	applyRead: (ids: ReadonlyArray<string>, read: boolean) => Promise<void>
}) {
	const { t } = useLingui()
	return (
		<RowActionsRow>
			{thread.isUnread ? (
				<IconAction
					type='button'
					onClick={() => {
						void applyRead([thread.id], true)
					}}
					aria-label={t`Mark read`}
				>
					<Eye size={14} aria-hidden />
				</IconAction>
			) : (
				<IconAction
					type='button'
					onClick={() => {
						void applyRead([thread.id], false)
					}}
					aria-label={t`Mark unread`}
				>
					<EyeOff size={14} aria-hidden />
				</IconAction>
			)}
			{thread.status === 'open' ? (
				<IconAction
					type='button'
					onClick={() => {
						void applyStatus([thread.id], 'closed')
					}}
					aria-label={t`Close thread`}
				>
					<CheckCheck size={14} aria-hidden />
				</IconAction>
			) : (
				<IconAction
					type='button'
					onClick={() => {
						void applyStatus([thread.id], 'open')
					}}
					aria-label={t`Reopen thread`}
				>
					<ArchiveRestore size={14} aria-hidden />
				</IconAction>
			)}
			{thread.status !== 'archived' && (
				<IconAction
					type='button'
					onClick={() => {
						void applyStatus([thread.id], 'archived')
					}}
					aria-label={t`Archive thread`}
				>
					<Archive size={14} aria-hidden />
				</IconAction>
			)}
		</RowActionsRow>
	)
}

function ColumnVisibilityMenu({ table }: { table: TanstackTable<ThreadRow> }) {
	const { t } = useLingui()
	const labelFor = (id: string): string => {
		if (id === 'who') return t`Who`
		if (id === 'what') return t`What`
		if (id === 'when') return t`When`
		return id
	}
	return (
		<PriPopover.Root>
			<PriPopover.Trigger
				render={props => (
					<PriButton type='button' $variant='outlined' {...props}>
						<Columns size={14} aria-hidden />
						<span>{t`Columns`}</span>
					</PriButton>
				)}
			/>
			<PriPopover.Portal>
				<PriPopover.Positioner>
					<PriPopover.Popup>
						<MenuList>
							{table
								.getAllLeafColumns()
								.filter(col => col.getCanHide())
								.map(col => (
									<MenuRow key={col.id}>
										<PriCheckbox.Root
											checked={col.getIsVisible()}
											onCheckedChange={() => col.toggleVisibility()}
										>
											<PriCheckbox.Indicator>
												<Check size={12} aria-hidden />
											</PriCheckbox.Indicator>
										</PriCheckbox.Root>
										<MenuLabel>{labelFor(col.id)}</MenuLabel>
									</MenuRow>
								))}
							<MenuDivider />
							<PriButton
								type='button'
								$variant='text'
								onClick={() => table.resetColumnVisibility()}
							>
								{t`Reset`}
							</PriButton>
						</MenuList>
					</PriPopover.Popup>
				</PriPopover.Positioner>
			</PriPopover.Portal>
		</PriPopover.Root>
	)
}

// ── DraftsResumeStrip: pinned chip row above the grid ─────────────

type StripDraft = {
	readonly id: string
	readonly subject: string
}

function DraftsResumeStrip({ drafts }: { drafts: ReadonlyArray<StripDraft> }) {
	const { t } = useLingui()
	const [collapsed, setCollapsed] = useState<boolean>(() =>
		readLocal<boolean>('batuda.emails.draftsStripCollapsed', false),
	)
	useEffect(() => {
		writeLocal('batuda.emails.draftsStripCollapsed', collapsed)
	}, [collapsed])
	return (
		<StripPlate>
			<StripLabel>
				{drafts.length === 1
					? t`Resume drafting (1)`
					: t`Resume drafting (${drafts.length})`}
			</StripLabel>
			{!collapsed && (
				<ChipRow>
					{drafts.slice(0, 8).map(d => (
						<DraftChip key={d.id} type='button'>
							{d.subject !== '' ? d.subject : t`Untitled`}
						</DraftChip>
					))}
				</ChipRow>
			)}
			<PriButton
				type='button'
				$variant='text'
				onClick={() => setCollapsed(c => !c)}
			>
				{collapsed ? t`Expand` : t`Collapse`}
			</PriButton>
		</StripPlate>
	)
}

// ── Helpers ──────────────────────────────────────────────────────

function mergeSearch(
	prev: EmailsSearch & { page?: number },
	next: Partial<{
		inboxId: string | undefined
		companyId: string | undefined
		status: ThreadStatus | undefined
		purpose: 'human' | 'agent' | 'shared' | undefined
		query: string | undefined
		page: number | undefined
	}>,
): EmailsSearch & { page?: number } {
	const result: {
		inboxId?: string
		companyId?: string
		status?: ThreadStatus
		purpose?: 'human' | 'agent' | 'shared'
		query?: string
		page?: number
	} = {}
	const inboxId = 'inboxId' in next ? next.inboxId : prev.inboxId
	if (inboxId !== undefined && inboxId !== '') result.inboxId = inboxId
	const companyId = 'companyId' in next ? next.companyId : prev.companyId
	if (companyId !== undefined && companyId !== '') result.companyId = companyId
	const status = 'status' in next ? next.status : prev.status
	if (status !== undefined) result.status = status
	const purpose = 'purpose' in next ? next.purpose : prev.purpose
	if (purpose !== undefined) result.purpose = purpose
	const query = 'query' in next ? next.query : prev.query
	if (query !== undefined && query !== '') result.query = query
	const page = 'page' in next ? next.page : prev.page
	if (page !== undefined && page > 1) result.page = page
	return result
}

function hasActiveFilters(search: EmailsSearch & { page?: number }): boolean {
	return (
		search.inboxId !== undefined ||
		search.companyId !== undefined ||
		search.status !== undefined ||
		search.purpose !== undefined ||
		search.query !== undefined
	)
}

function narrowEnvelope(value: unknown): ListEnvelope | null {
	if (!value || typeof value !== 'object') return null
	const v = value as Record<string, unknown>
	if (!Array.isArray(v['items'])) return null
	if (typeof v['total'] !== 'number') return null
	if (typeof v['limit'] !== 'number') return null
	if (typeof v['offset'] !== 'number') return null
	return {
		items: v['items'] as ReadonlyArray<unknown>,
		total: v['total'],
		limit: v['limit'],
		offset: v['offset'],
	}
}

function narrowThreads(rows: ReadonlyArray<unknown>): ReadonlyArray<ThreadRow> {
	const out: Array<ThreadRow> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		if (typeof r['providerThreadId'] !== 'string') continue
		if (typeof r['status'] !== 'string') continue
		const status = r['status']
		if (status !== 'open' && status !== 'closed' && status !== 'archived') {
			continue
		}
		const direction = r['lastMessageDirection']
		const classification = r['lastInboundClassification']
		out.push({
			id: r['id'],
			providerThreadId: r['providerThreadId'],
			subject: typeof r['subject'] === 'string' ? r['subject'] : null,
			status,
			companyId: typeof r['companyId'] === 'string' ? r['companyId'] : null,
			messageCount:
				typeof r['messageCount'] === 'number' ? r['messageCount'] : 0,
			lastMessageAt:
				typeof r['lastMessageAt'] === 'string' ? r['lastMessageAt'] : null,
			lastMessageDirection:
				direction === 'inbound' || direction === 'outbound' ? direction : null,
			lastInboundClassification:
				classification === 'normal' ||
				classification === 'spam' ||
				classification === 'blocked'
					? classification
					: null,
			isUnread: r['isUnread'] === true,
			hasDraft: false,
			updatedAt:
				typeof r['updatedAt'] === 'string'
					? r['updatedAt']
					: new Date(0).toISOString(),
			inbox: narrowInbox(r['inbox']),
		})
	}
	return out
}

function narrowInbox(value: unknown): ThreadInbox | null {
	if (!value || typeof value !== 'object') return null
	const v = value as Record<string, unknown>
	if (typeof v['email'] !== 'string') return null
	const purpose = v['purpose']
	if (purpose !== 'human' && purpose !== 'agent' && purpose !== 'shared') {
		return null
	}
	return {
		email: v['email'],
		displayName: typeof v['displayName'] === 'string' ? v['displayName'] : null,
		purpose,
	}
}

function narrowInboxes(
	rows: ReadonlyArray<unknown>,
): ReadonlyArray<InboxOption> {
	const out: Array<InboxOption> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		if (typeof r['email'] !== 'string') continue
		const purpose = r['purpose']
		if (purpose !== 'human' && purpose !== 'agent' && purpose !== 'shared') {
			continue
		}
		out.push({
			id: r['id'],
			email: r['email'],
			displayName:
				typeof r['displayName'] === 'string' ? r['displayName'] : null,
			purpose,
		})
	}
	return out
}

// ── Styles ───────────────────────────────────────────────────────

const Page = styled.div.withConfig({ displayName: 'EmailsIndexPage' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`

const Intro = styled.div.withConfig({ displayName: 'EmailsIndexIntro' })`
	display: grid;
	gap: var(--space-md);
	align-items: end;

	@media (min-width: 768px) {
		grid-template-columns: 1fr auto;
	}
`

const IntroActions = styled.div.withConfig({
	displayName: 'EmailsIndexIntroActions',
})`
	display: flex;
	gap: var(--space-xs);
	justify-self: start;

	@media (min-width: 768px) {
		justify-self: end;
	}
`

const IntroText = styled.div.withConfig({
	displayName: 'EmailsIndexIntroText',
})`
	${rulerUnderRule}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-bottom: var(--space-xs);
`

const Title = styled.h2.withConfig({ displayName: 'EmailsIndexTitle' })`
	${stenciledTitle}
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
	margin: 0;
`

const Subtitle = styled.p.withConfig({ displayName: 'EmailsIndexSubtitle' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Filters = styled.div.withConfig({ displayName: 'EmailsIndexFilters' })`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md);
	border-radius: var(--shape-2xs);
`

const SearchWrap = styled.div.withConfig({
	displayName: 'EmailsIndexSearchWrap',
})`
	position: relative;
	display: flex;
	align-items: center;
`

const SearchIcon = styled.span.withConfig({
	displayName: 'EmailsIndexSearchIcon',
})`
	position: absolute;
	left: var(--space-sm);
	display: inline-flex;
	color: var(--color-on-surface-variant);
	pointer-events: none;
	z-index: 2;
`

const StatusFilters = styled.div.withConfig({
	displayName: 'EmailsIndexStatusFilters',
})`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-2xs);
`

const StatusFilterButton = styled.button.withConfig({
	displayName: 'EmailsIndexStatusFilterButton',
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
		css`
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

const InboxSelectWrap = styled.div.withConfig({
	displayName: 'EmailsIndexInboxSelectWrap',
})`
	display: flex;
`

const BulkToolbar = styled.div.withConfig({
	displayName: 'EmailsIndexBulkToolbar',
})`
	${brushedMetalPlate}
	position: sticky;
	top: var(--space-sm);
	z-index: 3;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-sm);
	padding: var(--space-sm) var(--space-md);
	border-radius: var(--shape-2xs);
`

const BulkLabel = styled.span.withConfig({
	displayName: 'EmailsIndexBulkLabel',
})`
	font-family: var(--font-display);
	font-size: var(--typescale-label-medium-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface);
	text-shadow: var(--text-shadow-emboss);
	margin-right: auto;
`

const IconAction = styled.button.withConfig({
	displayName: 'EmailsIndexIconAction',
})`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.75rem;
	height: 1.75rem;
	padding: 0;
	background: transparent;
	border: 1px dashed var(--color-outline);
	border-radius: var(--shape-2xs);
	color: var(--color-on-surface-variant);
	cursor: pointer;
	transition:
		color 160ms ease,
		border-color 160ms ease,
		background 160ms ease;

	&:hover:not(:disabled) {
		color: var(--color-primary);
		border-color: var(--color-primary);
		border-style: solid;
		background: color-mix(in oklab, var(--color-primary) 8%, transparent);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const NoSubject = styled.span.withConfig({
	displayName: 'EmailsIndexNoSubject',
})`
	font-style: italic;
	color: var(--color-on-surface-variant);
`

const UnreadDot = styled.span.withConfig({
	displayName: 'EmailsIndexUnreadDot',
})`
	display: inline-block;
	flex-shrink: 0;
	width: 0.5rem;
	height: 0.5rem;
	border-radius: 50%;
	background: var(--color-primary);
	box-shadow: 0 0 0 2px color-mix(in oklab, var(--color-primary) 30%, transparent);
`

const SuspiciousTag = styled.span.withConfig({
	displayName: 'EmailsIndexSuspiciousTag',
})`
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 2px var(--space-2xs);
	background: color-mix(in oklab, #f59e0b 22%, transparent);
	color: color-mix(in oklab, #92400e 80%, black);
	border: 1px dashed color-mix(in oklab, #b45309 55%, transparent);
	border-radius: var(--shape-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
`

const Pagination = styled.div.withConfig({
	displayName: 'EmailsIndexPagination',
})`
	${brushedMetalPlate}
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	padding: var(--space-sm) var(--space-md);
	border-radius: var(--shape-2xs);
`

const PageLabel = styled.span.withConfig({
	displayName: 'EmailsIndexPageLabel',
})`
	font-family: var(--font-display);
	font-size: var(--typescale-label-medium-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface);
	text-shadow: var(--text-shadow-emboss);
`

const PageNav = styled.div.withConfig({ displayName: 'EmailsIndexPageNav' })`
	display: flex;
	align-items: center;
	gap: var(--space-sm);
`

const PageIndicator = styled.span.withConfig({
	displayName: 'EmailsIndexPageIndicator',
})`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

// ── ThreadsGrid styles ────────────────────────────────────────────

const GridShell = styled.div.withConfig({ displayName: 'EmailsGridShell' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-xs);
`

const GridToolbar = styled.div.withConfig({
	displayName: 'EmailsGridToolbar',
})`
	display: flex;
	justify-content: flex-end;
	gap: var(--space-xs);
`

const GridScroll = styled.div.withConfig({ displayName: 'EmailsGridScroll' })`
	position: relative;
	max-height: calc(100vh - 22rem);
	overflow-y: auto;
	border: 1px solid var(--color-outline-variant);
	border-radius: var(--shape-2xs);
	background: var(--color-surface);
`

const WhoStack = styled.div.withConfig({ displayName: 'EmailsWhoStack' })`
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
`

const WhoLine1 = styled.div.withConfig({ displayName: 'EmailsWhoLine1' })`
	display: flex;
	align-items: center;
	gap: var(--space-2xs);
	color: var(--color-on-surface);
	overflow: hidden;
	white-space: nowrap;
`

const WhoName = styled.span.withConfig({ displayName: 'EmailsWhoName' })`
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const WhoLine2 = styled.div.withConfig({ displayName: 'EmailsWhoLine2' })`
	font-size: var(--typescale-label-medium-size);
	color: var(--color-on-surface-variant);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const WhatStack = styled.div.withConfig({ displayName: 'EmailsWhatStack' })`
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
`

const WhatLine1 = styled.div.withConfig({
	displayName: 'EmailsWhatLine1',
	shouldForwardProp: prop => !prop.startsWith('$'),
})<{ $unread: boolean }>`
	display: flex;
	align-items: center;
	gap: var(--space-2xs);
	color: var(--color-on-surface);
	overflow: hidden;
	font-weight: ${p =>
		p.$unread ? 'var(--font-weight-bold)' : 'var(--font-weight-regular)'};
`

const WhatSubject = styled.span.withConfig({
	displayName: 'EmailsWhatSubject',
})`
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	min-width: 0;
`

const WhatLine2 = styled.div.withConfig({ displayName: 'EmailsWhatLine2' })`
	font-size: var(--typescale-label-medium-size);
	color: var(--color-on-surface-variant);
`

const RowActionsRow = styled.div.withConfig({
	displayName: 'EmailsRowActionsRow',
})`
	display: flex;
	gap: var(--space-2xs);
	justify-content: flex-end;
`

const MenuList = styled.div.withConfig({ displayName: 'EmailsMenuList' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	min-width: 12rem;
`

const MenuRow = styled.label.withConfig({ displayName: 'EmailsMenuRow' })`
	display: flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs);
	cursor: pointer;

	&:hover {
		background: color-mix(in oklab, var(--color-primary) 8%, transparent);
	}
`

const MenuLabel = styled.span.withConfig({ displayName: 'EmailsMenuLabel' })`
	font-family: var(--font-body);
	color: var(--color-on-surface);
`

const MenuDivider = styled.hr.withConfig({ displayName: 'EmailsMenuDivider' })`
	border: none;
	border-top: 1px solid var(--color-outline-variant);
	margin: var(--space-2xs) 0;
`

// ── DraftsResumeStrip styles ──────────────────────────────────────

const StripPlate = styled.div.withConfig({ displayName: 'EmailsStripPlate' })`
	${brushedMetalPlate}
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-sm);
	padding: var(--space-sm) var(--space-md);
	border-radius: var(--shape-2xs);
`

const StripLabel = styled.span.withConfig({
	displayName: 'EmailsStripLabel',
})`
	font-family: var(--font-display);
	font-size: var(--typescale-label-medium-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface);
	text-shadow: var(--text-shadow-emboss);
`

const ChipRow = styled.div.withConfig({ displayName: 'EmailsChipRow' })`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-2xs);
	flex: 1 1 auto;
`

const DraftChip = styled.button.withConfig({ displayName: 'EmailsDraftChip' })`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-sm);
	background: color-mix(in oklab, var(--color-primary) 12%, transparent);
	color: var(--color-on-surface);
	border: 1px dashed var(--color-primary);
	border-radius: var(--shape-2xs);
	font-family: var(--font-body);
	font-size: var(--typescale-label-medium-size);
	cursor: pointer;
	transition: background 160ms ease;

	&:hover {
		background: color-mix(in oklab, var(--color-primary) 20%, transparent);
	}
`
