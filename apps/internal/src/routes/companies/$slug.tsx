import { Select } from '@base-ui/react/select'
import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import {
	createFileRoute,
	Link,
	notFound,
	stripSearchParams,
} from '@tanstack/react-router'
import { Schema } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import {
	AlertTriangle,
	Briefcase,
	Camera,
	Check,
	ChevronRight,
	ExternalLink,
	FileText,
	Globe,
	Mail,
	MailPlus,
	MapPin,
	Phone,
	Plus,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useMemo, useState } from 'react'
import styled from 'styled-components'

import {
	PriButton,
	PriCollapsible,
	PriSelect,
	PriTabs,
	usePriToast,
} from '@batuda/ui/pri'

import {
	companyAtomFor,
	companyTasksAtomFor,
	contactsAtomFor,
	interactionsAtomFor,
	timelineAtomFor,
} from '#/atoms/company-atoms'
import { emailsSearchAtom } from '#/atoms/emails-atoms'
import { pagesSearchAtom } from '#/atoms/pages-atoms'
import { researchListAtom } from '#/atoms/research-atoms'
import { CalendarTab } from '#/components/companies/calendar-tab'
import { UpcomingMeetingsCard } from '#/components/companies/upcoming-meetings-card'
import { WherePanel } from '#/components/companies/where-panel'
import { ResearchDialog } from '#/components/research/research-dialog'
import { RunDetail } from '#/components/research/run-detail'
import { type ResearchRunRow, RunList } from '#/components/research/run-list'
import {
	EditableChips,
	EditableField,
	EditableSelect,
} from '#/components/shared/editable-field'
import { EmptyState } from '#/components/shared/empty-state'
import { LoadingSpinner } from '#/components/shared/loading-spinner'
import { PriorityDot } from '#/components/shared/priority-dot'
import { RelativeDate } from '#/components/shared/relative-date'
import { asCompanyStatus, StatusBadge } from '#/components/shared/status-badge'
import {
	TimelineEntry,
	type TimelineEntryData,
} from '#/components/shared/timeline-entry'
import { ScrewDot } from '#/components/shared/workshop-decorations'
import { useComposeEmail } from '#/context/compose-email-context'
import { useQuickCapture } from '#/context/quick-capture-context'
import { dehydrateAtom } from '#/lib/atom-hydration'
import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import { validateSearchWith } from '#/lib/search-schema'
import { getServerCookieHeader } from '#/lib/server-cookie'
import { useTabSearchParam } from '#/lib/tab-search'
import {
	agedPaperSurface,
	brushedMetalBezel,
	brushedMetalPlate,
	ruledLedgerRow,
	stenciledTitle,
} from '#/lib/workshop-mixins'

/**
 * Narrow shapes for the detail view. The server returns `Schema.Unknown`
 * so we runtime-narrow at the boundary (same pattern as the dashboard
 * and the list page). Promoting these to shared typed schemas is a
 * follow-up.
 */
type CompanyDetail = {
	readonly id: string
	readonly slug: string
	readonly name: string
	readonly status: string
	readonly industry: string | null
	readonly sizeRange: string | null
	readonly region: string | null
	readonly location: string | null
	readonly source: string | null
	readonly priority: number | null
	readonly website: string | null
	readonly email: string | null
	readonly phone: string | null
	readonly instagram: string | null
	readonly linkedin: string | null
	readonly googleMapsUrl: string | null
	readonly painPoints: string | null
	readonly currentTools: string | null
	readonly nextAction: string | null
	readonly nextActionAt: string | null
	readonly lastContactedAt: string | null
	readonly lastEmailAt: string | null
	readonly lastCallAt: string | null
	readonly lastMeetingAt: string | null
	readonly nextCalendarEventAt: string | null
	readonly tags: ReadonlyArray<string>
	readonly productsFit: ReadonlyArray<string>
	readonly latitude: number | null
	readonly longitude: number | null
	readonly geocodedAt: string | null
	readonly geocodeSource: string | null
}

type ContactRow = {
	readonly id: string
	readonly name: string
	readonly role: string | null
	readonly isDecisionMaker: boolean
	readonly email: string | null
	readonly phone: string | null
	readonly linkedin: string | null
	readonly emailStatus: 'unknown' | 'valid' | 'bounced' | 'complained'
	readonly emailStatusReason: string | null
}

type TimelineRow = {
	readonly id: string
	readonly kind: string
	readonly channel: string
	readonly date: string
	readonly summary: string | null
	readonly entityType: string
	readonly entityId: string
}

type TaskEntry = {
	readonly id: string
	readonly title: string
	readonly type: string
	readonly dueAt: string | null
	readonly completedAt: string | null
}

type DetailPayload = {
	readonly company: unknown
	readonly contacts: ReadonlyArray<unknown>
	readonly interactions: ReadonlyArray<unknown>
	readonly tasks: ReadonlyArray<unknown>
}

/**
 * Server-only: fetch the company row and all four relations in parallel.
 * Dynamically imports the server client so Vite excludes it from the
 * client bundle; forwards the Better-Auth cookie via
 * `getRequestHeader('cookie')`.
 *
 * Uses `Effect.all` with `concurrency: 4` for the relations so they
 * share a single Better-Auth session roundtrip but run in parallel on
 * the server.
 */
async function loadDetailOnServer(slug: string): Promise<DetailPayload> {
	const [{ Effect }, { makeBatudaApiServer }, cookie] = await Promise.all([
		import('effect'),
		import('#/lib/batuda-api-server'),
		getServerCookieHeader(),
	])
	const program = Effect.gen(function* () {
		const client = yield* makeBatudaApiServer(cookie ?? undefined)
		const company = yield* client.companies.get({ params: { slug } })
		const companyId = extractCompanyId(company)
		if (companyId === null) {
			return {
				company,
				contacts: [],
				interactions: [],
				tasks: [],
			} as DetailPayload
		}
		const [contacts, interactions, tasks] = yield* Effect.all(
			[
				client.contacts.list({ query: { companyId } }),
				client.interactions.list({ query: { companyId, limit: 20 } }),
				client.tasks.list({ query: { companyId } }),
			],
			{ concurrency: 3 },
		)
		return { company, contacts, interactions, tasks } as DetailPayload
	})
	return Effect.runPromise(program)
}

function extractCompanyId(raw: unknown): string | null {
	if (!raw || typeof raw !== 'object') return null
	const id = (raw as Record<string, unknown>)['id']
	return typeof id === 'string' ? id : null
}

const COMPANY_TABS = [
	'profile',
	'where',
	'contacts',
	'emails',
	'tasks',
	'calendar',
	'research',
	'pages',
	'documents',
] as const
type CompanyTab = (typeof COMPANY_TABS)[number]

const validateSearch = validateSearchWith({
	tab: Schema.Literals(COMPANY_TABS),
})

