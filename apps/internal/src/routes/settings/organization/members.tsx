import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
	ArrowLeft,
	Check,
	ChevronsUpDown,
	Mail,
	Send,
	Trash2,
	UserCircle2,
	UserPlus,
	X,
} from 'lucide-react'
import { useState } from 'react'
import styled from 'styled-components'

import { isLangCode, type LangCode } from '@batuda/domain'
import { PriButton, PriInput, PriSelect } from '@batuda/ui/pri'

import { langSelectItems } from '#/i18n/lang-labels'
import { useLang } from '#/i18n/lang-provider'
import { apiBaseUrl } from '#/lib/api-base'
import { authClient } from '#/lib/auth-client'
import {
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

/**
 * Active-organization membership page: who is in the workspace, with an inline
 * panel for adding someone. Adding puts them in straight away — there is no
 * pending state to track and nothing for them to accept. The email they get
 * says so and carries no way into the account; they sign in themselves and ask
 * for their own link.
 *
 * Owners and admins manage; regular members get a read-only view (the add CTA
 * and the remove controls are hidden), mirroring how the inboxes page hides
 * destructive controls for roles that can't act.
 */

interface OrgMember {
	readonly id: string
	readonly userId: string
	readonly role: string
	readonly user: {
		readonly id: string
		readonly email: string
		readonly name: string | null
	}
}

type Role = 'member' | 'admin'

export const Route = createFileRoute('/settings/organization/members')({
	head: () => ({ meta: [{ title: 'Members — Batuda' }] }),
	component: MembersPage,
})

function MembersPage() {
	const { t } = useLingui()
	// `useActiveOrganization` returns the full org payload and is signal-backed,
	// so it auto-refetches when the active-org cookie changes or any
	// /organization/* call lands. Saves a separate list-members fetch on every
	// page load.
	const active = authClient.useActiveOrganization()
	const activeMember = authClient.useActiveMember()
	const activeLang = useLang()

	const [removingId, setRemovingId] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [showAddPanel, setShowAddPanel] = useState(false)
	const [newMemberEmail, setNewMemberEmail] = useState('')
	const [newMemberRole, setNewMemberRole] = useState<Role>('member')
	// Seeded from the language the admin is reading in, not the app default: an
	// admin working in Catalan is far more likely to be adding a colleague who
	// also reads Catalan. Still a plain default they can change.
	const [newMemberLocale, setNewMemberLocale] = useState<LangCode>(activeLang)
	const [adding, setAdding] = useState(false)
	const [addError, setAddError] = useState<string | null>(null)
	const [addedEmail, setAddedEmail] = useState<string | null>(null)

	const members = (active.data?.members ?? []) as ReadonlyArray<OrgMember>

	const myRole = activeMember.data?.role ?? null
	const canManage = myRole === 'owner' || myRole === 'admin'

	// Inline so Lingui's macro extractor sees each `t` call.
	const roleLabels: Record<string, string> = {
		owner: t`Owner`,
		admin: t`Admin`,
		member: t`Member`,
	}
	const roleItems: ReadonlyArray<{ value: Role; label: string }> = [
		{ value: 'member', label: t`Member` },
		{ value: 'admin', label: t`Admin` },
	]

	const handleRemove = async (memberId: string, email: string) => {
		const confirmed = window.confirm(t`Remove ${email} from this organization?`)
		if (!confirmed) return
		setRemovingId(memberId)
		setError(null)
		try {
			const result = await authClient.organization.removeMember({
				memberIdOrEmail: memberId,
			})
			if (result.error) {
				setError(t`Could not remove ${email}. Please try again.`)
				return
			}
			// The activeOrgSignal listener re-fetches; nothing to invalidate here.
		} catch {
			setError(t`No connection to the server. Try again in a few seconds.`)
		} finally {
			setRemovingId(null)
		}
	}

	const handleAdd = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const trimmed = newMemberEmail.trim().toLowerCase()
		if (!trimmed) {
			setAddError(t`Enter an email address.`)
			return
		}
		setAdding(true)
		setAddError(null)
		try {
			const response = await fetch(`${apiBaseUrl()}/v1/members`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					email: trimmed,
					role: newMemberRole,
					locale: newMemberLocale,
				}),
			})
			if (!response.ok) {
				// The server names what went wrong; the wording lives here so it
				// can be translated.
				const body = (await response.json().catch(() => null)) as {
					_tag?: string
				} | null
				setAddError(
					body?._tag === 'Conflict'
						? t`${trimmed} is already in this organization.`
						: body?._tag === 'Forbidden'
							? t`Only an owner or an admin can add members.`
							: body?._tag === 'BadRequest'
								? t`That email address can't be used.`
								: // A session that lapsed while the panel was open. Without
									// this the message says "try again", which never works
									// however many times they do.
									response.status === 401
									? t`Your session has expired. Sign in again to continue.`
									: t`Could not add ${trimmed}. Please try again.`,
				)
				return
			}
			setAddedEmail(trimmed)
			setNewMemberEmail('')
			// The list is backed by Better Auth's atom, which refreshes after its
			// own `/organization/*` calls. This add went through Batuda's endpoint,
			// so nudge it with a read the atom does listen for.
			await authClient.organization.getFullOrganization()
		} catch {
			setAddError(t`No connection to the server. Try again in a few seconds.`)
		} finally {
			setAdding(false)
		}
	}

	const panelOpen = canManage && showAddPanel

	return (
		<Page>
			<BackLink
				to='/settings/organization'
				aria-label={t`Back to organization`}
			>
				<ArrowLeft size={14} aria-hidden />
				<span>
					<Trans>Organization</Trans>
				</span>
			</BackLink>

			<HeaderRow>
				<Intro>
					<Heading>
						<Trans>Members</Trans>
					</Heading>
					<Subtitle>
						<Trans>People with access to this workspace.</Trans>
					</Subtitle>
				</Intro>
				{canManage ? (
					<PriButton
						type='button'
						$variant='filled'
						data-testid='add-member-open'
						aria-expanded={showAddPanel}
						onClick={() => {
							// Drop any previous failure with the panel — otherwise
							// reopening it shows an error about the last address above
							// an empty form.
							setAddError(null)
							setShowAddPanel(open => !open)
						}}
					>
						<UserPlus size={16} aria-hidden />
						<span>{showAddPanel ? t`Close` : t`Add member`}</span>
					</PriButton>
				) : null}
			</HeaderRow>

			{error ? <ErrorBanner role='alert'>{error}</ErrorBanner> : null}

			{/* The live region stays mounted and empty. A region that appears at
			    the same moment as its text is often missed entirely — screen
			    readers announce changes *within* a region they were already
			    watching. `display: contents` keeps it out of the layout. */}
			<LiveRegion role='status' aria-live='polite'>
				{addedEmail ? (
					<SuccessBanner data-testid='add-member-success'>
						<Mail size={14} aria-hidden />
						<span>
							<Trans>{addedEmail} is now a member. They've been emailed.</Trans>
						</span>
						<DismissButton
							type='button'
							aria-label={t`Dismiss`}
							onClick={() => {
								setAddedEmail(null)
							}}
						>
							<X size={14} aria-hidden />
						</DismissButton>
					</SuccessBanner>
				) : null}
			</LiveRegion>

			<Layout $open={panelOpen}>
				<Main>
					{active.isPending && members.length === 0 ? (
						<EmptyCard>
							<Subtitle>
								<Trans>Loading…</Trans>
							</Subtitle>
						</EmptyCard>
					) : members.length === 0 ? (
						<EmptyCard>
							<Subtitle>
								<Trans>No members yet.</Trans>
							</Subtitle>
						</EmptyCard>
					) : (
						<MemberList>
							{members.map(member => {
								const displayName = member.user.name ?? member.user.email
								const initial = (displayName.charAt(0) || '?').toUpperCase()
								const isRemoving = removingId === member.id
								return (
									<MemberRow
										key={member.id}
										data-testid={`member-row-${member.userId}`}
									>
										<AvatarPlate>
											<Initial>{initial}</Initial>
										</AvatarPlate>
										<MemberInfo>
											<MemberName>{displayName}</MemberName>
											<MemberMeta>
												<Mail size={12} aria-hidden />
												<span>{member.user.email}</span>
											</MemberMeta>
										</MemberInfo>
										<MemberControls>
											<RoleBadge
												data-testid={`member-role-${member.userId}`}
												$role={member.role}
											>
												<UserCircle2 size={12} aria-hidden />
												<span>{roleLabels[member.role] ?? member.role}</span>
											</RoleBadge>
											{canManage ? (
												<PriButton
													type='button'
													$variant='outlined'
													data-testid={`member-remove-${member.userId}`}
													disabled={isRemoving}
													onClick={() => {
														void handleRemove(member.id, member.user.email)
													}}
												>
													<Trash2 size={14} aria-hidden />
													<span>{isRemoving ? t`Removing…` : t`Remove`}</span>
												</PriButton>
											) : null}
										</MemberControls>
									</MemberRow>
								)
							})}
						</MemberList>
					)}
				</Main>

				{panelOpen ? (
					<Aside>
						<AddPanel>
							<PanelHeader>
								<PanelTitle>
									<Trans>Add a member</Trans>
								</PanelTitle>
								<DismissButton
									type='button'
									aria-label={t`Close`}
									onClick={() => {
										setAddError(null)
										setShowAddPanel(false)
									}}
								>
									<X size={16} aria-hidden />
								</DismissButton>
							</PanelHeader>

							<PanelSubtitle>
								<Trans>
									They join straight away and get an email telling them so. It
									carries no password and no link to sign in with.
								</Trans>
							</PanelSubtitle>

							{addError ? (
								<ErrorBanner role='alert' data-testid='add-member-error'>
									{addError}
								</ErrorBanner>
							) : null}

							<Form onSubmit={handleAdd} data-testid='add-member-form'>
								<Field>
									<Label htmlFor='add-member-email'>
										<Trans>Email</Trans>
									</Label>
									<PriInput
										id='add-member-email'
										name='email'
										type='email'
										autoComplete='email'
										required
										disabled={adding}
										value={newMemberEmail}
										onChange={e => {
											setNewMemberEmail(e.currentTarget.value)
										}}
										data-testid='add-member-email'
									/>
								</Field>

								<Field>
									<Label htmlFor='add-member-role'>
										<Trans>Role</Trans>
									</Label>
									<PriSelect.Root
										items={roleItems}
										value={newMemberRole}
										onValueChange={value => {
											if (value === 'member' || value === 'admin') {
												setNewMemberRole(value)
											}
										}}
									>
										<PriSelect.Trigger
											id='add-member-role'
											data-testid='add-member-role-trigger'
											disabled={adding}
										>
											<PriSelect.Value />
											<PriSelect.Icon>
												<ChevronsUpDown size={14} aria-hidden />
											</PriSelect.Icon>
										</PriSelect.Trigger>
										<PriSelect.Portal>
											<PriSelect.Positioner
												alignItemWithTrigger={false}
												sideOffset={6}
											>
												<PriSelect.Popup>
													{roleItems.map(item => (
														<PriSelect.Item
															key={item.value}
															value={item.value}
															data-testid={`add-member-role-option-${item.value}`}
														>
															<PriSelect.ItemIndicator>
																<Check size={12} aria-hidden />
															</PriSelect.ItemIndicator>
															<PriSelect.ItemText>
																{item.label}
															</PriSelect.ItemText>
														</PriSelect.Item>
													))}
												</PriSelect.Popup>
											</PriSelect.Positioner>
										</PriSelect.Portal>
									</PriSelect.Root>
								</Field>

								<Field>
									<Label htmlFor='add-member-locale'>
										<Trans>Language</Trans>
									</Label>
									<PriSelect.Root
										items={langSelectItems}
										value={newMemberLocale}
										onValueChange={value => {
											if (isLangCode(value)) setNewMemberLocale(value)
										}}
									>
										<PriSelect.Trigger
											id='add-member-locale'
											data-testid='add-member-locale-trigger'
											disabled={adding}
										>
											<PriSelect.Value />
											<PriSelect.Icon>
												<ChevronsUpDown size={14} aria-hidden />
											</PriSelect.Icon>
										</PriSelect.Trigger>
										<PriSelect.Portal>
											<PriSelect.Positioner
												alignItemWithTrigger={false}
												sideOffset={6}
											>
												<PriSelect.Popup>
													{langSelectItems.map(item => (
														<PriSelect.Item
															key={item.value}
															value={item.value}
															data-testid={`add-member-locale-option-${item.value}`}
														>
															<PriSelect.ItemIndicator>
																<Check size={12} aria-hidden />
															</PriSelect.ItemIndicator>
															<PriSelect.ItemText>
																{item.label}
															</PriSelect.ItemText>
														</PriSelect.Item>
													))}
												</PriSelect.Popup>
											</PriSelect.Positioner>
										</PriSelect.Portal>
									</PriSelect.Root>
								</Field>

								<PriButton
									type='submit'
									$variant='filled'
									disabled={adding}
									data-testid='add-member-submit'
								>
									<Send size={16} aria-hidden />
									<span>{adding ? t`Adding…` : t`Add member`}</span>
								</PriButton>
							</Form>

							<Hint>
								<UserPlus size={14} aria-hidden />
								<span>
									<Trans>
										They sign in at the sign-in page with this address and ask
										for their own link, so nothing sent here can expire.
									</Trans>
								</span>
							</Hint>
						</AddPanel>
					</Aside>
				) : null}
			</Layout>
		</Page>
	)
}

