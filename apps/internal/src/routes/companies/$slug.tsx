import { Select } from '@base-ui/react/select'
import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { useLingui as useLinguiBase } from '@lingui/react'
import { Trans, useLingui } from '@lingui/react/macro'
import {
	createFileRoute,
	Link,
	notFound,
	stripSearchParams,
	useNavigate,
} from '@tanstack/react-router'
import { DateTime, Schema } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import {
	AlertTriangle,
	BadgeCheck,
	Briefcase,
	CalendarClock,
	CalendarPlus,
	Camera,
	Check,
	ChevronRight,
	ExternalLink,
	FileText,
	Globe,
	Link2,
	Mail,
	MailPlus,
	MapPin,
	Pencil,
	Phone,
	Plus,
	Settings2,
	Trash2,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useMemo, useState } from 'react'
import styled from 'styled-components'

import type {
	CompanyDetail as CompanyDetailResponse,
	ContactListItem,
	TaskListItem,
} from '@batuda/controllers'
import { decidesPurchase } from '@batuda/domain'
import { Sidebar, Stack, Switcher } from '@batuda/ui'
import {
	PriButton,
	PriCollapsible,
	PriSelect,
	PriSwitch,
	PriTabs,
	usePriToast,
} from '@batuda/ui/pri'

import {
	companyAtomFor,
	companyTasksAtomFor,
	contactsAtomFor,
	deleteCompanyAtom,
	timelineAtomFor,
} from '#/atoms/company-atoms'
import { emailsSearchAtom } from '#/atoms/emails-atoms'
import { pagesSearchAtom } from '#/atoms/pages-atoms'
import { researchListAtom } from '#/atoms/research-atoms'
import { AboutSection } from '#/components/companies/about-section'
import { AccountBriefSection } from '#/components/companies/account-brief-section'
import { CadenceCard } from '#/components/companies/cadence-card'
import { CompanyChannelsSection } from '#/components/companies/company-channels-section'
import {
	CompanyFitSection,
	type FieldSource,
	type FitCheck,
	type FitConflict,
} from '#/components/companies/company-fit-section'
import { CompanyOwnerControl } from '#/components/companies/company-owner-control'
import {
	ConversationsTab,
	companyConversationsCalendarAtom,
	countCompanyConversationMeetings,
} from '#/components/companies/conversations-tab'
import {
	DocumentsPanel,
	documentsDlgMembers,
} from '#/components/companies/documents-panel'
import { FollowupDialog } from '#/components/companies/followup-dialog'
import { NextActionCard } from '#/components/companies/next-action-card'
import { OpenTasksCard } from '#/components/companies/open-tasks-card'
import {
	ProposalsPanel,
	proposalsDlgMembers,
} from '#/components/companies/proposals-panel'
import { ResearchSummaryCard } from '#/components/companies/research-summary-card'
import { UpcomingMeetingsCard } from '#/components/companies/upcoming-meetings-card'
import { WherePanel } from '#/components/companies/where-panel'
import { useBuyingRoleLabel } from '#/components/contacts/buying-role-label'
import { CHANNEL_ICON } from '#/components/contacts/channel-icons'
import {
	ContactEditDialog,
	type EditableContact,
} from '#/components/contacts/contact-edit-dialog'
import {
	channelHref,
	type DisplayChannel,
	type EmailChannelStatus,
	narrowChannels,
	primaryEmailChannel,
} from '#/components/contacts/display-channels'
import { ManageChannelsDialog } from '#/components/contacts/manage-channels-dialog'
import { useSetDocumentTitle } from '#/components/layout/top-bar-title'
import { Provenance } from '#/components/research/provenance'
import { ResearchDialog } from '#/components/research/research-dialog'
import {
	narrowResearch,
	type ResearchRunRow,
} from '#/components/research/run-shapes'
import { TrustBadge } from '#/components/research/trust-badge'
import { DeleteConfirm } from '#/components/shared/delete-confirm'
import { EmptyState } from '#/components/shared/empty-state'
import { ErrorState } from '#/components/shared/error-state'
import { LoadingSpinner } from '#/components/shared/loading-spinner'
import {
	PRIORITY_LEVELS,
	PriorityDot,
	priorityShortLabels,
} from '#/components/shared/priority-dot'
import { RelativeDate } from '#/components/shared/relative-date'
import { SrOnly } from '#/components/shared/sr-only'
import type { CompanyStatus } from '#/components/shared/status-badge'
import {
	asCompanyStatus,
	STATUS_ORDER,
	StatusBadge,
	statusLabels,
} from '#/components/shared/status-badge'
import {
	TimelineEntry,
	type TimelineEntryData,
} from '#/components/shared/timeline-entry'
import { ScrewDot } from '#/components/shared/workshop-decorations'
import { useComposeEmail } from '#/context/compose-email-context'
import { useQuickCapture } from '#/context/quick-capture-context'
import { useCompanyIndustries } from '#/hooks/use-company-industries'
import { dehydrateAtom } from '#/lib/atom-hydration'
import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import { languageName } from '#/lib/country-name'
import { dlgNoId, dlgWithId } from '#/lib/dlg-search'
import type { PaginatedList } from '#/lib/paginated-list'
import { validateSearchWith } from '#/lib/search-schema'
import { getServerCookieHeader } from '#/lib/server-cookie'
import { useTabSearchParam } from '#/lib/tab-search'
import { useDlg } from '#/lib/use-dlg'
import {
	agedPaperSurface,
	brushedMetalBezel,
	brushedMetalPlate,
	stenciledTitle,
} from '#/lib/workshop-mixins'

/**
 * Narrow shapes for the detail view. The server returns `Schema.Unknown`
 * so we runtime-narrow at the boundary (same pattern as the dashboard
 * and the list page). Promoting these to shared typed schemas is a
 * follow-up.
 */
// Where the "Schedule via Cal.com" button sends the operator to book a call.
// Native in-app scheduling is deferred; this opens Cal.com's own booking flow.
// Configurable per deploy; defaults to the Cal.com app.
const CAL_COM_URL = import.meta.env['VITE_CAL_COM_URL'] ?? 'https://app.cal.com'

type CompanyDetail = {
	readonly id: string
	readonly slug: string
	readonly name: string
	readonly status: string
	readonly ownerId: string | null
	readonly verifiedAt: string | null
	readonly industry: string | null
	readonly sizeRange: string | null
	readonly country: string | null
	readonly location: string | null
	readonly priority: number | null
	readonly channels: ReadonlyArray<DisplayChannel>
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
	readonly accountBrief: string | null
	readonly lastEnrichedAt: string | null
	readonly fitVerdict: string | null
	readonly fitChecks: ReadonlyArray<FitCheck> | null
	readonly fitConflicts: ReadonlyArray<FitConflict> | null
	readonly fieldProvenance: Readonly<Record<string, FieldSource>> | null
}

type ContactProvenance = {
	readonly runId: string
	readonly runCompletedAt: string | null
	readonly sources: ReadonlyArray<{ readonly url: string }>
}

type ContactRow = {
	readonly id: string
	readonly name: string
	readonly role: string | null
	readonly buyingRole: string | null
	readonly channels: ReadonlyArray<DisplayChannel>
	// Derived from the primary email channel for the send action + suppression UI.
	readonly email: string | null
	readonly emailStatus: EmailChannelStatus
	readonly emailStatusReason: string | null
	readonly notes: string | null
	// When this person in particular was last reached — the company-wide dates
	// say a touch happened, not who it was with.
	readonly lastEmailAt: string | null
	readonly lastCallAt: string | null
	readonly lastMeetingAt: string | null
	// Research runs this contact was sourced from, newest first.
	readonly provenance: ReadonlyArray<ContactProvenance>
}