export const Route = createFileRoute('/companies/$slug')({
	validateSearch,
	// Strip the default tab from the URL so `useTabSearchParam` can write
	// `tab: next` unconditionally without leaving `?tab=profile` behind.
	search: { middlewares: [stripSearchParams({ tab: 'profile' })] },
	loader: async ({ params: { slug } }) => {
		if (!import.meta.env.SSR) {
			// Client-side navigation: let the atoms refetch directly via
			// `BatudaApiAtom`. First render flashes the loading state while
			// the request is in flight — that's acceptable for parameterized
			// routes per the plan (Phase 5b.4.e option 1).
			return { dehydrated: [] as const, slug }
		}
		try {
			const payload = await loadDetailOnServer(slug)
			const companyId = extractCompanyId(payload.company)
			// Can't hydrate the relation atoms without a companyId. Fall back
			// to hydrating only the company atom; the relations will fetch
			// client-side after hydration.
			if (companyId === null) {
				return {
					dehydrated: [
						dehydrateAtom(
							companyAtomFor(slug),
							AsyncResult.success(payload.company),
						),
					] as const,
					slug,
				}
			}
			return {
				dehydrated: [
					dehydrateAtom(
						companyAtomFor(slug),
						AsyncResult.success(payload.company),
					),
					dehydrateAtom(
						contactsAtomFor(companyId),
						AsyncResult.success(payload.contacts),
					),
					dehydrateAtom(
						interactionsAtomFor(companyId),
						AsyncResult.success(payload.interactions),
					),
					dehydrateAtom(
						companyTasksAtomFor(companyId),
						AsyncResult.success(payload.tasks),
					),
				] as const,
				slug,
			}
		} catch (error) {
			// 404 from the server → propagate as a TanStack Router notFound.
			// Anything else (auth failure, network) falls back to empty
			// hydration and the component renders an error state.
			if (isNotFoundError(error)) {
				throw notFound()
			}
			console.warn('[CompanyDetailLoader] falling back:', error)
			return { dehydrated: [] as const, slug }
		}
	},
	component: CompanyDetailPage,
})

function isNotFoundError(error: unknown): boolean {
	if (!error || typeof error !== 'object') return false
	const tag = (error as Record<string, unknown>)['_tag']
	return tag === 'NotFound'
}

function CompanyDetailPage() {
	const { t } = useLingui()
	const { slug } = Route.useParams()
	const companyAtom = useMemo(() => companyAtomFor(slug), [slug])
	const companyResult = useAtomValue(companyAtom)
	const refreshCompany = useAtomRefresh(companyAtom)

	const company = useMemo<CompanyDetail | null>(
		() =>
			AsyncResult.isSuccess(companyResult)
				? narrowCompany(companyResult.value)
				: null,
		[companyResult],
	)

	if (AsyncResult.isInitial(companyResult)) {
		return (
			<Page>
				<LoadingSpinner />
			</Page>
		)
	}

	if (AsyncResult.isFailure(companyResult) || company === null) {
		return (
			<Page>
				<EmptyState
					title={t`Could not load this company`}
					description={t`Check that the session is valid or try again.`}
				/>
			</Page>
		)
	}

	return <DetailBody company={company} refreshCompany={refreshCompany} />
}

/**
 * The detail body runs after the company atom has resolved, so the
 * relation atoms can use the actual company id (not the URL slug).
 * Splitting the component this way keeps the relation hooks out of the
 * loading/error branches above.
 */
