import {
	RegistryContext,
	useAtomRefresh,
	useAtomSet,
	useAtomValue,
} from '@effect/atom-react'
import { useLingui } from '@lingui/react/macro'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
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
	Eye,
	EyeOff,
	Inbox as InboxIcon,
	Mail,
	Pencil,
	Search,
	X,
} from 'lucide-react'
import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import styled, { css } from 'styled-components'

import {
	PriButton,
	PriCheckbox,
	PriInput,
	PriSelect,
	usePriToast,
} from '@engranatge/ui/pri'

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
import { EmptyState } from '#/components/shared/empty-state'
import { RelativeDate } from '#/components/shared/relative-date'
import { SkeletonRows } from '#/components/shared/skeleton-row'
import { useComposeEmail } from '#/context/compose-email-context'
import { dehydrateAtom } from '#/lib/atom-hydration'
import { getServerCookieHeader } from '#/lib/server-cookie'
import {
	agedPaperRow,
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
	readonly updatedAt: string
	readonly inbox: ThreadInbox | null
}

type InboxOption = {
	readonly id: string
	readonly providerInboxId: string
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
 * clean.
 */
function validateSearch(raw: Record<string, unknown>): EmailsSearch & {
	readonly page?: number
} {
	const out: {
		inboxId?: string
		companyId?: string
		status?: 'open' | 'closed' | 'archived'
		purpose?: 'human' | 'agent' | 'shared'
		query?: string
		page?: number
	} = {}

	if (typeof raw['inboxId'] === 'string' && raw['inboxId'] !== '') {
		out.inboxId = raw['inboxId']
	}
	if (typeof raw['companyId'] === 'string' && raw['companyId'] !== '') {
		out.companyId = raw['companyId']
	}
	if (
		raw['status'] === 'open' ||
		raw['status'] === 'closed' ||
		raw['status'] === 'archived'
	) {
		out.status = raw['status']
	}
	if (
		raw['purpose'] === 'human' ||
		raw['purpose'] === 'agent' ||
		raw['purpose'] === 'shared'
	) {
		out.purpose = raw['purpose']
	}
	if (typeof raw['query'] === 'string' && raw['query'] !== '') {
		out.query = raw['query']
	}
	const rawPage = raw['page']
	const page =
		typeof rawPage === 'number'
			? rawPage
			: typeof rawPage === 'string' && rawPage !== ''
				? Number(rawPage)
				: NaN
	if (Number.isFinite(page) && page >= 1) {
		out.page = Math.floor(page)
	}

	return out
}

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
	const [{ Effect }, { makeForjaApiServer }, cookie] = await Promise.all([
		import('effect'),
		import('#/lib/forja-api-server'),
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
		const client = yield* makeForjaApiServer(cookie ?? undefined)
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
	const { openCompose } = useComposeEmail()
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
	const threads = useMemo<ReadonlyArray<ThreadRow>>(() => {
		const rows = envelope !== null ? narrowThreads(envelope.items) : []
		if (overlays.size === 0) return rows
		return rows.map(row => {
			const patch = overlays.get(row.id)
			if (patch === undefined) return row
			return {
				...row,
				...(patch.status !== undefined && { status: patch.status }),
				...(patch.isUnread !== undefined && { isUnread: patch.isUnread }),
			}
		})
	}, [envelope, overlays])
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
											<PriSelect.Item
												key={inbox.id}
												value={inbox.providerInboxId}
											>
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
				<ThreadsTable role='table' aria-label={t`Email threads`}>
					<ThreadsHead role='row'>
						<HeadCellCheckbox role='columnheader'>
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
						</HeadCellCheckbox>
						<HeadCell role='columnheader'>{t`Subject`}</HeadCell>
						<HeadCell role='columnheader'>{t`Company`}</HeadCell>
						<HeadCellCount role='columnheader'>{t`Msgs`}</HeadCellCount>
						<HeadCell role='columnheader'>{t`Status`}</HeadCell>
						<HeadCellDir role='columnheader' aria-label={t`Last direction`}>
							{/* dir-only column, no visible text to avoid clutter */}
							<span aria-hidden>⇅</span>
						</HeadCellDir>
						<HeadCell role='columnheader'>{t`Updated`}</HeadCell>
					</ThreadsHead>

					{threads.map(thread => {
						const company =
							thread.companyId !== null
								? (companiesById.get(thread.companyId) ?? null)
								: null
						const checked = selected.has(thread.id)
						const suspicious =
							thread.lastInboundClassification === 'spam' ||
							thread.lastInboundClassification === 'blocked'
						return (
							<ThreadRowEl
								key={thread.id}
								role='row'
								$unread={thread.isUnread}
								$muted={suspicious}
								$selected={checked}
							>
								<CellCheckbox role='cell'>
									<PriCheckbox.Root
										checked={checked}
										onCheckedChange={() => toggleSelect(thread.id)}
										aria-label={t`Select thread ${thread.subject ?? '(no subject)'}`}
									>
										<PriCheckbox.Indicator>
											<Check size={12} aria-hidden />
										</PriCheckbox.Indicator>
									</PriCheckbox.Root>
								</CellCheckbox>
								<CellSubject role='cell'>
									{thread.isUnread && <UnreadDot aria-hidden />}
									<SubjectLinkWrap $unread={thread.isUnread}>
										<Link
											to='/emails/$threadId'
											params={{ threadId: thread.id }}
										>
											{thread.subject && thread.subject !== '' ? (
												thread.subject
											) : (
												<NoSubject>{t`(no subject)`}</NoSubject>
											)}
										</Link>
									</SubjectLinkWrap>
									{suspicious && (
										<SuspiciousTag>
											<AlertTriangle size={12} aria-hidden />
											<span>
												{thread.lastInboundClassification === 'spam'
													? t`Spam`
													: t`Blocked`}
											</span>
										</SuspiciousTag>
									)}
								</CellSubject>
								<CellCompany role='cell'>
									{company !== null ? (
										<CompanyLinkWrap>
											<Link
												to='/companies/$slug'
												params={{ slug: company.slug }}
											>
												{company.name}
											</Link>
										</CompanyLinkWrap>
									) : (
										<Muted>—</Muted>
									)}
								</CellCompany>
								<CellCount role='cell'>{thread.messageCount}</CellCount>
								<CellStatus role='cell'>
									<StatusPill $status={thread.status}>
										{thread.status === 'open'
											? t`Open`
											: thread.status === 'closed'
												? t`Closed`
												: t`Archived`}
									</StatusPill>
								</CellStatus>
								<CellDir role='cell'>
									{thread.lastMessageDirection === 'outbound' ? (
										<ArrowUpRight
											size={16}
											aria-label={t`Last message outbound`}
										/>
									) : thread.lastMessageDirection === 'inbound' ? (
										<ArrowDownLeft
											size={16}
											aria-label={t`Last message inbound`}
										/>
									) : (
										<Muted>—</Muted>
									)}
								</CellDir>
								<CellDate role='cell'>
									<RelativeDate
										value={thread.lastMessageAt ?? thread.updatedAt}
									/>
									<RowActions role='group' aria-label={t`Row actions`}>
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
										{thread.status !== 'archived' ? (
											<IconAction
												type='button'
												onClick={() => {
													void applyStatus([thread.id], 'archived')
												}}
												aria-label={t`Archive thread`}
											>
												<Archive size={14} aria-hidden />
											</IconAction>
										) : null}
									</RowActions>
								</CellDate>
							</ThreadRowEl>
						)
					})}
				</ThreadsTable>
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
		if (typeof r['providerInboxId'] !== 'string') continue
		if (typeof r['email'] !== 'string') continue
		const purpose = r['purpose']
		if (purpose !== 'human' && purpose !== 'agent' && purpose !== 'shared') {
			continue
		}
		out.push({
			id: r['id'],
			providerInboxId: r['providerInboxId'],
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

const ThreadsTable = styled.div.withConfig({
	displayName: 'EmailsIndexTable',
})`
	display: flex;
	flex-direction: column;
	gap: 0;
	border: 1px solid var(--color-ledger-line);
	border-radius: var(--shape-2xs);
	overflow: hidden;
	background: var(--color-paper-aged);
`

const gridTemplate = css`
	display: grid;
	grid-template-columns:
		2.5rem
		minmax(0, 1.6fr)
		minmax(0, 1fr)
		3rem
		6rem
		2rem
		minmax(0, 1fr);
	align-items: center;
	gap: var(--space-sm);
	padding: var(--space-sm) var(--space-md);

	@media (max-width: 767px) {
		grid-template-columns: 1fr;
		gap: var(--space-2xs);
	}
`

const ThreadsHead = styled.div.withConfig({
	displayName: 'EmailsIndexTableHead',
})`
	${gridTemplate}
	background: linear-gradient(
		145deg,
		var(--color-metal-light) 0%,
		var(--color-metal) 55%,
		var(--color-metal-dark) 100%
	);
	color: var(--color-on-surface);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	text-shadow: var(--text-shadow-emboss);
	position: sticky;
	top: 0;
	z-index: 2;
	border-bottom: 1px solid rgba(0, 0, 0, 0.25);

	@media (max-width: 767px) {
		display: none;
	}
`

const HeadCell = styled.div.withConfig({ displayName: 'EmailsIndexHeadCell' })``
const HeadCellCheckbox = styled.div.withConfig({
	displayName: 'EmailsIndexHeadCellCheckbox',
})`
	display: flex;
	align-items: center;
	justify-content: center;
`
const HeadCellCount = styled.div.withConfig({
	displayName: 'EmailsIndexHeadCellCount',
})`
	text-align: right;
`
const HeadCellDir = styled.div.withConfig({
	displayName: 'EmailsIndexHeadCellDir',
})`
	text-align: center;
`

const ThreadRowEl = styled.div.withConfig({
	displayName: 'EmailsIndexTableRow',
	shouldForwardProp: prop =>
		prop !== '$unread' && prop !== '$muted' && prop !== '$selected',
})<{
	$unread: boolean
	$muted: boolean
	$selected: boolean
}>`
	${gridTemplate}
	${agedPaperRow}
	border-bottom: 1px solid var(--color-ledger-line);
	opacity: ${p => (p.$muted ? 0.7 : 1)};

	${p =>
		p.$selected &&
		css`
			background-color: color-mix(
				in oklab,
				var(--color-primary) 12%,
				transparent
			);
		`}

	&:last-child {
		border-bottom: none;
	}

	&:hover {
		background-color: color-mix(
			in oklab,
			var(--color-primary) 4%,
			var(--color-paper-aged)
		);
	}

	@media (max-width: 767px) {
		padding: var(--space-sm);
		grid-template-areas:
			'check subject'
			'check meta'
			'. actions';
		grid-template-columns: 2.5rem 1fr;
		row-gap: var(--space-2xs);
	}
`

const CellCheckbox = styled.div.withConfig({
	displayName: 'EmailsIndexCellCheckbox',
})`
	display: flex;
	align-items: center;
	justify-content: center;

	@media (max-width: 767px) {
		grid-area: check;
	}
`

const CellSubject = styled.div.withConfig({
	displayName: 'EmailsIndexCellSubject',
})`
	display: flex;
	align-items: center;
	gap: var(--space-2xs);
	min-width: 0;

	@media (max-width: 767px) {
		grid-area: subject;
	}
`

const CellCompany = styled.div.withConfig({
	displayName: 'EmailsIndexCellCompany',
})`
	min-width: 0;

	@media (max-width: 767px) {
		grid-area: meta;
		font-size: var(--typescale-label-small-size);
	}
`

const CellCount = styled.div.withConfig({
	displayName: 'EmailsIndexCellCount',
})`
	text-align: right;
	font-family: var(--font-display);
	font-weight: var(--font-weight-bold);
	color: var(--color-on-surface-variant);

	@media (max-width: 767px) {
		display: none;
	}
`

const CellStatus = styled.div.withConfig({
	displayName: 'EmailsIndexCellStatus',
})`
	@media (max-width: 767px) {
		grid-area: meta;
		justify-self: start;
	}
`

const CellDir = styled.div.withConfig({ displayName: 'EmailsIndexCellDir' })`
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--color-on-surface-variant);

	@media (max-width: 767px) {
		display: none;
	}
`

const CellDate = styled.div.withConfig({ displayName: 'EmailsIndexCellDate' })`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	min-width: 0;

	@media (max-width: 767px) {
		grid-area: actions;
		justify-content: flex-end;
	}
`

const RowActions = styled.div.withConfig({
	displayName: 'EmailsIndexRowActions',
})`
	display: flex;
	gap: var(--space-2xs);
	opacity: 0;
	transition: opacity 160ms ease;

	${ThreadRowEl}:hover &,
	${ThreadRowEl}:focus-within & {
		opacity: 1;
	}

	@media (max-width: 767px) {
		opacity: 1;
	}
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

const SubjectLinkWrap = styled.div.withConfig({
	displayName: 'EmailsIndexSubjectLinkWrap',
	shouldForwardProp: prop => prop !== '$unread',
})<{ $unread: boolean }>`
	min-width: 0;

	> a {
		color: var(--color-on-surface);
		text-decoration: none;
		font-family: var(--font-body);
		font-size: var(--typescale-body-large-size);
		font-weight: ${p =>
			p.$unread ? 'var(--font-weight-bold)' : 'var(--font-weight-medium)'};
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		display: block;
	}

	> a:hover {
		color: var(--color-primary);
	}
`

const CompanyLinkWrap = styled.div.withConfig({
	displayName: 'EmailsIndexCompanyLinkWrap',
})`
	min-width: 0;

	> a {
		color: var(--color-on-surface);
		text-decoration: none;
		font-family: var(--font-body);
		font-size: var(--typescale-body-medium-size);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		display: block;
	}

	> a:hover {
		color: var(--color-primary);
		text-decoration: underline;
	}
`

const Muted = styled.span.withConfig({ displayName: 'EmailsIndexMuted' })`
	color: var(--color-on-surface-variant);
	font-style: italic;
	opacity: 0.7;
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

const StatusPill = styled.span.withConfig({
	displayName: 'EmailsIndexStatusPill',
	shouldForwardProp: prop => prop !== '$status',
})<{ $status: ThreadStatus }>`
	display: inline-flex;
	align-items: center;
	padding: 2px var(--space-2xs);
	border-radius: var(--shape-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	${p =>
		p.$status === 'open'
			? css`
					background: color-mix(in oklab, var(--color-primary) 16%, transparent);
					color: color-mix(in oklab, var(--color-primary) 80%, black);
					border: 1px solid
						color-mix(in oklab, var(--color-primary) 45%, transparent);
				`
			: p.$status === 'closed'
				? css`
						background: color-mix(in oklab, var(--color-outline) 24%, transparent);
						color: var(--color-on-surface-variant);
						border: 1px solid var(--color-outline);
					`
				: css`
						background: transparent;
						color: var(--color-on-surface-variant);
						border: 1px dashed var(--color-outline);
					`}
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