type TimelineRow = {
	readonly id: string
	readonly kind: string
	readonly channel: string
	readonly date: string
	readonly summary: string | null
	readonly payload: Record<string, unknown> | null
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
	readonly company: (typeof CompanyDetailResponse)['Type']
	readonly contacts: PaginatedList<(typeof ContactListItem)['Type']>
	readonly tasks: PaginatedList<TaskListItem>
}

/**
 * Server-only: fetch the company row plus its contacts and tasks in
 * parallel. Dynamically imports the server client so Vite excludes it from
 * the client bundle; forwards the Better-Auth cookie via
 * `getRequestHeader('cookie')`.
 *
 * The relations go through a single `Effect.all` so they share one
 * Better-Auth session roundtrip but still run in parallel on the server.
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
			const emptyPage = {
				items: [],
				total: 0,
				limit: 0,
				offset: 0,
				hasMore: false,
			}
			return {
				company,
				contacts: emptyPage,
				tasks: emptyPage,
			} as DetailPayload
		}
		const [contacts, tasks] = yield* Effect.all(
			[
				// Matches `contactsAtomFor` exactly — the browser reuses what the
				// server already fetched by the shape of the question, so a
				// difference here means the page quietly asks again on arrival.
				client.contacts.list({ query: { companyId, count: 'exact' } }),
				client.tasks.list({ query: { companyId } }),
			],
			{ concurrency: 2 },
		)
		return { company, contacts, tasks } as DetailPayload
	})
	return Effect.runPromise(program)
}

function extractCompanyId(raw: unknown): string | null {
	if (!raw || typeof raw !== 'object') return null
	const id = (raw as Record<string, unknown>)['id']
	return typeof id === 'string' ? id : null
}

function extractCompanyName(raw: unknown): string | null {
	if (!raw || typeof raw !== 'object') return null
	const name = (raw as Record<string, unknown>)['name']
	return typeof name === 'string' ? name : null
}

const COMPANY_TABS = ['overview', 'conversations', 'people', 'files'] as const
type CompanyTab = (typeof COMPANY_TABS)[number]

// A research run, a contact, a document and a proposal all open through the one
// `?dlg=` param this page carries, so each kind is named for the thing it opens
// — two sharing a name would leave the second silently unreachable. Research
// needs no id, since the company comes from the route; the rest name a row that
// the panel owning them looks up in its own loaded list.
const contactDlgMembers = [
	dlgNoId('contact-new'),
	dlgWithId('contact-edit'),
	dlgWithId('channels'),
] as const

const companyDlgSchema = Schema.Union([
	dlgNoId('research'),
	...contactDlgMembers,
	...documentsDlgMembers,
	...proposalsDlgMembers,
])

const validateSearch = validateSearchWith({
	tab: Schema.Literals(COMPANY_TABS),
	dlg: companyDlgSchema,
})

export const Route = createFileRoute('/companies/$slug')({
	validateSearch,
	// Strip the default tab from the URL so `useTabSearchParam` can write
	// `tab: next` unconditionally without leaving `?tab=overview` behind.
	search: { middlewares: [stripSearchParams({ tab: 'overview' })] },
	loader: async ({ params: { slug } }) => {
		if (!import.meta.env.SSR) {
			// Client-side navigation: let the atoms refetch directly via
			// `BatudaApiAtom`. First render flashes the loading state while
			// the request is in flight — that's acceptable for parameterized
			// routes per the plan (Phase 5b.4.e option 1).
			return { dehydrated: [] as const, slug, name: null as string | null }
		}
		try {
			const payload = await loadDetailOnServer(slug)
			const companyId = extractCompanyId(payload.company)
			const name = extractCompanyName(payload.company)
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
					name,
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
						companyTasksAtomFor(companyId),
						AsyncResult.success(payload.tasks),
					),
				] as const,
				slug,
				name,
			}
		} catch (error) {
			// 404 from the server → propagate as a TanStack Router notFound.
			// Anything else (auth failure, network) falls back to empty
			// hydration and the component renders an error state.
			if (isNotFoundError(error)) {
				throw notFound()
			}
			console.warn('[CompanyDetailLoader] falling back:', error)
			return { dehydrated: [] as const, slug, name: null as string | null }
		}
	},
	// `head()` runs on the server with the loader's return value, so the
	// initial HTML response carries the right `<title>` for SSR + crawlers.
	// The component layer (useSetDocumentTitle) overrides afterwards when
	// the user toggles tabs, since `head()` doesn't react to search-param
	// changes within the same matched route.
	head: ({ loaderData, params }) => {
		const title = loaderData?.name ?? params.slug
		return { meta: [{ title: `${title} — Batuda` }] }
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

	if (AsyncResult.isFailure(companyResult)) {
		return (
			<Page>
				<ErrorState
					data-testid='company-error'
					headingLevel={1}
					title={t`Could not load this company`}
					description={t`The company could not be fetched. Check that the session is valid, then try again.`}
					onRetry={refreshCompany}
				/>
			</Page>
		)
	}

	// The request succeeded but the company came back in a shape we don't
	// recognise, so asking again would only return the same thing.
	if (company === null) {
		return (
			<Page>
				<ErrorState
					data-testid='company-shape-error'
					headingLevel={1}
					title={t`This company can't be displayed`}
					description={t`The details arrived in a form this page cannot read, so there is nothing to show. Go back to the list and open the company again; report it if it keeps happening.`}
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
	const buyingRoleLabel = useBuyingRoleLabel()
	const { labelFor } = useCompanyIndustries()
	const { open: openQuickCapture } = useQuickCapture()
	const { openCompose } = useComposeEmail()
	const [tab, setTab] = useTabSearchParam<CompanyTab>(COMPANY_TABS, 'overview')

	// Push the company name into the top bar + browser tab title so the
	// duplicated "Companies" page heading goes away on the detail page;
	// the sidebar already conveys the active section. Suffix the active
	// non-default tab so a deep-linked /companies/$slug?tab=conversations
	// reads as "Marisqueria · Conversations" in browser history.
	const tabLabel: Record<CompanyTab, string> = {
		overview: t`Overview`,
		conversations: t`Conversations`,
		people: t`People`,
		files: t`Files`,
	}
	const topBarTitle =
		tab === 'overview' ? company.name : `${company.name} · ${tabLabel[tab]}`
	useSetDocumentTitle(topBarTitle)

	const contactsAtom = useMemo(() => contactsAtomFor(company.id), [company.id])
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

	const refreshTimeline = useAtomRefresh(timelineAtom)
	const refreshContacts = useAtomRefresh(contactsAtom)
	const refreshTasks = useAtomRefresh(tasksAtom)
	const refreshPages = useAtomRefresh(companyPagesAtom)
	const refreshEmails = useAtomRefresh(companyEmailsAtom)

	// Each of these lists falls back to empty whenever it has not succeeded, so
	// without telling the three states apart a panel says "nothing here" both
	// while its data is still arriving and when the request failed outright.
	const contactsFailed = AsyncResult.isFailure(contactsResult)
	const timelineFailed = AsyncResult.isFailure(timelineResult)
	const pagesFailed = AsyncResult.isFailure(pagesResult)
	const tasksFailed = AsyncResult.isFailure(tasksResult)
	const emailsFailed = AsyncResult.isFailure(emailsResult)
	const researchFailed = AsyncResult.isFailure(researchResult)
	const contactsLoading = AsyncResult.isInitial(contactsResult)
	const timelineLoading = AsyncResult.isInitial(timelineResult)
	const pagesLoading = AsyncResult.isInitial(pagesResult)
	// A retry keeps the failed value and only marks it waiting, so this is the
	// only way to tell that pressing Retry actually started something.
	const contactsRetrying =
		contactsFailed && AsyncResult.isWaiting(contactsResult)
	const timelineRetrying =
		timelineFailed && AsyncResult.isWaiting(timelineResult)
	const pagesRetrying = pagesFailed && AsyncResult.isWaiting(pagesResult)
	const [followupOpen, setFollowupOpen] = useState(false)

	const toast = usePriToast()
	const { i18n } = useLinguiBase()
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

	const verifyCompany = useAtomSet(
		BatudaApiAtom.mutation('companies', 'verify'),
		{ mode: 'promiseExit' },
	)
	const handleVerify = useCallback(
		async (verified: boolean) => {
			const exit = await verifyCompany({
				params: { id: company.id },
				payload: { verified },
			} as never)
			if (exit._tag === 'Success') {
				refreshCompany()
				toast.add({
					title: verified
						? t`Marked as a verified lead`
						: t`Verification cleared`,
					type: 'success',
				})
				return
			}
			toast.add({ title: t`Could not update verification`, type: 'error' })
		},
		[verifyCompany, company.id, refreshCompany, toast, t],
	)

	const navigate = useNavigate()
	const deleteCompany = useAtomSet(deleteCompanyAtom, { mode: 'promiseExit' })
	const [deleteOpen, setDeleteOpen] = useState(false)
	const [deleting, setDeleting] = useState(false)
	const handleDelete = useCallback(async () => {
		setDeleting(true)
		const exit = await deleteCompany({
			params: { id: company.id },
		} as never)
		setDeleting(false)
		if (exit._tag === 'Success') {
			setDeleteOpen(false)
			// Back to the list: the page this was on no longer has anything to show,
			// and staying on it would leave a company open that is no longer there.
			toast.add({ title: t`Company deleted`, type: 'success' })
			void navigate({ to: '/companies' })
			return
		}
		toast.add({ title: t`Could not delete this company`, type: 'error' })
	}, [deleteCompany, company.id, navigate, toast, t])

	const handleStatusChange = useCallback(
		async (next: string) => {
			const prev = company.status
			await saveField('status', next)
			if (next === prev) return
			// Forward/active stages suggest the next action; terminal ones don't.
			const nudge =
				next === 'contacted'
					? t`Contacted — set the next action (a follow-up date).`
					: next === 'responded'
						? t`They responded — set the next action to keep it warm.`
						: next === 'meeting'
							? t`Meeting stage — set the next action (agenda, follow-up).`
							: next === 'proposal'
								? t`Proposal stage — set the next action (send it, chase a decision).`
								: next === 'client'
									? t`New client — set the next action (kick off onboarding).`
									: null
			if (nudge) toast.add({ title: nudge, type: 'info' })
		},
		[company.status, saveField, toast, t],
	)

	const statusOptions = useMemo(
		() => STATUS_ORDER.map(s => ({ value: s, label: i18n._(statusLabels[s]) })),
		[i18n],
	)
	const priorityOptions = useMemo(
		() =>
			PRIORITY_LEVELS.map(p => ({
				value: String(p),
				label: i18n._(priorityShortLabels[p]),
			})),
		[i18n],
	)

	const contacts = useMemo<ReadonlyArray<ContactRow>>(
		() =>
			AsyncResult.isSuccess(contactsResult)
				? narrowContacts(contactsResult.value.items)
				: [],
		[contactsResult],
	)
	const timelineEntries = useMemo<ReadonlyArray<TimelineRow>>(
		() =>
			AsyncResult.isSuccess(timelineResult)
				? narrowTimeline(timelineResult.value.items)
				: [],
		[timelineResult],
	)
	const tasks = useMemo<ReadonlyArray<TaskEntry>>(
		() =>
			AsyncResult.isSuccess(tasksResult)
				? narrowTasks(tasksResult.value.items)
				: [],
		[tasksResult],
	)
	const researchRuns = useMemo<ReadonlyArray<ResearchRunRow>>(
		() =>
			AsyncResult.isSuccess(researchResult)
				? narrowResearch(researchResult.value.items)
				: [],
		[researchResult],
	)

	// One `?dlg=` param serves every dialog on this page, so each one below asks
	// for its own kind rather than for "something is open".
	const { dlg, open: openDlg, close: closeDlg } = useDlg(companyDlgSchema)
	const researchDialogOpen = dlg?.kind === 'research'

	// Re-derived from the live list so the dialog reflects channel edits live.
	const manageChannelsContact =
		dlg?.kind === 'channels'
			? (contacts.find(c => c.id === dlg.id) ?? null)
			: null

	// Adding a contact names no row; editing one rebuilds the editable fields
	// from the loaded list, so a link reopens the same contact after a refresh.
	const editingContactRow =
		dlg?.kind === 'contact-edit'
			? (contacts.find(c => c.id === dlg.id) ?? null)
			: null
	// Held steady while the dialog is open: the form seeds itself from this value,
	// so handing it a fresh object on every render would wipe out whatever the
	// user had typed each time one of this page's other lists finished loading.
	const editingContactId = editingContactRow?.id ?? null
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the contact being edited, not the row object the list rebuilds on every refresh
	const editingContact: EditableContact | null = useMemo(
		() =>
			editingContactRow !== null
				? {
						id: editingContactRow.id,
						name: editingContactRow.name,
						role: editingContactRow.role,
						buyingRole: editingContactRow.buyingRole,
					}
				: null,
		[editingContactId],
	)
	const contactDialogOpen =
		dlg?.kind === 'contact-new' || editingContact !== null

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
		for (const row of pagesResult.value.items as ReadonlyArray<unknown>) {
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
		readonly externalThreadId: string
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
			if (typeof r['externalThreadId'] !== 'string') continue
			const status = r['status']
			if (status !== 'open' && status !== 'closed' && status !== 'archived') {
				continue
			}
			out.push({
				id: r['id'],
				externalThreadId: r['externalThreadId'],
				subject: typeof r['subject'] === 'string' ? r['subject'] : null,
				status,
				updatedAt: dateToIsoOrNull(r['updatedAt']) ?? new Date(0).toISOString(),
				messageCount:
					typeof r['messageCount'] === 'number' ? r['messageCount'] : 0,
			})
		}
		return out
	}, [emailsResult])

	// Real-world interactions (email/call/meeting/note/etc.) drawn from
	// the polymorphic timeline. System events (research runs, automated
	// task creation) are excluded — they're noise in the conversations
	// view and stay reachable via the Overview Timeline toggle.
	const conversationInteractions = useMemo(
		() =>
			timelineEntries
				.filter(
					entry =>
						entry.kind !== 'system_event' &&
						entry.kind !== 'stage_changed' &&
						entry.kind !== 'company_deleted' &&
						entry.kind !== 'company_restored',
				)
				.map(entry => ({
					id: entry.id,
					channel: entry.channel,
					summary: entry.summary,
					occurredAt: entry.date,
				})),
		[timelineEntries],
	)

	// Tab badges count what is on file, not what this page managed to fetch: a
	// company with more people than one page holds would otherwise advertise the
	// page size as its headcount.
	const contactsTotal = AsyncResult.isSuccess(contactsResult)
		? contactsResult.value.total
		: contacts.length
	const companyPagesTotal = AsyncResult.isSuccess(pagesResult)
		? pagesResult.value.total
		: companyPages.length

	// The meetings shown in the Conversations tab, read through the same request
	// the tab itself makes, so counting them here costs nothing extra.
	const conversationMeetingsAtom = useMemo(
		() => companyConversationsCalendarAtom(company.id),
		[company.id],
	)
	const conversationMeetingsResult = useAtomValue(conversationMeetingsAtom)
	const conversationMeetingCount = AsyncResult.isSuccess(
		conversationMeetingsResult,
	)
		? countCompanyConversationMeetings(conversationMeetingsResult.value.items)
		: 0

	// Sum of every kind feeding the Conversations tab, meetings included, so the
	// badge and the list it labels describe the same set of things.
	const conversationsCount =
		conversationInteractions.length +
		companyThreads.length +
		tasks.length +
		conversationMeetingCount

	const openTasks = useMemo(
		() =>
			tasks
				.filter(task => task.completedAt === null)
				.slice()
				.sort((a, b) => {
					const da = a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY
					const db = b.dueAt ? Date.parse(b.dueAt) : Number.POSITIVE_INFINITY
					return da - db
				}),
		[tasks],
	)

	const [showSystemEvents, setShowSystemEvents] = useState(false)
	const visibleTimeline = useMemo(
		() =>
			showSystemEvents
				? timelineEntries
				: timelineEntries.filter(
						entry =>
							entry.kind !== 'system_event' &&
							entry.kind !== 'company_deleted' &&
							entry.kind !== 'company_restored',
					),
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

	const clearCompanySuppression = useAtomSet(
		BatudaApiAtom.mutation('companies', 'clearSuppression'),
		{ mode: 'promiseExit' },
	)
	const handleClearCompanySuppression = useCallback(async () => {
		const exit = await clearCompanySuppression({
			params: { id: company.id },
		} as never)
		if (exit._tag === 'Success') {
			refreshCompany()
			return
		}
		toast.add({
			title: t`Could not clear suppression`,
			description: t`The change didn't go through. Try again.`,
			type: 'error',
		})
		console.error('[batuda] companies.clearSuppression failed', exit.cause)
	}, [clearCompanySuppression, company.id, refreshCompany, toast, t])

	// Both the interactions feed and the company row become stale after
	// Quick Capture submits — the server copies nextAction + lastContactedAt
	// onto the company in the same transaction as the interaction insert.
	const handleLogInteraction = useCallback(() => {
		openQuickCapture({
			companyId: company.id,
			companyName: company.name,
			onSubmitted: () => {
				refreshTimeline()
				refreshCompany()
			},
		})
	}, [
		openQuickCapture,
		company.id,
		company.name,
		refreshTimeline,
		refreshCompany,
	])

	// The row carries the trade's web-address form; the name is what to read.
	const subtitleParts = [company.location, labelFor(company.industry)].filter(
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
										data-testid='company-priority-trigger'
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
								void handleStatusChange(next)
							}}
						>
							<HeaderSelectTrigger
								render={
									<HeaderInlineButton
										type='button'
										aria-label={t`Change status`}
										data-testid='company-status-trigger'
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
												<PriSelect.Item
													key={opt.value}
													value={opt.value}
													data-testid={`company-status-option-${opt.value}`}
												>
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
						<CompanyOwnerControl
							companyId={company.id}
							ownerId={company.ownerId}
							onChanged={refreshCompany}
						/>
						{company.verifiedAt !== null ? (
							<VerifiedControl
								type='button'
								data-testid='company-verified'
								$verified
								onClick={() => void handleVerify(false)}
								title={t`Verified lead — click to clear`}
							>
								<BadgeCheck size={14} aria-hidden />
								<Trans>Verified lead</Trans>
							</VerifiedControl>
						) : (
							<VerifiedControl
								type='button'
								data-testid='company-verify'
								onClick={() => void handleVerify(true)}
							>
								<BadgeCheck size={14} aria-hidden />
								<Trans>Mark as verified</Trans>
							</VerifiedControl>
						)}
						<VerifiedControl
							type='button'
							data-testid='company-delete'
							// Named with the company, so it is clear what is about to go.
							// No title: it only appears on hover, which leaves it out of
							// reach on a phone and for anybody on the keyboard, and the
							// dialog says the same thing where everybody can read it.
							aria-label={t`Delete ${company.name}`}
							onClick={() => setDeleteOpen(true)}
						>
							<Trash2 size={14} aria-hidden />
							<Trans>Delete</Trans>
						</VerifiedControl>
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
								as='button'
								type='button'
								data-testid='company-email-compose'
								aria-label={t`Send email`}
								onClick={() =>
									openCompose({
										mode: 'new',
										companyId: company.id,
										...(company.email ? { to: company.email } : {}),
									})
								}
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
						<ExternalLinkButton
							href={CAL_COM_URL}
							target='_blank'
							rel='noopener noreferrer'
							data-testid='company-schedule-cal'
							aria-label={t`Schedule a call via Cal.com`}
						>
							<CalendarPlus size={16} aria-hidden />
						</ExternalLinkButton>
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

				<DeleteConfirm
					open={deleteOpen}
					deleting={deleting}
					onConfirm={() => void handleDelete()}
					onClose={() => setDeleteOpen(false)}
					testId='company-delete-confirm'
					title={<Trans>Delete this company?</Trans>}
					description={
						<Trans>
							It comes off the lists and the pipeline, and its people go with
							it. Its history is kept, and you can put it back from the Deleted
							filter on the companies page.
						</Trans>
					}
				/>

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
						data-testid='action-followup'
						onClick={() => setFollowupOpen(true)}
					>
						<CalendarClock size={16} aria-hidden />
						<Trans>Follow up</Trans>
					</PriButton>
				</PrimaryActions>
			</Header>

			<PriTabs.Root value={tab} onValueChange={v => setTab(v as CompanyTab)}>
				<PriTabs.List>
					<PriTabs.Tab value='overview' data-testid='company-overview-tab'>
						<Trans>Overview</Trans>
					</PriTabs.Tab>
					<PriTabs.Tab
						value='conversations'
						data-testid='company-conversations-tab'
					>
						<Trans>Conversations</Trans> ({conversationsCount})
					</PriTabs.Tab>
					<PriTabs.Tab value='people' data-testid='company-people-tab'>
						<Trans>People</Trans> ({contactsTotal})
					</PriTabs.Tab>
					<PriTabs.Tab value='files' data-testid='company-files-tab'>
						<Trans>Files</Trans> ({companyPagesTotal})
					</PriTabs.Tab>
					<PriTabs.Indicator />
				</PriTabs.List>

				<PriTabs.Panel value='overview'>
					<PanelWrap>
						<Stack $gap='lg'>
							<Switcher $threshold='48rem' $gap='md'>
								<NextActionCard
									value={company.nextAction}
									dueAt={company.nextActionAt}
									onSave={next => saveField('nextAction', next)}
								/>
								<CadenceCard
									lastEmailAt={company.lastEmailAt}
									lastCallAt={company.lastCallAt}
									lastMeetingAt={company.lastMeetingAt}
									nextCalendarEventAt={company.nextCalendarEventAt}
									onLogInteraction={handleLogInteraction}
								/>
								<UpcomingMeetingsCard companyId={company.id} />
							</Switcher>
							<Sidebar
								$side='right'
								$sideWidth='22rem'
								$contentMin='50%'
								$gap='md'
							>
								<Stack $gap='md'>
									{/* The notes on the account lead the tab: they are what a
									    person came to read, and the widest column is the only
									    one prose fits in. */}
									<AccountBriefSection
										company={company}
										onSave={(field, next) => saveField(field, next)}
									/>
									{tasksFailed ? (
										<ErrorState
											data-testid='company-tasks-error'
											variant='inline'
											title={t`Could not load tasks`}
											description={t`The tasks for this company could not be fetched. Check that the session is valid, then try again.`}
											onRetry={refreshTasks}
										/>
									) : (
										<OpenTasksCard tasks={openTasks} />
									)}
									<OverviewTimeline data-testid='company-overview-timeline'>
										<PriCollapsible.Root defaultOpen>
											<TimelineTrigger>
												<ChevronRight size={14} aria-hidden />
												<Trans>Timeline</Trans>
											</TimelineTrigger>
											{/* This panel starts open, so staying findable while
											    folded buys nothing — and it holds a status line read
											    aloud, which would go on announcing from a folded
											    section. */}
											<PriCollapsible.Panel hiddenUntilFound={false}>
												<TimelinePanelInner>
													<TimelineToolbar>
														<SystemEventsToggle>
															<PriSwitch.Root
																checked={showSystemEvents}
																onCheckedChange={setShowSystemEvents}
																data-testid='company-timeline-system-events'
															>
																<PriSwitch.Thumb />
															</PriSwitch.Root>
															<Trans>Show system events</Trans>
														</SystemEventsToggle>
													</TimelineToolbar>
													{/* Mounted whatever the state, because a live region that appears
													    together with its text is announced unreliably. */}
													<SrOnly role='status'>
														{timelineLoading
															? ''
															: timelineRetrying
																? t`Trying again…`
																: timelineFailed
																	? ''
																	: t`Activity loaded: ${visibleTimeline.length}`}
													</SrOnly>
													{timelineLoading ? (
														<LoadingSpinner />
													) : timelineFailed ? (
														<ErrorState
															data-testid='company-timeline-error'
															variant='inline'
															title={t`Could not load activity`}
															description={t`The activity for this company could not be fetched. Check that the session is valid, then try again.`}
															onRetry={refreshTimeline}
														/>
													) : visibleTimeline.length === 0 ? (
														<EmptyState
															title={t`No activity yet`}
															description={t`Emails, calls, documents, and proposals will appear here as they happen.`}
														/>
													) : (
														<TimelineList>
															{visibleTimeline.map(row => (
																<TimelineEntry
																	key={row.id}
																	entry={toTimelineEntry(row, {
																		stageChangedLabel: t`Stage changed`,
																		companyDeletedLabel: t`Company deleted`,
																		companyRestoredLabel: t`Company restored`,
																		describePeopleAffected: count =>
																			count === 1
																				? t`1 person went with it`
																				: t`${count} people went with it`,
																		describeStageChange: (from, to) =>
																			`${i18n._(statusLabels[from])} → ${i18n._(statusLabels[to])}`,
																	})}
																/>
															))}
														</TimelineList>
													)}
												</TimelinePanelInner>
											</PriCollapsible.Panel>
										</PriCollapsible.Root>
									</OverviewTimeline>
								</Stack>
								<Stack $gap='md'>
									{researchFailed ? (
										<ErrorState
											data-testid='company-research-error'
											variant='inline'
											title={t`Could not load research`}
											description={t`The research runs for this company could not be fetched. Check that the session is valid, then try again.`}
											onRetry={refreshResearch}
										/>
									) : (
										<ResearchSummaryCard
											runs={researchRuns}
											lastEnrichedAt={company.lastEnrichedAt}
											onRunNew={() => openDlg({ kind: 'research' })}
										/>
									)}
									<CompanyChannelsSection
										channels={company.channels}
										onClearSuppression={handleClearCompanySuppression}
										onEmail={address =>
											openCompose({
												mode: 'new',
												companyId: company.id,
												to: address,
											})
										}
									/>
									<WherePanel company={company} compact />
									<CompanyFitSection company={company} />
									<AboutSection
										company={company}
										onSave={(field, next) => saveField(field, next)}
									/>
								</Stack>
							</Sidebar>
						</Stack>
					</PanelWrap>
				</PriTabs.Panel>

				<PriTabs.Panel value='people'>
					<PanelWrap>
						<PeopleHeader>
							<PriButton
								type='button'
								$variant='outlined'
								data-testid='company-add-contact'
								onClick={() => openDlg({ kind: 'contact-new' })}
							>
								<Plus size={14} aria-hidden />
								<Trans>Add contact</Trans>
							</PriButton>
						</PeopleHeader>
						{/* Mounted whatever the state, because a live region that appears
						    together with its text is announced unreliably. */}
						<SrOnly role='status'>
							{contactsLoading
								? ''
								: contactsRetrying
									? t`Trying again…`
									: contactsFailed
										? ''
										: t`Contacts loaded: ${contacts.length}`}
						</SrOnly>
						{contactsLoading ? (
							<LoadingSpinner />
						) : contactsFailed ? (
							<ErrorState
								data-testid='company-contacts-error'
								variant='inline'
								title={t`Could not load contacts`}
								description={t`The people at this company could not be fetched. Check that the session is valid, then try again.`}
								onRetry={refreshContacts}
							/>
						) : contacts.length === 0 ? (
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
												{buyingRoleLabel(contact.buyingRole) !== null && (
													<DecisionBadge
														$decides={decidesPurchase(contact.buyingRole)}
													>
														{buyingRoleLabel(contact.buyingRole)}
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
												{/* Form action survives the React 19 hydration race
												    that drops onClick handlers on freshly hot-built
												    dev bundles — clicks on the Clear button were
												    landing before the listener attached. */}
												<form
													action={async () => {
														await handleClearSuppression(contact.id)
													}}
												>
													<SuppressionAction
														type='submit'
														data-testid={`contact-suppression-clear-${contact.id}`}
													>
														<Trans>Clear</Trans>
													</SuppressionAction>
												</form>
											</SuppressionBanner>
										)}
										<ContactLinks>
											{contact.channels.map(ch => {
												const Icon = CHANNEL_ICON[ch.kind] ?? Link2
												const { href, external } = channelHref(
													ch.kind,
													ch.value,
												)
												// Only research-touched channels carry a verdict or
												// confidence — a hand-typed one shows no badge.
												const hasTrust =
													ch.verification !== null || ch.confidence !== null
												return (
													<ChannelGroup key={ch.id}>
														<ContactLink
															href={href}
															{...(external
																? {
																		target: '_blank',
																		rel: 'noopener noreferrer',
																	}
																: {})}
														>
															<Icon size={14} aria-hidden />
															<span>{ch.value}</span>
															{external && (
																<ExternalLink size={12} aria-hidden />
															)}
														</ContactLink>
														{ch.label ? (
															<ChannelLabel>{ch.label}</ChannelLabel>
														) : null}
														{hasTrust ? (
															<TrustBadge
																verification={ch.verification}
																confidence={ch.confidence}
																machineCheckable={
																	ch.kind === 'email' || ch.kind === 'phone'
																}
															/>
														) : null}
													</ChannelGroup>
												)
											})}
											{contact.email && (
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
											)}
											<ContactLinkButton
												type='button'
												data-testid={`contact-edit-${contact.id}`}
												onClick={() =>
													openDlg({ kind: 'contact-edit', id: contact.id })
												}
											>
												<Pencil size={14} aria-hidden />
												<span>
													<Trans>Edit</Trans>
												</span>
											</ContactLinkButton>
											<ContactLinkButton
												type='button'
												data-testid={`contact-channels-${contact.id}`}
												onClick={() =>
													openDlg({ kind: 'channels', id: contact.id })
												}
											>
												<Settings2 size={14} aria-hidden />
												<span>
													<Trans>Manage channels</Trans>
												</span>
											</ContactLinkButton>
										</ContactLinks>
										{contact.lastEmailAt !== null ||
										contact.lastCallAt !== null ||
										contact.lastMeetingAt !== null ? (
											<ContactCadence
												data-testid={`contact-cadence-${contact.id}`}
											>
												<ContactCadenceItem>
													<Trans>Last email</Trans>{' '}
													<RelativeDate
														value={contact.lastEmailAt}
														fallback={t`never`}
													/>
												</ContactCadenceItem>
												<ContactCadenceItem>
													<Trans>Last call</Trans>{' '}
													<RelativeDate
														value={contact.lastCallAt}
														fallback={t`never`}
													/>
												</ContactCadenceItem>
												<ContactCadenceItem>
													<Trans>Last meet</Trans>{' '}
													<RelativeDate
														value={contact.lastMeetingAt}
														fallback={t`never`}
													/>
												</ContactCadenceItem>
											</ContactCadence>
										) : null}
										{contact.notes !== null && contact.notes.trim() !== '' ? (
											<ContactNotes data-testid={`contact-notes-${contact.id}`}>
												{contact.notes}
											</ContactNotes>
										) : null}
										{contact.provenance.length > 0 ? (
											<Provenance
												date={contact.provenance[0]?.runCompletedAt ?? null}
												sources={contact.provenance.flatMap(p => p.sources)}
											/>
										) : null}
									</ContactCard>
								))}
							</ContactList>
						)}
					</PanelWrap>
				</PriTabs.Panel>

				<PriTabs.Panel value='conversations'>
					<PanelWrap>
						<ConversationsTab
							companyId={company.id}
							interactions={conversationInteractions}
							threads={companyThreads}
							threadsFailed={emailsFailed}
							onRetryThreads={refreshEmails}
							tasks={tasks}
							onCompose={handleComposeEmail}
						/>
					</PanelWrap>
				</PriTabs.Panel>

				<PriTabs.Panel value='files'>
					<PanelWrap>
						<Stack $gap='lg'>
							<FilesGroup>
								<FilesGroupTitle>
									<Trans>Pages</Trans>
								</FilesGroupTitle>
								{/* Mounted whatever the state, because a live region that appears
								    together with its text is announced unreliably. */}
								<SrOnly role='status'>
									{pagesLoading
										? ''
										: pagesRetrying
											? t`Trying again…`
											: pagesFailed
												? ''
												: t`Pages loaded: ${companyPages.length}`}
								</SrOnly>
								{pagesLoading ? (
									<LoadingSpinner />
								) : pagesFailed ? (
									<ErrorState
										data-testid='company-pages-error'
										variant='inline'
										title={t`Could not load pages`}
										description={t`The pages for this company could not be fetched. Check that the session is valid, then try again.`}
										onRetry={refreshPages}
									/>
								) : companyPages.length === 0 ? (
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
													{/* A language chip reads as a code the world over, so
													    it stays one, with the full name for anyone who
													    does not recognise it. The state beside it is a
													    word, and a word has to be in the reader's own. */}
													<PageLangBadge
														title={
															languageName(pg.lang, i18n.locale) ?? undefined
														}
													>
														{pg.lang.toUpperCase()}
													</PageLangBadge>
													<PageStatusBadge
														$published={pg.status === 'published'}
													>
														{pg.status === 'published'
															? t`Published`
															: t`Draft`}
													</PageStatusBadge>
												</PageRowMeta>
											</PageRow>
										))}
									</PagesList>
								)}
							</FilesGroup>
							<FilesGroup>
								<FilesGroupTitle>
									<Trans>Documents</Trans>
								</FilesGroupTitle>
								<DocumentsPanel
									subjectTable='companies'
									subjectId={company.id}
								/>
							</FilesGroup>
							<FilesGroup>
								<FilesGroupTitle>
									<Trans>Proposals</Trans>
								</FilesGroupTitle>
								<ProposalsPanel companyId={company.id} />
							</FilesGroup>
						</Stack>
					</PanelWrap>
				</PriTabs.Panel>
			</PriTabs.Root>

			<ResearchDialog
				open={researchDialogOpen}
				onOpenChange={next => {
					if (!next) closeDlg()
				}}
				companyId={company.id}
				onCreated={() => {
					refreshResearch()
				}}
			/>
			<ManageChannelsDialog
				contactId={manageChannelsContact?.id ?? null}
				contactName={manageChannelsContact?.name ?? ''}
				channels={manageChannelsContact?.channels ?? []}
				onClose={closeDlg}
				onChanged={refreshContacts}
			/>

			<ContactEditDialog
				open={contactDialogOpen}
				companyId={company.id}
				contact={editingContact}
				onClose={closeDlg}
				onSaved={refreshContacts}
			/>

			<FollowupDialog
				open={followupOpen}
				companyId={company.id}
				onClose={() => setFollowupOpen(false)}
				onSaved={() => {
					refreshTasks()
					refreshTimeline()
				}}
			/>
		</Page>
	)
}