function DetailBody({
	company,
	refreshCompany,
}: {
	company: CompanyDetail
	refreshCompany: () => void
}) {
	const { t } = useLingui()
	const { open: openQuickCapture } = useQuickCapture()
	const { openCompose } = useComposeEmail()
	const [tab, setTab] = useTabSearchParam<CompanyTab>(COMPANY_TABS, 'profile')

	const contactsAtom = useMemo(() => contactsAtomFor(company.id), [company.id])
	const interactionsAtom = useMemo(
		() => interactionsAtomFor(company.id),
		[company.id],
	)
	const timelineAtom = useMemo(() => timelineAtomFor(company.id), [company.id])
	const tasksAtom = useMemo(() => companyTasksAtomFor(company.id), [company.id])
	const companyPagesAtom = useMemo(
		() => pagesSearchAtom({ companyId: company.id }),
		[company.id],
	)
	const companyEmailsAtom = useMemo(
		() => emailsSearchAtom({ companyId: company.id, limit: 100 }),
		[company.id],
	)
	const companyResearchAtom = useMemo(
		() =>
			researchListAtom({
				subjectTable: 'companies',
				subjectId: company.id,
				limit: 50,
			}),
		[company.id],
	)

	const contactsResult = useAtomValue(contactsAtom)
	const timelineResult = useAtomValue(timelineAtom)
	const tasksResult = useAtomValue(tasksAtom)
	const pagesResult = useAtomValue(companyPagesAtom)
	const emailsResult = useAtomValue(companyEmailsAtom)
	const researchResult = useAtomValue(companyResearchAtom)
	const refreshResearch = useAtomRefresh(companyResearchAtom)

	const refreshInteractions = useAtomRefresh(interactionsAtom)
	const refreshTimeline = useAtomRefresh(timelineAtom)
	const refreshContacts = useAtomRefresh(contactsAtom)

	const toast = usePriToast()
	const updateCompany = useAtomSet(
		BatudaApiAtom.mutation('companies', 'update'),
		{ mode: 'promiseExit' },
	)
	const saveField = useCallback(
		async (field: string, next: unknown) => {
			const exit = await updateCompany({
				params: { id: company.id },
				payload: { [field]: next },
			} as never)
			if (exit._tag === 'Success') {
				refreshCompany()
				return
			}
			toast.add({
				title: t`Could not save`,
				description: t`The workshop rejected the change. Try again.`,
				type: 'error',
			})
			console.error('[batuda] companies.update failed', exit.cause)
			throw new Error('update-failed')
		},
		[updateCompany, company.id, refreshCompany, toast, t],
	)

	const statusOptions = useMemo(
		() => [
			{ value: 'prospect', label: t`Prospect` },
			{ value: 'contacted', label: t`Contacted` },
			{ value: 'responded', label: t`Responded` },
			{ value: 'meeting', label: t`Meeting` },
			{ value: 'proposal', label: t`Proposal` },
			{ value: 'client', label: t`Client` },
			{ value: 'closed', label: t`Closed` },
			{ value: 'dead', label: t`Dead` },
		],
		[t],
	)
	const priorityOptions = useMemo(
		() => [
			{ value: '1', label: t`High` },
			{ value: '2', label: t`Medium` },
			{ value: '3', label: t`Low` },
		],
		[t],
	)

	const contacts = useMemo<ReadonlyArray<ContactRow>>(
		() =>
			AsyncResult.isSuccess(contactsResult)
				? narrowContacts(contactsResult.value)
				: [],
		[contactsResult],
	)
	const timelineEntries = useMemo<ReadonlyArray<TimelineRow>>(
		() =>
			AsyncResult.isSuccess(timelineResult)
				? narrowTimeline(timelineResult.value)
				: [],
		[timelineResult],
	)
	const tasks = useMemo<ReadonlyArray<TaskEntry>>(
		() =>
			AsyncResult.isSuccess(tasksResult) ? narrowTasks(tasksResult.value) : [],
		[tasksResult],
	)
	const researchRuns = useMemo<ReadonlyArray<ResearchRunRow>>(
		() =>
			AsyncResult.isSuccess(researchResult)
				? narrowResearch(researchResult.value)
				: [],
		[researchResult],
	)
	const [selectedResearchId, setSelectedResearchId] = useState<string | null>(
		null,
	)
	const [researchDialogOpen, setResearchDialogOpen] = useState(false)
	type PageEntry = {
		readonly id: string
		readonly title: string
		readonly slug: string
		readonly status: string
		readonly lang: string
	}
	const companyPages = useMemo<ReadonlyArray<PageEntry>>(() => {
		if (!AsyncResult.isSuccess(pagesResult)) return []
		const out: Array<PageEntry> = []
		for (const row of pagesResult.value as ReadonlyArray<unknown>) {
			if (!row || typeof row !== 'object') continue
			const r = row as Record<string, unknown>
			if (typeof r['id'] !== 'string') continue
			if (typeof r['title'] !== 'string') continue
			out.push({
				id: r['id'],
				title: r['title'],
				slug: typeof r['slug'] === 'string' ? r['slug'] : '',
				status: typeof r['status'] === 'string' ? r['status'] : 'draft',
				lang: typeof r['lang'] === 'string' ? r['lang'] : 'en',
			})
		}
		return out
	}, [pagesResult])

	type CompanyThreadRow = {
		readonly id: string
		readonly providerThreadId: string
		readonly subject: string | null
		readonly status: 'open' | 'closed' | 'archived'
		readonly updatedAt: string
		readonly messageCount: number
	}
	const companyThreads = useMemo<ReadonlyArray<CompanyThreadRow>>(() => {
		if (!AsyncResult.isSuccess(emailsResult)) return []
		const envelope = emailsResult.value
		if (!envelope || typeof envelope !== 'object') return []
		const items = (envelope as Record<string, unknown>)['items']
		if (!Array.isArray(items)) return []
		const out: Array<CompanyThreadRow> = []
		for (const row of items) {
			if (!row || typeof row !== 'object') continue
			const r = row as Record<string, unknown>
			if (typeof r['id'] !== 'string') continue
			if (typeof r['providerThreadId'] !== 'string') continue
			const status = r['status']
			if (status !== 'open' && status !== 'closed' && status !== 'archived') {
				continue
			}
			out.push({
				id: r['id'],
				providerThreadId: r['providerThreadId'],
				subject: typeof r['subject'] === 'string' ? r['subject'] : null,
				status,
				updatedAt:
					typeof r['updatedAt'] === 'string'
						? r['updatedAt']
						: new Date(0).toISOString(),
				messageCount:
					typeof r['messageCount'] === 'number' ? r['messageCount'] : 0,
			})
		}
		return out
	}, [emailsResult])

	const openTaskCount = useMemo(
		() => tasks.filter(task => task.completedAt === null).length,
		[tasks],
	)

	const [showSystemEvents, setShowSystemEvents] = useState(false)
	const visibleTimeline = useMemo(
		() =>
			showSystemEvents
				? timelineEntries
				: timelineEntries.filter(entry => entry.kind !== 'system_event'),
		[timelineEntries, showSystemEvents],
	)

	const handleComposeEmail = useCallback(() => {
		openCompose({ mode: 'new', companyId: company.id })
	}, [openCompose, company.id])

	const handleEmailContact = useCallback(
		(contactId: string, email: string | null) => {
			openCompose({
				mode: 'new',
				companyId: company.id,
				contactId,
				...(email ? { to: email } : {}),
			})
		},
		[openCompose, company.id],
	)

	const clearSuppression = useAtomSet(
		BatudaApiAtom.mutation('contacts', 'clearSuppression'),
		{ mode: 'promiseExit' },
	)
	const handleClearSuppression = useCallback(
		async (contactId: string) => {
			const exit = await clearSuppression({
				params: { id: contactId },
			} as never)
			if (exit._tag === 'Success') {
				refreshContacts()
				return
			}
			toast.add({
				title: t`Could not clear suppression`,
				description: t`The change didn't go through. Try again.`,
				type: 'error',
			})
			console.error('[batuda] contacts.clearSuppression failed', exit.cause)
		},
		[clearSuppression, refreshContacts, toast, t],
	)

	// Both the interactions feed and the company row become stale after
	// Quick Capture submits — the server copies nextAction + lastContactedAt
	// onto the company in the same transaction as the interaction insert.
	const handleLogInteraction = useCallback(() => {
		openQuickCapture({
			companyId: company.id,
			companyName: company.name,
			onSubmitted: () => {
				refreshInteractions()
				refreshTimeline()
				refreshCompany()
			},
		})
	}, [
		openQuickCapture,
		company.id,
		company.name,
		refreshInteractions,
		refreshTimeline,
		refreshCompany,
	])

	const subtitleParts = [company.location, company.industry].filter(
		(part): part is string => Boolean(part),
	)
	const subtitle = subtitleParts.join(' · ')

	return (
		<Page>
			<Header layoutId={`company-${company.slug}`}>
				<ScrewDot $position='top-left' $size={8} aria-hidden />
				<ScrewDot $position='top-right' $size={8} aria-hidden />
				<IdentityRow>
					<Identity>
						<Name>{company.name}</Name>
						{subtitle && <SubtitleText>{subtitle}</SubtitleText>}
					</Identity>
					<HeaderMeta>
						<PriSelect.Root
							items={priorityOptions}
							value={company.priority === null ? '' : String(company.priority)}
							onValueChange={next => {
								if (typeof next !== 'string') return
								void saveField(
									'priority',
									next.length === 0 ? null : Number(next),
								)
							}}
						>
							<HeaderSelectTrigger
								render={
									<HeaderInlineButton
										type='button'
										aria-label={t`Change priority`}
									>
										{company.priority === null ? (
											<GhostPriorityDot aria-hidden />
										) : (
											<PriorityDot priority={company.priority} />
										)}
									</HeaderInlineButton>
								}
							/>
							<PriSelect.Portal>
								<PriSelect.Positioner
									alignItemWithTrigger={false}
									sideOffset={6}
								>
									<PriSelect.Popup>
										<PriSelect.List>
											{priorityOptions.map(opt => (
												<PriSelect.Item key={opt.value} value={opt.value}>
													<PriSelect.ItemIndicator>
														<Check size={12} />
													</PriSelect.ItemIndicator>
													<PriSelect.ItemText>{opt.label}</PriSelect.ItemText>
												</PriSelect.Item>
											))}
										</PriSelect.List>
									</PriSelect.Popup>
								</PriSelect.Positioner>
							</PriSelect.Portal>
						</PriSelect.Root>
						<PriSelect.Root
							items={statusOptions}
							value={company.status}
							onValueChange={next => {
								if (typeof next !== 'string' || next.length === 0) return
								void saveField('status', next)
							}}
						>
							<HeaderSelectTrigger
								render={
									<HeaderInlineButton
										type='button'
										aria-label={t`Change status`}
									>
										<StatusBadge
											status={asCompanyStatus(company.status)}
											size='lg'
										/>
									</HeaderInlineButton>
								}
							/>
							<PriSelect.Portal>
								<PriSelect.Positioner
									alignItemWithTrigger={false}
									sideOffset={6}
								>
									<PriSelect.Popup>
										<PriSelect.List>
											{statusOptions.map(opt => (
												<PriSelect.Item key={opt.value} value={opt.value}>
													<PriSelect.ItemIndicator>
														<Check size={12} />
													</PriSelect.ItemIndicator>
													<PriSelect.ItemText>{opt.label}</PriSelect.ItemText>
												</PriSelect.Item>
											))}
										</PriSelect.List>
									</PriSelect.Popup>
								</PriSelect.Positioner>
							</PriSelect.Portal>
						</PriSelect.Root>
					</HeaderMeta>
				</IdentityRow>

				<HeaderChrome>
					<ExternalLinks>
						{company.website && (
							<ExternalLinkButton
								href={company.website}
								target='_blank'
								rel='noopener noreferrer'
								aria-label={t`Open website`}
							>
								<Globe size={16} aria-hidden />
							</ExternalLinkButton>
						)}
						{company.email && (
							<ExternalLinkButton
								href={`mailto:${company.email}`}
								aria-label={t`Send email`}
							>
								<Mail size={16} aria-hidden />
							</ExternalLinkButton>
						)}
						{company.phone && (
							<ExternalLinkButton
								href={`tel:${company.phone}`}
								aria-label={t`Call phone`}
							>
								<Phone size={16} aria-hidden />
							</ExternalLinkButton>
						)}
						{company.linkedin && (
							<ExternalLinkButton
								href={company.linkedin}
								target='_blank'
								rel='noopener noreferrer'
								aria-label={t`Open LinkedIn`}
							>
								<Briefcase size={16} aria-hidden />
							</ExternalLinkButton>
						)}
						{company.instagram && (
							<ExternalLinkButton
								href={company.instagram}
								target='_blank'
								rel='noopener noreferrer'
								aria-label={t`Open Instagram`}
							>
								<Camera size={16} aria-hidden />
							</ExternalLinkButton>
						)}
						{company.googleMapsUrl && (
							<ExternalLinkButton
								href={company.googleMapsUrl}
								target='_blank'
								rel='noopener noreferrer'
								aria-label={t`Open in Google Maps`}
							>
								<MapPin size={16} aria-hidden />
							</ExternalLinkButton>
						)}
					</ExternalLinks>
					<LastContact>
						<LastContactLabel>
							<Trans>Last contact</Trans>
						</LastContactLabel>
						<RelativeDate value={company.lastContactedAt} fallback={t`never`} />
					</LastContact>
				</HeaderChrome>

				<PrimaryActions>
					<motion.div whileTap={{ scale: 0.96 }}>
						<PriButton
							type='button'
							$variant='filled'
							onClick={handleLogInteraction}
							data-testid='action-log-interaction'
						>
							<Plus size={16} aria-hidden />
							<Trans>Log interaction</Trans>
						</PriButton>
					</motion.div>
					{/* form action so compose opens reliably even during the
					 * route subtree's hydration window — see
					 * routes/emails/index.tsx for the same rationale. */}
					<form action={handleComposeEmail}>
						<PriButton
							type='submit'
							$variant='outlined'
							data-testid='action-compose-email'
						>
							<MailPlus size={16} aria-hidden />
							<Trans>Email</Trans>
						</PriButton>
					</form>
					<PriButton
						type='button'
						$variant='outlined'
						disabled
						data-testid='action-add-task'
					>
						<Plus size={16} aria-hidden />
						<Trans>Add task</Trans>
					</PriButton>
					<PriButton
						type='button'
						$variant='outlined'
						disabled
						data-testid='action-new-proposal'
					>
						<Plus size={16} aria-hidden />
						<Trans>New proposal</Trans>
					</PriButton>
				</PrimaryActions>
			</Header>

			<PriTabs.Root value={tab} onValueChange={v => setTab(v as CompanyTab)}>
				<PriTabs.List>
					<PriTabs.Tab value='profile'>
						<Trans>Profile</Trans>
					</PriTabs.Tab>
					<PriTabs.Tab value='where'>
						<Trans>Where</Trans>
						{company.latitude !== null && company.longitude !== null ? (
							<MapPin size={12} aria-hidden />
						) : null}
					</PriTabs.Tab>
					<PriTabs.Tab value='contacts'>
						<Trans>Contacts</Trans> ({contacts.length})
					</PriTabs.Tab>
					<PriTabs.Tab value='emails'>
						<Trans>Emails</Trans> ({companyThreads.length})
					</PriTabs.Tab>
					<PriTabs.Tab value='tasks'>
						<Trans>Tasks</Trans> ({openTaskCount})
					</PriTabs.Tab>
					<PriTabs.Tab value='calendar' data-testid='company-calendar-tab'>
						<Trans>Calendar</Trans>
					</PriTabs.Tab>
					<PriTabs.Tab value='research' data-testid='research-tab'>
						<Trans>Research</Trans>
					</PriTabs.Tab>
					<PriTabs.Tab value='pages'>
						<Trans>Pages</Trans> ({companyPages.length})
					</PriTabs.Tab>
					<PriTabs.Tab value='documents'>
						<Trans>Documents</Trans>
					</PriTabs.Tab>
					<PriTabs.Indicator />
				</PriTabs.List>

				<PriTabs.Panel value='profile'>
					<PanelWrap>
						<UpcomingMeetingsCard companyId={company.id} />
						<CadenceBlock>
							<CadenceTitle>
								<Trans>Cadence</Trans>
							</CadenceTitle>
							<CadenceGrid>
								<CadenceRow>
									<CadenceLabel>
										<Trans>Last email</Trans>
									</CadenceLabel>
									<RelativeDate
										value={company.lastEmailAt}
										fallback={t`never`}
									/>
								</CadenceRow>
								<CadenceRow>
									<CadenceLabel>
										<Trans>Last call</Trans>
									</CadenceLabel>
									<RelativeDate
										value={company.lastCallAt}
										fallback={t`never`}
									/>
								</CadenceRow>
								<CadenceRow>
									<CadenceLabel>
										<Trans>Last meet</Trans>
									</CadenceLabel>
									<RelativeDate
										value={company.lastMeetingAt}
										fallback={t`never`}
									/>
								</CadenceRow>
								<CadenceRow>
									<CadenceLabel>
										<Trans>Next event</Trans>
									</CadenceLabel>
									<RelativeDate
										value={company.nextCalendarEventAt}
										fallback={t`none scheduled`}
									/>
								</CadenceRow>
							</CadenceGrid>
						</CadenceBlock>
						<ProfileGrid>
							<EditableField
								label={t`Industry`}
								value={company.industry}
								onSave={next => saveField('industry', next)}
							/>
							<EditableField
								label={t`Region`}
								value={company.region}
								onSave={next => saveField('region', next)}
							/>
							<EditableField
								label={t`Location`}
								value={company.location}
								onSave={next => saveField('location', next)}
							/>
							<EditableField
								label={t`Size`}
								value={company.sizeRange}
								onSave={next => saveField('sizeRange', next)}
							/>
							<EditableField
								label={t`Source`}
								value={company.source}
								onSave={next => saveField('source', next)}
							/>
							<EditableSelect
								label={t`Priority`}
								value={
									company.priority === null ? null : String(company.priority)
								}
								options={priorityOptions}
								onSave={next =>
									saveField('priority', next === null ? null : Number(next))
								}
								placeholder={t`— not set —`}
							/>
							<EditableField
								label={t`Current tools`}
								value={company.currentTools}
								onSave={next => saveField('currentTools', next)}
							/>
							<EditableField
								label={t`Pain points`}
								value={company.painPoints}
								onSave={next => saveField('painPoints', next)}
								multiline
							/>
							<EditableField
								label={t`Next action`}
								value={company.nextAction}
								onSave={next => saveField('nextAction', next)}
								multiline
							/>
							<EditableChips
								label={t`Tags`}
								values={company.tags}
								onSave={next => saveField('tags', next)}
								emptyHint={t`No tags yet`}
							/>
							<EditableChips
								label={t`Products fit`}
								values={company.productsFit}
								onSave={next => saveField('productsFit', next)}
								emptyHint={t`No products linked yet`}
							/>
						</ProfileGrid>
					</PanelWrap>
				</PriTabs.Panel>

				<PriTabs.Panel value='where'>
					<PanelWrap>
						<WherePanel company={company} />
					</PanelWrap>
				</PriTabs.Panel>

				<PriTabs.Panel value='contacts'>
					<PanelWrap>
						{contacts.length === 0 ? (
							<EmptyState
								title={t`No contacts yet`}
								description={t`Add the first decision-maker to keep track of who to reach.`}
							/>
						) : (
							<ContactList>
								{contacts.map(contact => (
									<ContactCard key={contact.id}>
										<ContactHeader>
											<ContactName>
												{contact.name}
												{contact.isDecisionMaker && (
													<DecisionBadge>
														<Trans>Decision maker</Trans>
													</DecisionBadge>
												)}
												{(contact.emailStatus === 'bounced' ||
													contact.emailStatus === 'complained') && (
													<SuppressionBadge
														data-testid={`contact-suppression-badge-${contact.id}`}
														$kind={contact.emailStatus}
													>
														<AlertTriangle size={10} aria-hidden />
														<span>
															{contact.emailStatus === 'bounced'
																? t`Bounced`
																: t`Complained`}
														</span>
													</SuppressionBadge>
												)}
											</ContactName>
											{contact.role && (
												<ContactRole>{contact.role}</ContactRole>
											)}
										</ContactHeader>
										{(contact.emailStatus === 'bounced' ||
											contact.emailStatus === 'complained') && (
											<SuppressionBanner
												role='alert'
												data-testid={`contact-suppression-banner-${contact.id}`}
												$kind={contact.emailStatus}
											>
												<AlertTriangle size={14} aria-hidden />
												<SuppressionText>
													<strong>
														{contact.emailStatus === 'bounced'
															? t`Email is dead-letter`
															: t`Recipient marked as spam`}
													</strong>
													{contact.emailStatusReason ? (
														<SuppressionReason>
															{contact.emailStatusReason}
														</SuppressionReason>
													) : null}
												</SuppressionText>
												<SuppressionAction
													type='button'
													data-testid={`contact-suppression-clear-${contact.id}`}
													onClick={() => {
														void handleClearSuppression(contact.id)
													}}
												>
													<Trans>Clear</Trans>
												</SuppressionAction>
											</SuppressionBanner>
										)}
										<ContactLinks>
											{contact.email && (
												<ContactLink href={`mailto:${contact.email}`}>
													<Mail size={14} aria-hidden />
													<span>{contact.email}</span>
												</ContactLink>
											)}
											<ContactLinkButton
												type='button'
												onClick={() =>
													handleEmailContact(contact.id, contact.email)
												}
											>
												<MailPlus size={14} aria-hidden />
												<span>
													<Trans>Email via Batuda</Trans>
												</span>
											</ContactLinkButton>
											{contact.phone && (
												<ContactLink href={`tel:${contact.phone}`}>
													<Phone size={14} aria-hidden />
													<span>{contact.phone}</span>
												</ContactLink>
											)}
											{contact.linkedin && (
												<ContactLink
													href={contact.linkedin}
													target='_blank'
													rel='noopener noreferrer'
												>
													<Briefcase size={14} aria-hidden />
													<span>
														<Trans>Profile</Trans>
													</span>
													<ExternalLink size={12} aria-hidden />
												</ContactLink>
											)}
										</ContactLinks>
									</ContactCard>
								))}
							</ContactList>
						)}
					</PanelWrap>
				</PriTabs.Panel>

				<PriTabs.Panel value='emails'>
					<PanelWrap>
						<EmailsPanelToolbar>
							<PriButton
								type='button'
								$variant='outlined'
								onClick={handleComposeEmail}
							>
								<MailPlus size={14} aria-hidden />
								<Trans>Compose</Trans>
							</PriButton>
						</EmailsPanelToolbar>
						{companyThreads.length === 0 ? (
							<EmptyState
								icon={Mail}
								title={t`No email threads yet`}
								description={t`Messages sent or received with this company will appear here.`}
							/>
						) : (
							<ThreadList>
								{companyThreads.map(thread => (
									<ThreadRow key={thread.id}>
										<ThreadTitle>
											<Link
												to='/emails/$threadId'
												params={{ threadId: thread.id }}
											>
												{thread.subject?.trim() || t`(no subject)`}
											</Link>
										</ThreadTitle>
										<ThreadMeta>
											<ThreadStatusBadge $status={thread.status}>
												{thread.status}
											</ThreadStatusBadge>
											<span>
												{thread.messageCount}{' '}
												{thread.messageCount === 1 ? t`msg` : t`msgs`}
											</span>
											<RelativeDate value={thread.updatedAt} />
										</ThreadMeta>
									</ThreadRow>
								))}
							</ThreadList>
						)}
					</PanelWrap>
				</PriTabs.Panel>

				<PriTabs.Panel value='tasks'>
					<PanelWrap>
						{tasks.length === 0 ? (
							<EmptyState title={t`No tasks for this company`} />
						) : (
							<TaskList>
								{tasks.map(task => (
									<TaskRow key={task.id} $completed={task.completedAt !== null}>
										<TaskTitle>{task.title}</TaskTitle>
										<TaskMeta>
											{task.completedAt !== null ? (
												<Trans>Completed</Trans>
											) : (
												<RelativeDate
													value={task.dueAt}
													fallback={t`no due date`}
												/>
											)}
										</TaskMeta>
									</TaskRow>
								))}
							</TaskList>
						)}
					</PanelWrap>
				</PriTabs.Panel>

				<PriTabs.Panel value='calendar'>
					<PanelWrap>
						<CalendarTab companyId={company.id} />
					</PanelWrap>
				</PriTabs.Panel>

				<PriTabs.Panel value='research'>
					<PanelWrap>
						<ResearchPanelLayout>
							<ResearchPanelHeader>
								<PriButton
									type='button'
									$variant='filled'
									data-testid='research-run-new'
									onClick={() => {
										setResearchDialogOpen(true)
									}}
								>
									<Plus size={14} aria-hidden />
									<span>
										<Trans>Run new research</Trans>
									</span>
								</PriButton>
							</ResearchPanelHeader>
							<ResearchPanelBody>
								<RunList
									runs={researchRuns}
									selectedId={selectedResearchId}
									onSelect={setSelectedResearchId}
								/>
								{selectedResearchId !== null ? (
									<RunDetail researchId={selectedResearchId} />
								) : null}
							</ResearchPanelBody>
						</ResearchPanelLayout>
					</PanelWrap>
				</PriTabs.Panel>

				<PriTabs.Panel value='pages'>
					<PanelWrap>
						{companyPages.length === 0 ? (
							<EmptyState
								icon={FileText}
								title={t`No pages yet`}
								description={t`Create a prospect landing page to share with this company.`}
							/>
						) : (
							<PagesList>
								{companyPages.map(pg => (
									<PageRow key={pg.id}>
										<PageRowTitle>
											<Link to='/pages/$id' params={{ id: pg.id }}>
												{pg.title}
											</Link>
										</PageRowTitle>
										<PageRowMeta>
											<PageLangBadge>{pg.lang}</PageLangBadge>
											<PageStatusBadge $published={pg.status === 'published'}>
												{pg.status}
											</PageStatusBadge>
										</PageRowMeta>
									</PageRow>
								))}
							</PagesList>
						)}
					</PanelWrap>
				</PriTabs.Panel>

				<PriTabs.Panel value='documents'>
					<PanelWrap>
						<EmptyState
							icon={FileText}
							title={t`No documents yet`}
							description={t`Proposals, meeting notes and attachments will show up here.`}
						/>
					</PanelWrap>
				</PriTabs.Panel>
			</PriTabs.Root>

			<ResearchDialog
				open={researchDialogOpen}
				onOpenChange={setResearchDialogOpen}
				companyId={company.id}
				onCreated={newId => {
					setSelectedResearchId(newId)
					refreshResearch()
				}}
			/>

			<TimelineSection>
				<PriCollapsible.Root defaultOpen>
					<PriCollapsible.Trigger>
						<ChevronRight size={14} aria-hidden />
						<Trans>Timeline</Trans>
					</PriCollapsible.Trigger>
					<PriCollapsible.Panel>
						<TimelinePanelInner>
							<TimelineToolbar>
								<SystemEventsToggle>
									<input
										type='checkbox'
										checked={showSystemEvents}
										onChange={e => setShowSystemEvents(e.target.checked)}
									/>
									<Trans>Show system events</Trans>
								</SystemEventsToggle>
							</TimelineToolbar>
							{visibleTimeline.length === 0 ? (
								<EmptyState
									title={t`No activity yet`}
									description={t`Emails, calls, documents, and proposals will appear here as they happen.`}
								/>
							) : (
								<TimelineList>
									{visibleTimeline.map(row => {
										const entry: TimelineEntryData = {
											id: row.id,
											channel: row.channel,
											subject: null,
											summary: row.summary,
											outcome: null,
											nextAction: null,
											date: row.date,
											threadId: null,
										}
										return <TimelineEntry key={row.id} entry={entry} />
									})}
								</TimelineList>
							)}
						</TimelinePanelInner>
					</PriCollapsible.Panel>
				</PriCollapsible.Root>
			</TimelineSection>
		</Page>
	)
}

