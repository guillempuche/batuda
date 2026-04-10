import { useAtomRefresh, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import {
	Briefcase,
	Camera,
	ExternalLink,
	FileText,
	Globe,
	Mail,
	MapPin,
	Phone,
	Plus,
} from 'lucide-react'
import { useCallback, useMemo } from 'react'
import styled from 'styled-components'

import { PriTabs } from '@engranatge/ui/pri'

import {
	companyAtomFor,
	companyTasksAtomFor,
	contactsAtomFor,
	interactionsAtomFor,
} from '#/atoms/company-atoms'
import { EmptyState } from '#/components/shared/empty-state'
import { LoadingSpinner } from '#/components/shared/loading-spinner'
import { PriorityDot } from '#/components/shared/priority-dot'
import { RelativeDate } from '#/components/shared/relative-date'
import { asCompanyStatus, StatusBadge } from '#/components/shared/status-badge'
import {
	TimelineEntry,
	type TimelineEntryData,
} from '#/components/shared/timeline-entry'
import { useQuickCapture } from '#/context/quick-capture-context'
import { dehydrateAtom } from '#/lib/atom-hydration'

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
	const [{ Effect }, { getRequestHeader }, { makeForjaApiServer }] =
		await Promise.all([
			import('effect'),
			import('@tanstack/react-start/server'),
			import('#/lib/forja-api-server'),
		])
	const cookie = getRequestHeader('cookie')
	const program = Effect.gen(function* () {
		const client = yield* makeForjaApiServer(cookie)
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

	const contactsAtom = useMemo(() => contactsAtomFor(company.id), [company.id])
	const interactionsAtom = useMemo(
		() => interactionsAtomFor(company.id),
		[company.id],
	)
	const tasksAtom = useMemo(() => companyTasksAtomFor(company.id), [company.id])

	const contactsResult = useAtomValue(contactsAtom)
	const interactionsResult = useAtomValue(interactionsAtom)
	const tasksResult = useAtomValue(tasksAtom)

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

	const openTaskCount = useMemo(
		() => tasks.filter(task => task.completedAt === null).length,
		[tasks],
	)

	// After a successful Quick Capture submit, refresh both the interactions
	// feed and the company row — the server copies nextAction +
	// lastContactedAt onto the company in the same transaction (see
	// interactions handler), so both atoms are stale until we refresh.
	// `onSubmitted` is invoked by the dialog via the prefill payload.
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
			<Header>
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
					<PrimaryAction type='button' onClick={handleLogInteraction}>
						<Plus size={16} aria-hidden />
						<Trans>Log interaction</Trans>
					</PrimaryAction>
					<SecondaryAction type='button' disabled aria-disabled='true'>
						<Plus size={16} aria-hidden />
						<Trans>Add task</Trans>
					</SecondaryAction>
					<SecondaryAction type='button' disabled aria-disabled='true'>
						<Plus size={16} aria-hidden />
						<Trans>New proposal</Trans>
					</SecondaryAction>
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
					<PriTabs.Tab value='tasks'>
						<Trans>Tasks</Trans> ({openTaskCount})
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
				<TimelineHeading>
					<Trans>Timeline</Trans>
				</TimelineHeading>
				{interactions.length === 0 ? (
					<EmptyState
						title={t`No interactions logged yet`}
						description={t`Use “Log interaction” above to record the first touch.`}
					/>
				) : (
					<TimelineList>
						{interactions.map(interaction => {
							const entry: TimelineEntryData = {
								id: interaction.id,
								channel: interaction.channel,
								subject: interaction.subject,
								summary: interaction.summary,
								outcome: interaction.outcome,
								nextAction: interaction.nextAction,
								date: interaction.date,
							}
							return <TimelineEntry key={interaction.id} entry={entry} />
						})}
					</TimelineList>
				)}
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
		out.push({
			id: r['id'],
			channel: r['channel'],
			date: r['date'],
			subject: typeof r['subject'] === 'string' ? r['subject'] : null,
			summary: typeof r['summary'] === 'string' ? r['summary'] : null,
			outcome: typeof r['outcome'] === 'string' ? r['outcome'] : null,
			nextAction: typeof r['nextAction'] === 'string' ? r['nextAction'] : null,
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

const Header = styled.header.withConfig({
	displayName: 'CompanyDetailHeader',
})`
	position: sticky;
	top: var(--top-bar-height);
	z-index: 3;
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md) 0 var(--space-sm);
	background: var(--color-surface);
	border-bottom: 1px solid var(--color-outline-variant);
`

const IdentityRow = styled.div.withConfig({
	displayName: 'CompanyDetailIdentityRow',
})`
	display: flex;
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
`

const Name = styled.h2.withConfig({ displayName: 'CompanyDetailName' })`
	font-family: var(--font-display);
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
	font-weight: var(--font-weight-bold);
	color: var(--color-on-surface);
	margin: 0;
`

const SubtitleText = styled.p.withConfig({
	displayName: 'CompanyDetailSubtitle',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
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
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2rem;
	height: 2rem;
	border-radius: var(--shape-full);
	border: 1px solid var(--color-outline-variant);
	background: transparent;
	color: var(--color-on-surface-variant);
	transition:
		background 120ms ease,
		color 120ms ease,
		border-color 120ms ease;

	&:hover {
		background: var(--color-primary);
		color: var(--color-on-primary);
		border-color: var(--color-primary);
	}

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
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
	color: var(--color-on-surface-variant);
`

const LastContactLabel = styled.span.withConfig({
	displayName: 'CompanyDetailLastContactLabel',
})`
	opacity: 0.7;
`

const PrimaryActions = styled.div.withConfig({
	displayName: 'CompanyDetailPrimaryActions',
})`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-sm);
`

const PrimaryAction = styled.button.withConfig({
	displayName: 'CompanyDetailPrimaryAction',
})`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-xs) var(--space-md);
	background: var(--color-primary);
	color: var(--color-on-primary);
	border: none;
	border-radius: var(--shape-full);
	font-family: var(--font-body);
	font-size: var(--typescale-label-large-size);
	line-height: var(--typescale-label-large-line);
	font-weight: var(--typescale-label-large-weight);
	letter-spacing: var(--typescale-label-large-tracking);
	cursor: pointer;
	transition:
		background 120ms ease,
		transform 120ms ease;

	&:hover {
		background: color-mix(in oklab, var(--color-primary) 90%, black);
	}

	&:active {
		transform: translateY(1px);
	}

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
`

const SecondaryAction = styled.button.withConfig({
	displayName: 'CompanyDetailSecondaryAction',
})`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-xs) var(--space-md);
	background: var(--color-surface-container);
	color: var(--color-on-surface);
	border: 1px solid var(--color-outline-variant);
	border-radius: var(--shape-full);
	font-family: var(--font-body);
	font-size: var(--typescale-label-large-size);
	font-weight: var(--typescale-label-large-weight);
	letter-spacing: var(--typescale-label-large-tracking);
	cursor: pointer;

	&:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}
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
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const FieldLabel = styled.span.withConfig({
	displayName: 'CompanyDetailFieldLabel',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	letter-spacing: var(--typescale-label-small-tracking);
	text-transform: uppercase;
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
	display: flex;
	flex-direction: column;
	gap: var(--space-xs);
	padding: var(--space-md);
	background: var(--color-surface-container-low);
	border: 1px solid var(--color-outline-variant);
	border-radius: var(--shape-md);
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
	display: inline-flex;
	align-items: center;
	gap: var(--space-xs);
	font-family: var(--font-display);
	font-size: var(--typescale-title-small-size);
	line-height: var(--typescale-title-small-line);
	font-weight: var(--typescale-title-small-weight);
	color: var(--color-on-surface);
`

const DecisionBadge = styled.span.withConfig({
	displayName: 'CompanyDetailDecisionBadge',
})`
	display: inline-flex;
	padding: var(--space-3xs) var(--space-2xs);
	background: var(--color-secondary);
	color: var(--color-on-secondary);
	border-radius: var(--shape-full);
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--typescale-label-small-weight);
	letter-spacing: var(--typescale-label-small-tracking);
	text-transform: uppercase;
`

const ContactRole = styled.span.withConfig({
	displayName: 'CompanyDetailContactRole',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
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
	font-family: var(--font-body);
	font-size: var(--typescale-label-medium-size);
	color: var(--color-primary);
	text-decoration: none;

	&:hover {
		text-decoration: underline;
	}
`

const TaskList = styled.ul.withConfig({
	displayName: 'CompanyDetailTaskList',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-xs);
	list-style: none;
	padding: 0;
	margin: 0;
`

const TaskRow = styled.li.withConfig({
	displayName: 'CompanyDetailTaskRow',
	shouldForwardProp: prop => prop !== '$completed',
})<{ $completed: boolean }>`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	padding: var(--space-sm) var(--space-md);
	background: var(--color-surface-container-low);
	border: 1px solid var(--color-outline-variant);
	border-radius: var(--shape-sm);
	opacity: ${p => (p.$completed ? 0.55 : 1)};
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
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
	flex-shrink: 0;
`

const TimelineSection = styled.section.withConfig({
	displayName: 'CompanyDetailTimelineSection',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
`

const TimelineHeading = styled.h3.withConfig({
	displayName: 'CompanyDetailTimelineHeading',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-title-small-size);
	line-height: var(--typescale-title-small-line);
	font-weight: var(--typescale-title-small-weight);
	letter-spacing: var(--typescale-title-small-tracking);
	text-transform: uppercase;
	color: var(--color-on-surface);
	margin: 0;
`

const TimelineList = styled.div.withConfig({
	displayName: 'CompanyDetailTimelineList',
})`
	display: flex;
	flex-direction: column;
	gap: 0;
`