// ── Narrowers ─────────────────────────────────────────────────────

// Typed date fields decode to DateTime.Utc on the wire; fall back to their
// string form for anything already an ISO string.
function dateToIsoOrNull(value: unknown): string | null {
	if (typeof value === 'string') return value
	if (DateTime.isDateTime(value)) return DateTime.formatIso(value)
	return null
}

function narrowCompany(raw: unknown): CompanyDetail | null {
	if (!raw || typeof raw !== 'object') return null
	const r = raw as Record<string, unknown>
	if (typeof r['id'] !== 'string') return null
	if (typeof r['slug'] !== 'string') return null
	if (typeof r['name'] !== 'string') return null
	if (typeof r['status'] !== 'string') return null
	// Typed date fields (verifiedAt, lastContactedAt, …) decode to DateTime.Utc
	// on the wire; convert those back to an ISO string while leaving plain
	// string fields untouched.
	const str = (key: string) => {
		const v = r[key]
		if (typeof v === 'string') return v
		if (DateTime.isDateTime(v)) return DateTime.formatIso(v)
		return null
	}
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
	// How to reach the company is no longer a column each: a company can hold
	// several mailboxes, numbers and handles — one per shop, one per office — so
	// they arrive as a list. The header shows one of each, which is the one marked
	// primary. The server hands the list back with those first, so the first match
	// of a kind is the one to show.
	const channel = (kind: string): string | null => {
		const list = r['channels']
		if (!Array.isArray(list)) return null
		for (const entry of list) {
			if (!entry || typeof entry !== 'object') continue
			const row = entry as Record<string, unknown>
			if (row['kind'] !== kind) continue
			const value = row['value']
			if (typeof value === 'string' && value.trim() !== '') return value
		}
		return null
	}
	return {
		id: r['id'],
		slug: r['slug'],
		name: r['name'],
		status: r['status'],
		ownerId: str('ownerId'),
		verifiedAt: str('verifiedAt'),
		industry: str('industry'),
		sizeRange: str('sizeRange'),
		country: str('country'),
		location: str('location'),
		priority: num('priority'),
		// The fields below hold one of each kind; keeping the whole list is the
		// only way a second mailbox is ever seen.
		channels: narrowChannels(r['channels']),
		website: channel('website'),
		email: channel('email'),
		phone: channel('phone'),
		instagram: channel('instagram'),
		linkedin: channel('linkedin'),
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
		accountBrief: str('accountBrief'),
		lastEnrichedAt: str('lastEnrichedAt'),
		fitVerdict: str('fitVerdict'),
		fitChecks: fitCheckList(r['fitChecks']),
		fitConflicts: fitConflictList(r['fitConflicts']),
		fieldProvenance: fieldSourceMap(r['fieldProvenance']),
	}
}