// ── Narrowers ─────────────────────────────────────────────────────

function narrowCompany(raw: unknown): CompanyDetail | null {
	if (!raw || typeof raw !== 'object') return null
	const r = raw as Record<string, unknown>
	if (typeof r['id'] !== 'string') return null
	if (typeof r['slug'] !== 'string') return null
	if (typeof r['name'] !== 'string') return null
	if (typeof r['status'] !== 'string') return null
	const str = (key: string) =>
		typeof r[key] === 'string' ? (r[key] as string) : null
	const num = (key: string) =>
		typeof r[key] === 'number' ? (r[key] as number) : null
	// Postgres numeric columns (lat/lng) arrive as strings via the SQL
	// client; fall back to Number() when the raw value is a string.
	const numeric = (key: string): number | null => {
		const v = r[key]
		if (typeof v === 'number' && Number.isFinite(v)) return v
		if (typeof v === 'string') {
			const parsed = Number(v)
			return Number.isFinite(parsed) ? parsed : null
		}
		return null
	}
	const strArr = (key: string): ReadonlyArray<string> => {
		const raw = r[key]
		if (!Array.isArray(raw)) return []
		return raw.filter((v): v is string => typeof v === 'string')
	}
	return {
		id: r['id'],
		slug: r['slug'],
		name: r['name'],
		status: r['status'],
		industry: str('industry'),
		sizeRange: str('sizeRange'),
		region: str('region'),
		location: str('location'),
		source: str('source'),
		priority: num('priority'),
		website: str('website'),
		email: str('email'),
		phone: str('phone'),
		instagram: str('instagram'),
		linkedin: str('linkedin'),
		googleMapsUrl: str('googleMapsUrl'),
		painPoints: str('painPoints'),
		currentTools: str('currentTools'),
		nextAction: str('nextAction'),
		nextActionAt: str('nextActionAt'),
		lastContactedAt: str('lastContactedAt'),
		lastEmailAt: str('lastEmailAt'),
		lastCallAt: str('lastCallAt'),
		lastMeetingAt: str('lastMeetingAt'),
		nextCalendarEventAt: str('nextCalendarEventAt'),
		tags: strArr('tags'),
		productsFit: strArr('productsFit'),
		latitude: numeric('latitude'),
		longitude: numeric('longitude'),
		geocodedAt: str('geocodedAt'),
		geocodeSource: str('geocodeSource'),
	}
}