const Page = styled.div.withConfig({ displayName: 'MembersPage' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`

const BackLink = styled(Link).withConfig({ displayName: 'MembersBackLink' })`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	text-decoration: none;
	width: fit-content;

	&:hover {
		color: var(--color-primary);
	}
`

const HeaderRow = styled.div.withConfig({ displayName: 'MembersHeaderRow' })`
	display: flex;
	flex-wrap: wrap;
	align-items: flex-end;
	justify-content: space-between;
	gap: var(--space-sm);
`

const Intro = styled.div.withConfig({ displayName: 'MembersIntro' })`
	${rulerUnderRule}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-bottom: var(--space-xs);
	flex: 1;
	min-width: 12rem;
`

const Heading = styled.h2.withConfig({ displayName: 'MembersHeading' })`
	${stenciledTitle}
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
	margin: 0;
`

const Subtitle = styled.p.withConfig({ displayName: 'MembersSubtitle' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const ErrorBanner = styled.p.withConfig({ displayName: 'MembersErrorBanner' })`
	margin: 0;
	padding: var(--space-2xs) var(--space-sm);
	border-left: 3px solid var(--color-error);
	background: color-mix(in srgb, var(--color-error) 6%, transparent);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-error);
`

// Wrapper only — it exists so the live region is in the DOM before there is
// anything to announce. `display: contents` means it adds no box of its own,
// so the banner still sits directly in the page's flex flow.
const LiveRegion = styled.div.withConfig({
	displayName: 'MembersLiveRegion',
})`
	display: contents;
`

const SuccessBanner = styled.p.withConfig({
	displayName: 'MembersSuccessBanner',
})`
	margin: 0;
	padding: var(--space-2xs) var(--space-sm);
	border-left: 3px solid var(--color-status-client);
	background: color-mix(in srgb, var(--color-status-client) 6%, transparent);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	display: inline-flex;
	gap: var(--space-2xs);
	align-items: center;
`

const DismissButton = styled.button.withConfig({
	displayName: 'MembersDismissButton',
})`
	margin-left: auto;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	padding: var(--space-3xs);
	border: none;
	background: transparent;
	color: var(--color-on-surface-variant);
	cursor: pointer;
	border-radius: var(--shape-3xs);

	&:hover {
		color: var(--color-primary);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const Layout = styled.div.withConfig({
	displayName: 'MembersLayout',
	shouldForwardProp: prop => prop !== '$open',
})<{ $open: boolean }>`
	display: grid;
	gap: var(--space-lg);
	grid-template-columns: 1fr;
	align-items: start;

	@media (min-width: 60rem) {
		grid-template-columns: ${({ $open }) =>
			$open ? 'minmax(0, 1fr) clamp(280px, 30%, 360px)' : '1fr'};
	}
`

const Main = styled.div.withConfig({ displayName: 'MembersMain' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
	min-width: 0;
`

// On a phone the add-member panel reads as an inline form right under the
// header CTA; on a wide screen it sits as a sticky side panel beside the list.
const Aside = styled.aside.withConfig({ displayName: 'MembersAside' })`
	order: -1;

	@media (min-width: 60rem) {
		order: 0;
		position: sticky;
		top: var(--space-md);
		align-self: start;
	}
`

const EmptyCard = styled.div.withConfig({ displayName: 'MembersEmptyCard' })`
	${brushedMetalPlate}
	padding: var(--space-md);
	border-radius: var(--shape-2xs);
`

const MemberList = styled.ul.withConfig({ displayName: 'MembersList' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	margin: 0;
	padding: 0;
	list-style: none;
`

// Wraps so the role badge + remove button drop below the name on a phone
// instead of clipping the button off the right edge at ~375px.
const MemberRow = styled.li.withConfig({ displayName: 'MembersRow' })`
	${brushedMetalPlate}
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-sm) var(--space-md);
	padding: var(--space-sm) var(--space-md);
	border-radius: var(--shape-2xs);
`

const MemberControls = styled.div.withConfig({
	displayName: 'MembersControls',
})`
	display: inline-flex;
	align-items: center;
	gap: var(--space-sm);
	margin-left: auto;
`

const AvatarPlate = styled.div.withConfig({
	displayName: 'MembersAvatarPlate',
})`
	width: 40px;
	height: 40px;
	border-radius: var(--shape-full);
	background: radial-gradient(
		circle at 35% 30%,
		color-mix(in oklab, var(--color-status-prospect) 88%, white) 0%,
		var(--color-status-prospect) 55%,
		color-mix(in oklab, var(--color-status-prospect) 68%, black) 100%
	);
	border: 2px solid color-mix(in oklab, var(--color-status-prospect) 60%, black);
	display: flex;
	align-items: center;
	justify-content: center;
	color: #fff;
	flex-shrink: 0;
`

const Initial = styled.span.withConfig({ displayName: 'MembersInitial' })`
	${stenciledTitle}
	font-size: var(--typescale-title-medium-size);
	color: #fff;
	text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
`

const MemberInfo = styled.div.withConfig({ displayName: 'MembersInfo' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	flex: 1;
	min-width: 10rem;
`

const MemberName = styled.p.withConfig({ displayName: 'MembersName' })`
	${stenciledTitle}
	font-size: var(--typescale-title-medium-size);
	margin: 0;
	overflow: hidden;
	text-overflow: ellipsis;
`

const MemberMeta = styled.p.withConfig({ displayName: 'MembersMeta' })`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	overflow: hidden;
	text-overflow: ellipsis;
`

const RoleBadge = styled.span.withConfig({
	displayName: 'MembersRoleBadge',
	shouldForwardProp: prop => prop !== '$role',
})<{ $role: string }>`
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
	padding: var(--space-3xs) var(--space-2xs);
	border-radius: var(--shape-3xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	background: ${({ $role }) =>
		$role === 'owner'
			? 'color-mix(in srgb, var(--color-primary) 14%, transparent)'
			: $role === 'admin'
				? 'color-mix(in srgb, var(--color-primary) 8%, transparent)'
				: 'transparent'};
	color: ${({ $role }) =>
		$role === 'owner' || $role === 'admin'
			? 'var(--color-primary)'
			: 'var(--color-on-surface-variant)'};
	border: 1px dashed
		${({ $role }) =>
			$role === 'owner' || $role === 'admin'
				? 'color-mix(in srgb, var(--color-primary) 40%, transparent)'
				: 'var(--color-outline)'};
`

const AddPanel = styled.div.withConfig({
	displayName: 'MembersAddPanel',
})`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
	padding: var(--space-md);
	border-radius: var(--shape-2xs);
`

const PanelHeader = styled.div.withConfig({
	displayName: 'MembersPanelHeader',
})`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
`

const PanelTitle = styled.h3.withConfig({ displayName: 'MembersPanelTitle' })`
	${stenciledTitle}
	font-size: var(--typescale-title-large-size);
	line-height: var(--typescale-title-large-line);
	margin: 0;
`

const PanelSubtitle = styled.p.withConfig({
	displayName: 'MembersPanelSubtitle',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Form = styled.form.withConfig({ displayName: 'MembersAddForm' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
`

const Field = styled.div.withConfig({ displayName: 'MembersAddField' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const Label = styled.label.withConfig({ displayName: 'MembersAddLabel' })`
	${stenciledTitle}
	font-size: var(--typescale-label-medium-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
`

const Hint = styled.p.withConfig({ displayName: 'MembersAddHint' })`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	font-style: italic;
`