const optionalText = (raw: unknown, key: string): string | undefined => {
	const value = (raw as Record<string, unknown>)[key]
	return typeof value === 'string' && value !== '' ? value : undefined
}

function fitCheckList(raw: unknown): ReadonlyArray<FitCheck> | null {
	if (!Array.isArray(raw)) return null
	const out: Array<FitCheck> = []
	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') continue
		const e = entry as Record<string, unknown>
		if (typeof e['criterion'] !== 'string') continue
		if (typeof e['result'] !== 'string') continue
		out.push({
			criterion: e['criterion'],
			result: e['result'],
			evidenceQuote: optionalText(e, 'evidence_quote'),
			sourceId: optionalText(e, 'source_id'),
		})
	}
	return out
}

function fitConflictList(raw: unknown): ReadonlyArray<FitConflict> | null {
	if (!Array.isArray(raw)) return null
	const out: Array<FitConflict> = []
	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') continue
		const e = entry as Record<string, unknown>
		if (typeof e['field'] !== 'string') continue
		if (typeof e['value'] !== 'string') continue
		out.push({
			field: e['field'],
			value: e['value'],
			sourceId: optionalText(e, 'source_id'),
			note: optionalText(e, 'note'),
		})
	}
	return out
}

function fieldSourceMap(
	raw: unknown,
): Readonly<Record<string, FieldSource>> | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
	const out: Record<string, FieldSource> = {}
	for (const [field, entry] of Object.entries(raw)) {
		if (!entry || typeof entry !== 'object') continue
		const e = entry as Record<string, unknown>
		if (typeof e['sourceUrl'] !== 'string') continue
		if (typeof e['runId'] !== 'string') continue
		out[field] = {
			sourceUrl: e['sourceUrl'],
			runId: e['runId'],
			confidence:
				typeof e['confidence'] === 'number' ? e['confidence'] : undefined,
			asOf: optionalText(e, 'asOf'),
		}
	}
	return out
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
		const channels = narrowChannels(r['channels'])
		const primaryEmail = primaryEmailChannel(channels)
		out.push({
			id: r['id'],
			name: r['name'],
			role: typeof r['role'] === 'string' ? r['role'] : null,
			buyingRole: typeof r['buyingRole'] === 'string' ? r['buyingRole'] : null,
			channels,
			email: primaryEmail?.value ?? null,
			emailStatus: primaryEmail?.status ?? 'unknown',
			emailStatusReason: primaryEmail?.statusReason ?? null,
			notes: typeof r['notes'] === 'string' ? r['notes'] : null,
			lastEmailAt: dateToIsoOrNull(r['lastEmailAt']),
			lastCallAt: dateToIsoOrNull(r['lastCallAt']),
			lastMeetingAt: dateToIsoOrNull(r['lastMeetingAt']),
			provenance: narrowContactProvenance(r['provenance']),
		})
	}
	return out
}