function narrowContacts(
	rows: ReadonlyArray<unknown>,
): ReadonlyArray<ContactRow> {
	const out: Array<ContactRow> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		if (typeof r['name'] !== 'string') continue
		const emailStatus =
			r['emailStatus'] === 'valid' ||
			r['emailStatus'] === 'bounced' ||
			r['emailStatus'] === 'complained'
				? r['emailStatus']
				: 'unknown'
		out.push({
			id: r['id'],
			name: r['name'],
			role: typeof r['role'] === 'string' ? r['role'] : null,
			isDecisionMaker: r['isDecisionMaker'] === true,
			email: typeof r['email'] === 'string' ? r['email'] : null,
			phone: typeof r['phone'] === 'string' ? r['phone'] : null,
			linkedin: typeof r['linkedin'] === 'string' ? r['linkedin'] : null,
			emailStatus,
			emailStatusReason:
				typeof r['emailStatusReason'] === 'string'
					? r['emailStatusReason']
					: null,
		})
	}
	return out
}

function timelineKindToChannel(kind: string, fallback: string | null): string {
	switch (kind) {
		case 'email_sent':
		case 'email_received':
			return 'email'
		case 'call_logged':
			return fallback ?? 'phone'
		case 'document_created':
			return 'document'
		case 'proposal_sent':
		case 'proposal_viewed':
		case 'proposal_responded':
			return 'proposal'
		case 'research_run':
			return 'research'
		case 'meeting_scheduled':
		case 'meeting_completed':
		case 'meeting_cancelled':
			return 'event'
		case 'system_event':
			return 'system'
		default:
			return fallback ?? 'other'
	}
}

