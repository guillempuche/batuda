import { useAtomRefresh, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import {
	Briefcase,
	Camera,
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
import { useCallback, useMemo } from 'react'
import styled from 'styled-components'

import { PriButton, PriCollapsible, PriTabs } from '@engranatge/ui/pri'

import {
	companyAtomFor,
	companyTasksAtomFor,
	contactsAtomFor,
	interactionsAtomFor,
} from '#/atoms/company-atoms'
import { emailsSearchAtom } from '#/atoms/emails-atoms'
import { pagesSearchAtom } from '#/atoms/pages-atoms'
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
import { getServerCookieHeader } from '#/lib/server-cookie'
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
}

type ContactRow = {
	readonly id: string
	readonly name: string
	readonly role: string | null
	readonly isDecisionMaker: boolean
	readonly email: string | null
	readonly phone: string | null
	readonly linkedin: string | null
}

type InteractionRow = {
	readonly id: string
	readonly channel: string
	readonly date: string
	readonly subject: string | null
	readonly summary: string | null
	readonly outcome: string | null
	readonly nextAction: string | null
	readonly providerThreadId: string | null
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
	const [{ Effect }, { makeForjaApiServer }, cookie] = await Promise.all([
		import('effect'),
		import('#/lib/forja-api-server'),
		getServerCookieHeader(),
	])
	const program = Effect.gen(function* () {
		const client = yield* makeForjaApiServer(cookie ?? undefined)
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

export const Route = createFileRoute('/companies/$slug')({
	loader: async ({ params: { slug } }) => {
		if (!import.meta.env.SSR) {
			// Client-side navigation: let the atoms refetch directly via
			// `ForjaApiAtom`. First render flashes the loading state while
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

	const contactsAtom = useMemo(() => contactsAtomFor(company.id), [company.id])
	const interactionsAtom = useMemo(
		() => interactionsAtomFor(company.id),
		[company.id],
	)
	const tasksAtom = useMemo(() => companyTasksAtomFor(company.id), [company.id])
	const companyPagesAtom = useMemo(
		() => pagesSearchAtom({ companyId: company.id }),
		[company.id],
	)
	const companyEmailsAtom = useMemo(
		() => emailsSearchAtom({ companyId: company.id, limit: 100 }),
		[company.id],
	)

	const contactsResult = useAtomValue(contactsAtom)
	const interactionsResult = useAtomValue(interactionsAtom)
	const tasksResult = useAtomValue(tasksAtom)
	const pagesResult = useAtomValue(companyPagesAtom)
	const emailsResult = useAtomValue(companyEmailsAtom)

	const refreshInteractions = useAtomRefresh(interactionsAtom)

	const contacts = useMemo<ReadonlyArray<ContactRow>>(
		() =>
			AsyncResult.isSuccess(contactsResult)
				? narrowContacts(contactsResult.value)
				: [],
		[contactsResult],
	)
	const interactions = useMemo<ReadonlyArray<InteractionRow>>(
		() =>
			AsyncResult.isSuccess(interactionsResult)
				? narrowInteractions(interactionsResult.value)
				: [],
		[interactionsResult],
	)
	const tasks = useMemo<ReadonlyArray<TaskEntry>>(
		() =>
			AsyncResult.isSuccess(tasksResult) ? narrowTasks(tasksResult.value) : [],
		[tasksResult],
	)
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

	const threadIdByProviderId = useMemo(() => {
		const map = new Map<string, string>()
		for (const t of companyThreads) map.set(t.providerThreadId, t.id)
		return map
	}, [companyThreads])

	const openTaskCount = useMemo(
		() => tasks.filter(task => task.completedAt === null).length,
		[tasks],
	)

	// After a successful Quick Capture submit, refresh both the interactions
	// feed and the company row — the server copies nextAction +
	// lastContactedAt onto the company in the same transaction (see
	// interactions handler), so both atoms are stale until we refresh.
	// `onSubmitted` is invoked by the dialog via the prefill payload.
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

	const handleLogInteraction = useCallback(() => {
		openQuickCapture({
			companyId: company.id,
			companyName: company.name,
			onSubmitted: () => {
				refreshInteractions()
				refreshCompany()
			},
		})
	}, [
		openQuickCapture,
		company.id,
		company.name,
		refreshInteractions,
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
						<PriorityDot priority={company.priority} />
						<StatusBadge status={asCompanyStatus(company.status)} size='lg' />
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
						>
							<Plus size={16} aria-hidden />
							<Trans>Log interaction</Trans>
						</PriButton>
					</motion.div>
					<PriButton
						type='button'
						$variant='outlined'
						onClick={handleComposeEmail}
					>
						<MailPlus size={16} aria-hidden />
						<Trans>Email</Trans>
					</PriButton>
					<PriButton type='button' $variant='outlined' disabled>
						<Plus size={16} aria-hidden />
						<Trans>Add task</Trans>
					</PriButton>
					<PriButton type='button' $variant='outlined' disabled>
						<Plus size={16} aria-hidden />
						<Trans>New proposal</Trans>
					</PriButton>
				</PrimaryActions>
			</Header>

			<PriTabs.Root defaultValue='profile'>
				<PriTabs.List>
					<PriTabs.Tab value='profile'>
						<Trans>Profile</Trans>
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
						<ProfileGrid>
							<ProfileField label={t`Industry`} value={company.industry} />
							<ProfileField label={t`Region`} value={company.region} />
							<ProfileField label={t`Location`} value={company.location} />
							<ProfileField label={t`Size`} value={company.sizeRange} />
							<ProfileField label={t`Source`} value={company.source} />
							<ProfileField
								label={t`Current tools`}
								value={company.currentTools}
							/>
							<ProfileField
								label={t`Pain points`}
								value={company.painPoints}
								multiline
							/>
							<ProfileField
								label={t`Next action`}
								value={company.nextAction}
								multiline
							/>
						</ProfileGrid>
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
											</ContactName>
											{contact.role && (
												<ContactRole>{contact.role}</ContactRole>
											)}
										</ContactHeader>
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
													<Trans>Email via Forja</Trans>
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

			<TimelineSection>
				<PriCollapsible.Root defaultOpen>
					<PriCollapsible.Trigger>
						<ChevronRight size={14} aria-hidden />
						<Trans>Timeline</Trans>
					</PriCollapsible.Trigger>
					<PriCollapsible.Panel>
						<TimelinePanelInner>
							{interactions.length === 0 ? (
								<EmptyState
									title={t`No interactions logged yet`}
									description={t`Use “Log interaction” above to record the first touch.`}
								/>
							) : (
								<TimelineList>
									{interactions.map(interaction => {
										const localThreadId =
											interaction.providerThreadId !== null
												? (threadIdByProviderId.get(
														interaction.providerThreadId,
													) ?? null)
												: null
										const entry: TimelineEntryData = {
											id: interaction.id,
											channel: interaction.channel,
											subject: interaction.subject,
											summary: interaction.summary,
											outcome: interaction.outcome,
											nextAction: interaction.nextAction,
											date: interaction.date,
											threadId: localThreadId,
										}
										return <TimelineEntry key={interaction.id} entry={entry} />
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

/**
 * Read-only profile field used by the Profile tab. `multiline` switches
 * the value from a one-line clamped span to a `<p>` that preserves line
 * breaks via `white-space: pre-wrap`.
 */
function ProfileField({
	label,
	value,
	multiline = false,
}: {
	label: string
	value: string | null
	multiline?: boolean
}) {
	return (
		<Field>
			<FieldLabel>{label}</FieldLabel>
			{value ? (
				multiline ? (
					<FieldValueMultiline>{value}</FieldValueMultiline>
				) : (
					<FieldValue>{value}</FieldValue>
				)
			) : (
				<FieldEmpty>—</FieldEmpty>
			)}
		</Field>
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
		out.push({
			id: r['id'],
			name: r['name'],
			role: typeof r['role'] === 'string' ? r['role'] : null,
			isDecisionMaker: r['isDecisionMaker'] === true,
			email: typeof r['email'] === 'string' ? r['email'] : null,
			phone: typeof r['phone'] === 'string' ? r['phone'] : null,
			linkedin: typeof r['linkedin'] === 'string' ? r['linkedin'] : null,
		})
	}
	return out
}

function narrowInteractions(
	rows: ReadonlyArray<unknown>,
): ReadonlyArray<InteractionRow> {
	const out: Array<InteractionRow> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		if (typeof r['channel'] !== 'string') continue
		if (typeof r['date'] !== 'string') continue
		const meta = r['metadata']
		let providerThreadId: string | null = null
		if (meta && typeof meta === 'object') {
			const m = meta as Record<string, unknown>
			if (typeof m['providerThreadId'] === 'string') {
				providerThreadId = m['providerThreadId']
			}
		}
		out.push({
			id: r['id'],
			channel: r['channel'],
			date: r['date'],
			subject: typeof r['subject'] === 'string' ? r['subject'] : null,
			summary: typeof r['summary'] === 'string' ? r['summary'] : null,
			outcome: typeof r['outcome'] === 'string' ? r['outcome'] : null,
			nextAction: typeof r['nextAction'] === 'string' ? r['nextAction'] : null,
			providerThreadId,
		})
	}
	// Sort interactions most-recent-first — the server does not guarantee
	// ordering and the timeline is useless unless the top row is the
	// freshest thing we know about this company.
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

const Field = styled.div.withConfig({ displayName: 'CompanyDetailField' })`
	${agedPaperSurface}
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	padding: var(--space-sm) var(--space-md);
	border-bottom-width: 2px;
`

const FieldLabel = styled.span.withConfig({
	displayName: 'CompanyDetailFieldLabel',
})`
	${stenciledTitle}
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
`

const FieldValue = styled.span.withConfig({
	displayName: 'CompanyDetailFieldValue',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	color: var(--color-on-surface);
`

const FieldValueMultiline = styled.p.withConfig({
	displayName: 'CompanyDetailFieldValueMultiline',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	color: var(--color-on-surface);
	white-space: pre-wrap;
	margin: 0;
`

const FieldEmpty = styled.span.withConfig({
	displayName: 'CompanyDetailFieldEmpty',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	opacity: 0.55;
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