function narrowContactProvenance(
	raw: unknown,
): ReadonlyArray<ContactProvenance> {
	if (!Array.isArray(raw)) return []
	const out: Array<ContactProvenance> = []
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue
		const r = item as Record<string, unknown>
		if (typeof r['runId'] !== 'string') continue
		const sources: Array<{ url: string }> = []
		if (Array.isArray(r['sources'])) {
			for (const source of r['sources']) {
				if (!source || typeof source !== 'object') continue
				const url = (source as Record<string, unknown>)['url']
				if (typeof url === 'string') sources.push({ url })
			}
		}
		out.push({
			runId: r['runId'],
			runCompletedAt: dateToIsoOrNull(r['runCompletedAt']),
			sources,
		})
	}
	return out
}

const ChannelLabel = styled.span.withConfig({
	displayName: 'CompanyDetailChannelLabel',
})`
	display: inline-block;
	padding: 0 var(--space-2xs);
	border-radius: var(--shape-2xs);
	background: var(--color-surface-container-high);
	color: var(--color-on-surface-variant);
	font-size: var(--typescale-label-small-size);
	white-space: nowrap;
`

const textOrNull = (value: unknown): string | null =>
	typeof value === 'string' && value.trim().length > 0 ? value : null

// Most of what makes an activity row worth reading — the email's subject, how
// a call ended, what was promised next — sits in its `payload`, not in
// `summary`, which many kinds leave empty. A row built from `summary` alone
// shows up as a bare channel name and nothing else.
function toTimelineEntry(
	row: TimelineRow,
	labels: {
		readonly stageChangedLabel: string
		readonly companyDeletedLabel: string
		readonly companyRestoredLabel: string
		readonly describePeopleAffected: (count: number) => string
		readonly describeStageChange: (
			from: CompanyStatus,
			to: CompanyStatus,
		) => string
	},
): TimelineEntryData {
	const payload = row.payload ?? {}

	if (row.kind === 'company_deleted' || row.kind === 'company_restored') {
		const affected = Number(payload['contactsAffected'] ?? 0)
		return {
			id: row.id,
			channel: row.channel,
			subject:
				row.kind === 'company_deleted'
					? labels.companyDeletedLabel
					: labels.companyRestoredLabel,
			summary: labels.describePeopleAffected(affected),
			outcome: null,
			nextAction: null,
			date: row.date,
			threadId: null,
		}
	}

	if (row.kind === 'stage_changed') {
		return {
			id: row.id,
			channel: row.channel,
			subject: labels.stageChangedLabel,
			summary: labels.describeStageChange(
				asCompanyStatus(String(payload['from'] ?? 'prospect')),
				asCompanyStatus(String(payload['to'] ?? 'prospect')),
			),
			outcome: null,
			nextAction: null,
			date: row.date,
			threadId: null,
		}
	}

	return {
		id: row.id,
		channel: row.channel,
		subject: textOrNull(payload['subject']),
		summary: row.summary,
		outcome: textOrNull(payload['outcome']),
		nextAction: textOrNull(payload['nextAction']),
		date: row.date,
		// Only email rows carry this, so only those link through to a conversation.
		threadId: textOrNull(payload['threadLinkId']),
	}
}