function narrowTimeline(
	rows: ReadonlyArray<unknown>,
): ReadonlyArray<TimelineRow> {
	const out: Array<TimelineRow> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		if (typeof r['kind'] !== 'string') continue
		if (typeof r['entityType'] !== 'string') continue
		if (typeof r['entityId'] !== 'string') continue
		const occurredAt = r['occurredAt']
		if (typeof occurredAt !== 'string') continue
		const rawChannel = typeof r['channel'] === 'string' ? r['channel'] : null
		out.push({
			id: r['id'],
			kind: r['kind'],
			channel: timelineKindToChannel(r['kind'], rawChannel),
			date: occurredAt,
			summary: typeof r['summary'] === 'string' ? r['summary'] : null,
			entityType: r['entityType'],
			entityId: r['entityId'],
		})
	}
	out.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
	return out
}

function narrowTasks(rows: ReadonlyArray<unknown>): ReadonlyArray<TaskEntry> {
	const out: Array<TaskEntry> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		if (typeof r['title'] !== 'string') continue
		if (typeof r['type'] !== 'string') continue
		out.push({
			id: r['id'],
			title: r['title'],
			type: r['type'],
			dueAt: typeof r['dueAt'] === 'string' ? r['dueAt'] : null,
			completedAt:
				typeof r['completedAt'] === 'string' ? r['completedAt'] : null,
		})
	}
	return out
}

function narrowResearch(
	rows: ReadonlyArray<unknown>,
): ReadonlyArray<ResearchRunRow> {
	const out: Array<ResearchRunRow> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		if (typeof r['query'] !== 'string') continue
		if (typeof r['status'] !== 'string') continue
		const createdAt = r['createdAt']
		if (typeof createdAt !== 'string') continue
		out.push({
			id: r['id'],
			query: r['query'],
			schemaName: typeof r['schemaName'] === 'string' ? r['schemaName'] : null,
			kind: typeof r['kind'] === 'string' ? r['kind'] : 'leaf',
			status: r['status'],
			costCents: typeof r['costCents'] === 'number' ? r['costCents'] : 0,
			createdAt,
		})
	}
	return out
}

// ── Styles ────────────────────────────────────────────────────────