function timelineKindToChannel(kind: string, fallback: string | null): string {
	switch (kind) {
		case 'email_sent':
		case 'email_received':
		case 'email_bounced':
			return 'email'
		case 'call_logged':
			return fallback ?? 'phone'
		// The row names its own channel, so the icon can match the medium — a
		// visit gets a pin, WhatsApp a speech bubble — with no case per channel.
		case 'interaction_logged':
			return fallback ?? 'other'
		case 'document_created':
			return 'document'
		case 'proposal_sent':
		case 'proposal_viewed':
		case 'proposal_responded':
			return 'proposal'
		case 'research_run':
		case 'research_applied':
			return 'research'
		case 'meeting_scheduled':
		case 'meeting_rescheduled':
		case 'meeting_cancelled':
		case 'meeting_rsvp':
			return 'event'
		case 'task_created':
		case 'task_updated':
		case 'task_completed':
			return 'task'
		case 'system_event':
		case 'stage_changed':
		case 'company_deleted':
		case 'company_restored':
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
		const occurredAt = dateToIsoOrNull(r['occurredAt'])
		if (occurredAt === null) continue
		const rawChannel = typeof r['channel'] === 'string' ? r['channel'] : null
		out.push({
			id: r['id'],
			kind: r['kind'],
			channel: timelineKindToChannel(r['kind'], rawChannel),
			date: occurredAt,
			summary: typeof r['summary'] === 'string' ? r['summary'] : null,
			payload:
				typeof r['payload'] === 'object' && r['payload'] !== null
					? (r['payload'] as Record<string, unknown>)
					: null,
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
			dueAt: dateToIsoOrNull(r['dueAt']),
			completedAt: dateToIsoOrNull(r['completedAt']),
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
	/* Stage, owner and the verified mark are four controls of their own width in
	 * a row that has to fit a phone. Let them fall onto a second line as the
	 * screen narrows rather than picking a width to switch at — the last one was
	 * simply off the side of the screen. */
	flex-wrap: wrap;
`

const VerifiedControl = styled.button.withConfig({
	displayName: 'CompanyDetailVerifiedControl',
	shouldForwardProp: prop => prop !== '$verified',
})<{ $verified?: boolean }>`
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.04em;
	text-transform: uppercase;
	padding: var(--space-3xs) var(--space-2xs);
	border-radius: var(--shape-full);
	cursor: pointer;
	color: ${p =>
		p.$verified ? 'var(--color-secondary)' : 'var(--color-on-surface-variant)'};
	background: ${p =>
		p.$verified
			? 'color-mix(in oklab, var(--color-secondary) 14%, transparent)'
			: 'transparent'};
	border: 1px solid
		${p =>
			p.$verified
				? 'color-mix(in oklab, var(--color-secondary) 40%, transparent)'
				: 'var(--color-outline)'};

	&:hover {
		border-color: var(--color-secondary);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
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
	justify-content: center;
	background: transparent;
	border: none;
	padding: 0;
	cursor: pointer;
	color: inherit;
	font: inherit;
	/* What this holds is a 10px dot. A finger cannot land on 10px, so the
	 * button around it is finger-sized while the dot stays the size it reads
	 * best at. Not tied to a screen width — a small target is small on a
	 * desktop trackpad too. */
	min-inline-size: 2.75rem;
	min-block-size: 2.75rem;
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
	/* The row of ways to reach a company is the most-tapped thing on the page,
	 * so the discs are finger-sized rather than the 2.25rem they read at. */
	width: 2.75rem;
	height: 2.75rem;
	border-radius: 50%;
	color: var(--color-on-surface);
	transition: transform 160ms ease;

	& svg {
		position: relative;
		z-index: 1;
		filter: drop-shadow(0 1px 0 var(--highlight-inset-bright));
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
	/* Establish a query container so panels (Contacts, Files) reflow on
	 * their own width via @container queries instead of viewport @media
	 * queries — the company-detail page lives inside a Sidebar primitive
	 * that already constrains horizontal space, so panel content needs
	 * to react to that, not to the viewport. */
	container-type: inline-size;
	padding: var(--space-md) 0;
`

const FilesGroup = styled.section.withConfig({
	displayName: 'CompanyDetailFilesGroup',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
`

const FilesGroupTitle = styled.h3.withConfig({
	displayName: 'CompanyDetailFilesGroupTitle',
})`
	${stenciledTitle}
	margin: 0;
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
`

const PeopleHeader = styled.div.withConfig({
	displayName: 'CompanyDetailPeopleHeader',
})`
	display: flex;
	justify-content: flex-end;
	margin-bottom: var(--space-sm);
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

	/* When the People panel has room for two contact cards side by side,
	 * lay them out as a 2-up grid. Threshold is the panel's own width
	 * (set by the PanelWrap container) so the page reflows the right
	 * way regardless of viewport breakpoints. */
	@container (min-width: 48rem) {
		display: grid;
		grid-template-columns: 1fr 1fr;
	}
`

const ContactCadence = styled.div.withConfig({
	displayName: 'CompanyDetailContactCadence',
})`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-2xs) var(--space-sm);
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	line-height: var(--typescale-label-small-line);
	color: var(--color-on-surface-variant);
`

const ContactCadenceItem = styled.span.withConfig({
	displayName: 'CompanyDetailContactCadenceItem',
})`
	display: inline-flex;
	align-items: baseline;
	gap: var(--space-3xs);
	white-space: nowrap;
`

const ContactNotes = styled.p.withConfig({
	displayName: 'CompanyDetailContactNotes',
})`
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	color: var(--color-on-surface-variant);
	white-space: pre-wrap;
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
		border: 2px solid color-mix(in oklab, var(--color-outline) 65%, transparent);
		border-top-color: color-mix(in oklab, var(--color-outline) 90%, transparent);
		border-radius: 6px 6px 3px 3px;
		background: linear-gradient(
			180deg,
			color-mix(in oklab, var(--color-metal-light) 40%, transparent) 0%,
			color-mix(in oklab, var(--color-metal-dark) 25%, transparent) 100%
		);
		box-shadow: 0 1px 2px var(--shadow-color-strong);
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
	shouldForwardProp: prop => prop !== '$decides',
})<{ $decides: boolean }>`
	${brushedMetalPlate}
	${stenciledTitle}
	display: inline-flex;
	padding: var(--space-3xs) var(--space-2xs);
	border-left: 3px solid
		${p => (p.$decides ? 'var(--color-secondary)' : 'var(--color-outline)')};
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

const ChannelGroup = styled.span.withConfig({
	displayName: 'CompanyDetailChannelGroup',
})`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
`

const ContactLink = styled.a.withConfig({
	displayName: 'CompanyDetailContactLink',
})`
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
	padding: var(--space-3xs) 0;
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
	padding: var(--space-3xs) 0;
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

const OverviewTimeline = styled.section.withConfig({
	displayName: 'CompanyDetailOverviewTimeline',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
`

const TimelineTrigger = styled(PriCollapsible.Trigger).withConfig({
	displayName: 'CompanyDetailTimelineTrigger',
})`
	& > svg {
		transition: transform 200ms ease;
	}

	&[data-open] > svg,
	&[aria-expanded='true'] > svg {
		transform: rotate(90deg);
	}
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

	/* Match the People panel's container-query reflow so wide tabs
	 * stop wasting horizontal space when there are several pages. */
	@container (min-width: 48rem) {
		display: grid;
		grid-template-columns: 1fr 1fr;
	}
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
	/* Published needs a darker green than the tint behind it — the status green
	 * on its own 20% tint is too faint to read at this size. */
	color: ${p =>
		p.$published
			? 'var(--color-on-secondary-container)'
			: 'var(--color-on-surface-variant)'};
`