const Page = styled.div.withConfig({ displayName: 'CompanyDetailPage' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`

const Header = styled(motion.header).withConfig({
	displayName: 'CompanyDetailHeader',
})`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
	padding: var(--space-lg) var(--space-lg) var(--space-md);
	box-shadow: var(--elevation-workshop-md);
`

const IdentityRow = styled.div.withConfig({
	displayName: 'CompanyDetailIdentityRow',
})`
	display: flex;
	flex-wrap: wrap;
	align-items: flex-start;
	justify-content: space-between;
	gap: var(--space-md);
`

const Identity = styled.div.withConfig({
	displayName: 'CompanyDetailIdentity',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	min-width: 0;
	flex: 1 1 240px;
`

const Name = styled.h2.withConfig({ displayName: 'CompanyDetailName' })`
	${stenciledTitle}
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
	letter-spacing: 0.06em;
	margin: 0;
	overflow-wrap: anywhere;
`

const SubtitleText = styled.p.withConfig({
	displayName: 'CompanyDetailSubtitle',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const HeaderMeta = styled.div.withConfig({
	displayName: 'CompanyDetailHeaderMeta',
})`
	display: flex;
	align-items: center;
	gap: var(--space-sm);
`

const HeaderSelectTrigger = styled(Select.Trigger).withConfig({
	displayName: 'CompanyDetailHeaderSelectTrigger',
})`
	display: inline-flex;
	background: transparent;
	border: none;
	padding: 0;
	cursor: pointer;

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
		border-radius: var(--shape-2xs);
	}
`

const HeaderInlineButton = styled.button.withConfig({
	displayName: 'CompanyDetailHeaderInlineButton',
})`
	display: inline-flex;
	align-items: center;
	background: transparent;
	border: none;
	padding: 0;
	cursor: pointer;
	color: inherit;
	font: inherit;
`

const GhostPriorityDot = styled.span.withConfig({
	displayName: 'CompanyDetailGhostPriorityDot',
})`
	display: inline-block;
	width: 10px;
	height: 10px;
	flex-shrink: 0;
	border-radius: 50%;
	border: 1px dashed color-mix(in srgb, var(--color-on-surface) 35%, transparent);
	background: transparent;
	opacity: 0.6;

	${HeaderInlineButton}:hover & {
		opacity: 1;
	}
`

const HeaderChrome = styled.div.withConfig({
	displayName: 'CompanyDetailHeaderChrome',
})`
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
`

const ExternalLinks = styled.div.withConfig({
	displayName: 'CompanyDetailExternalLinks',
})`
	display: flex;
	align-items: center;
	gap: var(--space-2xs);
`

const ExternalLinkButton = styled.a.withConfig({
	displayName: 'CompanyDetailExternalLinkButton',
})`
	${brushedMetalBezel}
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2.25rem;
	height: 2.25rem;
	border-radius: 50%;
	color: var(--color-on-surface);
	transition: transform 160ms ease;

	& svg {
		position: relative;
		z-index: 1;
		filter: drop-shadow(0 1px 0 rgba(255, 255, 255, 0.4));
	}

	&:hover {
		transform: translateY(-1px);
		color: var(--color-primary);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const LastContact = styled.div.withConfig({
	displayName: 'CompanyDetailLastContact',
})`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	font-family: var(--font-body);
	font-size: var(--typescale-label-medium-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
`

const LastContactLabel = styled.span.withConfig({
	displayName: 'CompanyDetailLastContactLabel',
})`
	${stenciledTitle}
	font-style: normal;
	opacity: 0.75;
`

const PrimaryActions = styled.div.withConfig({
	displayName: 'CompanyDetailPrimaryActions',
})`
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-sm);
`

const PanelWrap = styled.div.withConfig({
	displayName: 'CompanyDetailPanelWrap',
})`
	padding: var(--space-md) 0;
`

const ResearchPanelLayout = styled.div.withConfig({
	displayName: 'CompanyDetailResearchPanelLayout',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
`

const ResearchPanelHeader = styled.div.withConfig({
	displayName: 'CompanyDetailResearchPanelHeader',
})`
	display: flex;
	justify-content: flex-end;
`

const ResearchPanelBody = styled.div.withConfig({
	displayName: 'CompanyDetailResearchPanelBody',
})`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-md);

	@media (min-width: 1024px) {
		grid-template-columns: minmax(18rem, 1fr) minmax(0, 2fr);
	}
`

const ProfileGrid = styled.div.withConfig({
	displayName: 'CompanyDetailProfileGrid',
})`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-md);

	@media (min-width: 768px) {
		grid-template-columns: 1fr 1fr;
	}
`

const CadenceBlock = styled.section.withConfig({
	displayName: 'CompanyDetailCadenceBlock',
})`
	${agedPaperSurface}
	position: relative;
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	margin-bottom: var(--space-lg);
	padding: var(--space-md) var(--space-md) var(--space-xs);

	/* Screw dot top-left — stamped log-plate feel */
	&::before {
		content: '';
		position: absolute;
		top: 6px;
		left: 6px;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: radial-gradient(
			circle at 35% 35%,
			var(--color-metal-dark),
			var(--color-metal-deep)
		);
	}

	&::after {
		content: '';
		position: absolute;
		top: 6px;
		right: 6px;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: radial-gradient(
			circle at 35% 35%,
			var(--color-metal-dark),
			var(--color-metal-deep)
		);
	}
`

const CadenceTitle = styled.h3.withConfig({
	displayName: 'CompanyDetailCadenceTitle',
})`
	${stenciledTitle}
	margin: 0;
	font-size: var(--typescale-label-medium-size);
	opacity: 0.85;
`

const CadenceGrid = styled.dl.withConfig({
	displayName: 'CompanyDetailCadenceGrid',
})`
	display: grid;
	grid-template-columns: 1fr;
	margin: 0;

	@media (min-width: 640px) {
		grid-template-columns: 1fr 1fr;
		column-gap: var(--space-lg);
	}
`

const CadenceRow = styled.div.withConfig({
	displayName: 'CompanyDetailCadenceRow',
})`
	${ruledLedgerRow}
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--space-sm);
	padding: var(--space-xs) 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface-variant);

	&:first-child,
	@media (min-width: 640px) {
		&:nth-child(2) {
			border-top: none;
		}
	}
`

const CadenceLabel = styled.dt.withConfig({
	displayName: 'CompanyDetailCadenceLabel',
})`
	${stenciledTitle}
	margin: 0;
	font-size: var(--typescale-label-small-size);
	opacity: 0.75;
`

const ContactList = styled.ul.withConfig({
	displayName: 'CompanyDetailContactList',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	list-style: none;
	padding: 0;
	margin: 0;
`

const ContactCard = styled.li.withConfig({
	displayName: 'CompanyDetailContactCard',
})`
	${agedPaperSurface}
	position: relative;
	display: flex;
	flex-direction: column;
	gap: var(--space-xs);
	padding: var(--space-md) var(--space-md) var(--space-sm);

	/* Paperclip corner */
	&::before {
		content: '';
		position: absolute;
		top: -4px;
		right: 18px;
		width: 14px;
		height: 28px;
		border: 2px solid rgba(120, 110, 95, 0.65);
		border-top-color: rgba(120, 110, 95, 0.9);
		border-radius: 6px 6px 3px 3px;
		background: linear-gradient(
			180deg,
			rgba(220, 210, 190, 0.4) 0%,
			rgba(180, 170, 150, 0.25) 100%
		);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
		pointer-events: none;
	}
`

const ContactHeader = styled.div.withConfig({
	displayName: 'CompanyDetailContactHeader',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const ContactName = styled.span.withConfig({
	displayName: 'CompanyDetailContactName',
})`
	${stenciledTitle}
	display: inline-flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-xs);
	font-size: var(--typescale-title-small-size);
	line-height: var(--typescale-title-small-line);
	letter-spacing: 0.04em;
	overflow-wrap: anywhere;
`

const DecisionBadge = styled.span.withConfig({
	displayName: 'CompanyDetailDecisionBadge',
})`
	${brushedMetalPlate}
	${stenciledTitle}
	display: inline-flex;
	padding: var(--space-3xs) var(--space-2xs);
	border-left: 3px solid var(--color-secondary);
	font-size: var(--typescale-label-small-size);
	transform: rotate(-0.5deg);
`

const SuppressionBadge = styled.span.withConfig({
	displayName: 'CompanyDetailSuppressionBadge',
	shouldForwardProp: prop => prop !== '$kind',
})<{ $kind: 'bounced' | 'complained' }>`
	${stenciledTitle}
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
	padding: var(--space-3xs) var(--space-2xs);
	border-radius: var(--shape-3xs);
	background: color-mix(in srgb, var(--color-error) 14%, transparent);
	color: var(--color-error);
	border: 1px dashed
		color-mix(in srgb, var(--color-error) 40%, transparent);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
`

const SuppressionBanner = styled.div.withConfig({
	displayName: 'CompanyDetailSuppressionBanner',
	shouldForwardProp: prop => prop !== '$kind',
})<{ $kind: 'bounced' | 'complained' }>`
	display: flex;
	align-items: center;
	gap: var(--space-2xs);
	margin: var(--space-2xs) 0;
	padding: var(--space-2xs) var(--space-sm);
	border-left: 3px solid var(--color-error);
	background: color-mix(in srgb, var(--color-error) 6%, transparent);
	color: var(--color-error);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
`

const SuppressionText = styled.span.withConfig({
	displayName: 'CompanyDetailSuppressionText',
})`
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const SuppressionReason = styled.span.withConfig({
	displayName: 'CompanyDetailSuppressionReason',
})`
	font-style: italic;
	font-size: var(--typescale-body-small-size);
	color: color-mix(in srgb, var(--color-error) 80%, var(--color-on-surface));
`

const SuppressionAction = styled.button.withConfig({
	displayName: 'CompanyDetailSuppressionAction',
})`
	${stenciledTitle}
	background: transparent;
	border: 1px dashed currentColor;
	color: var(--color-error);
	padding: var(--space-3xs) var(--space-2xs);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	cursor: pointer;

	&:hover {
		background: color-mix(in srgb, var(--color-error) 10%, transparent);
	}
`

const ContactRole = styled.span.withConfig({
	displayName: 'CompanyDetailContactRole',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	font-style: italic;
	color: var(--color-on-surface-variant);
`

const ContactLinks = styled.div.withConfig({
	displayName: 'CompanyDetailContactLinks',
})`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-sm);
`

const ContactLink = styled.a.withConfig({
	displayName: 'CompanyDetailContactLink',
})`
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
	padding: 2px 0;
	font-family: var(--font-body);
	font-size: var(--typescale-label-medium-size);
	color: var(--color-primary);
	text-decoration: none;
	border-bottom: 1px dashed color-mix(in srgb, var(--color-primary) 40%, transparent);

	&:hover {
		border-bottom-style: solid;
	}
`

const ContactLinkButton = styled.button.withConfig({
	displayName: 'CompanyDetailContactLinkButton',
})`
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
	padding: 2px 0;
	border: none;
	background: transparent;
	font-family: var(--font-body);
	font-size: var(--typescale-label-medium-size);
	color: var(--color-primary);
	cursor: pointer;
	border-bottom: 1px dashed color-mix(in srgb, var(--color-primary) 40%, transparent);

	&:hover {
		border-bottom-style: solid;
	}
`

const EmailsPanelToolbar = styled.div.withConfig({
	displayName: 'CompanyDetailEmailsPanelToolbar',
})`
	display: flex;
	justify-content: flex-end;
	margin-bottom: var(--space-sm);
`

const ThreadList = styled.ul.withConfig({
	displayName: 'CompanyDetailThreadList',
})`
	display: flex;
	flex-direction: column;
	gap: 0;
	list-style: none;
	padding: 0;
	margin: 0;
`

const ThreadRow = styled.li.withConfig({
	displayName: 'CompanyDetailThreadRow',
})`
	${ruledLedgerRow}
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	padding: var(--space-sm) var(--space-md);
	background-color: var(--color-paper-aged);

	&:first-child {
		border-top: 1px solid var(--color-ledger-line);
	}
`

const ThreadTitle = styled.span.withConfig({
	displayName: 'CompanyDetailThreadTitle',
})`
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;

	& a {
		color: var(--color-primary);
		font-weight: var(--font-weight-medium);
		text-decoration: none;
	}

	& a:hover {
		text-decoration: underline;
	}
`

const ThreadMeta = styled.div.withConfig({
	displayName: 'CompanyDetailThreadMeta',
})`
	display: flex;
	align-items: center;
	gap: var(--space-sm);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
	flex-shrink: 0;
`

const ThreadStatusBadge = styled.span.withConfig({
	displayName: 'CompanyDetailThreadStatusBadge',
	shouldForwardProp: prop => prop !== '$status',
})<{ $status: 'open' | 'closed' | 'archived' }>`
	padding: var(--space-3xs) var(--space-xs);
	border-radius: 4px;
	background: ${p =>
		p.$status === 'open'
			? 'color-mix(in oklab, var(--color-status-client) 20%, transparent)'
			: p.$status === 'closed'
				? 'color-mix(in oklab, var(--color-status-prospect) 20%, transparent)'
				: 'color-mix(in oklab, var(--color-on-surface) 12%, transparent)'};
	color: ${p =>
		p.$status === 'open'
			? 'var(--color-status-client)'
			: 'var(--color-on-surface-variant)'};
`

const TaskList = styled.ul.withConfig({
	displayName: 'CompanyDetailTaskList',
})`
	display: flex;
	flex-direction: column;
	gap: 0;
	list-style: none;
	padding: 0;
	margin: 0;
`

const TaskRow = styled.li.withConfig({
	displayName: 'CompanyDetailTaskRow',
	shouldForwardProp: prop => prop !== '$completed',
})<{ $completed: boolean }>`
	${ruledLedgerRow}
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	padding: var(--space-sm) var(--space-md);
	background-color: var(--color-paper-aged);
	opacity: ${p => (p.$completed ? 0.55 : 1)};

	&:first-child {
		border-top: 1px solid var(--color-ledger-line);
	}
`

const TaskTitle = styled.span.withConfig({
	displayName: 'CompanyDetailTaskTitle',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	color: var(--color-on-surface);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	min-width: 0;
`

const TaskMeta = styled.span.withConfig({
	displayName: 'CompanyDetailTaskMeta',
})`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
	flex-shrink: 0;
`

const TimelineSection = styled.section.withConfig({
	displayName: 'CompanyDetailTimelineSection',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
`

const TimelinePanelInner = styled.div.withConfig({
	displayName: 'CompanyDetailTimelinePanelInner',
})`
	padding: var(--space-sm) 0 0;
`

const TimelineToolbar = styled.div.withConfig({
	displayName: 'CompanyDetailTimelineToolbar',
})`
	display: flex;
	justify-content: flex-end;
	padding: 0 var(--space-md) var(--space-xs);
`

const SystemEventsToggle = styled.label.withConfig({
	displayName: 'CompanyDetailSystemEventsToggle',
})`
	${stenciledTitle}
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	font-size: var(--typescale-label-small-size);
	opacity: 0.75;
	cursor: pointer;
	user-select: none;

	input {
		accent-color: var(--color-primary);
		cursor: pointer;
	}
`

const TimelineList = styled.div.withConfig({
	displayName: 'CompanyDetailTimelineList',
})`
	display: flex;
	flex-direction: column;
	gap: 0;
`

const PagesList = styled.ul.withConfig({
	displayName: 'CompanyDetailPagesList',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	list-style: none;
	padding: 0;
	margin: 0;
`

const PageRow = styled.li.withConfig({ displayName: 'CompanyDetailPageRow' })`
	${agedPaperSurface}
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: var(--space-sm) var(--space-md);
	gap: var(--space-md);
`

const PageRowTitle = styled.span.withConfig({
	displayName: 'CompanyDetailPageRowTitle',
})`
	& a {
		color: var(--color-primary);
		font-weight: var(--font-weight-medium);
		text-decoration: none;
	}

	& a:hover {
		text-decoration: underline;
	}
`

const PageRowMeta = styled.div.withConfig({
	displayName: 'CompanyDetailPageRowMeta',
})`
	display: flex;
	align-items: center;
	gap: var(--space-xs);
`

const PageLangBadge = styled.span.withConfig({
	displayName: 'CompanyDetailPageLangBadge',
})`
	font-size: var(--typescale-label-small-size);
	text-transform: uppercase;
	letter-spacing: 0.06em;
	color: var(--color-on-surface-variant);
`

const PageStatusBadge = styled.span.withConfig({
	displayName: 'CompanyDetailPageStatusBadge',
	shouldForwardProp: prop => prop !== '$published',
})<{ $published: boolean }>`
	font-size: var(--typescale-label-small-size);
	text-transform: uppercase;
	letter-spacing: 0.06em;
	padding: var(--space-3xs) var(--space-xs);
	border-radius: 4px;
	background: ${p =>
		p.$published
			? 'color-mix(in oklab, var(--color-status-client) 20%, transparent)'
			: 'color-mix(in oklab, var(--color-status-prospect) 20%, transparent)'};
	color: ${p =>
		p.$published
			? 'var(--color-status-client)'
			: 'var(--color-on-surface-variant)'};
`
