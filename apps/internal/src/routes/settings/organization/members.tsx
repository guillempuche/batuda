import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
	ArrowLeft,
	Check,
	ChevronsUpDown,
	Clock,
	Mail,
	RotateCcw,
	Send,
	Trash2,
	UserCircle2,
	UserPlus,
	X,
} from 'lucide-react'
import { useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriInput, PriSelect } from '@batuda/ui/pri'

import { RelativeDate } from '#/components/shared/relative-date'
import { authClient } from '#/lib/auth-client'
import {
	type InvitationLike,
	invitationDisplayStatus,
	selectPendingInvitations,
} from '#/lib/invitation-status'
import {
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

/**
 * Active-organization membership page. One place for the whole lifecycle:
 * active members (with remove), pending invitations (with cancel + resend),
 * and an inline "Invite member" panel.
 *
 * Everything reads from Better Auth's `useActiveOrganization` atom — its
 * `/get-full-organization` payload carries both `members` and every
 * `invitations` row, and the atom auto-refetches after any `/organization/*`
 * call (invite, cancel, remove), so sending or canceling an invitation
 * refreshes the lists without manual invalidation.
 *
 * Owners/admins manage; regular members get a read-only view (the invite CTA
 * and the remove/cancel/resend controls are hidden), mirroring how the
 * inboxes page hides destructive controls for roles that can't act.
 */

interface MemberRow {
	readonly id: string
	readonly userId: string
	readonly role: string
	readonly user: {
		readonly id: string
		readonly email: string
		readonly name: string | null
	}
}

type InvitationRow = InvitationLike

type Role = 'member' | 'admin'

export const Route = createFileRoute('/settings/organization/members')({
	head: () => ({ meta: [{ title: 'Members — Batuda' }] }),
	component: MembersPage,
})

function MembersPage() {
	const { t } = useLingui()
	// `useActiveOrganization` returns the full org payload — members AND
	// invitations — and is signal-backed so it auto-refetches when the
	// active-org cookie changes or any /organization/* call lands. Saves us a
	// separate list-members / list-invitations fetch on every page load.
	const active = authClient.useActiveOrganization()
	const activeMember = authClient.useActiveMember()

	const [removingId, setRemovingId] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [showInvite, setShowInvite] = useState(false)
	const [inviteEmail, setInviteEmail] = useState('')
	const [inviteRole, setInviteRole] = useState<Role>('member')
	const [inviteSubmitting, setInviteSubmitting] = useState(false)
	const [inviteError, setInviteError] = useState<string | null>(null)
	const [sentEmail, setSentEmail] = useState<string | null>(null)
	const [busyInvitationId, setBusyInvitationId] = useState<string | null>(null)
	const [invitationNotice, setInvitationNotice] = useState<{
		readonly kind: 'canceled' | 'resent'
		readonly email: string
	} | null>(null)

	const members = (active.data?.members ?? []) as ReadonlyArray<MemberRow>
	const allInvitations: ReadonlyArray<InvitationRow> =
		active.data?.invitations ?? []
	const pendingInvitations = selectPendingInvitations(allInvitations)

	const myRole = activeMember.data?.role ?? null
	const canManage = myRole === 'owner' || myRole === 'admin'

	// Inline so Lingui's macro extractor sees each `t` call.
	const ROLE_LABELS: Record<string, string> = {
		owner: t`Owner`,
		admin: t`Admin`,
		member: t`Member`,
	}
	const ROLE_ITEMS: ReadonlyArray<{ value: Role; label: string }> = [
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

	const handleInvite = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const trimmed = inviteEmail.trim().toLowerCase()
		if (!trimmed) {
			setInviteError(t`Enter an email address.`)
			return
		}
		setInviteSubmitting(true)
		setInviteError(null)
		try {
			const result = await authClient.organization.inviteMember({
				email: trimmed,
				role: inviteRole,
			})
			if (result.error) {
				// BA returns INVITER_NOT_FOUND, USER_ALREADY_INVITED_TO_THIS_
				// ORGANIZATION, USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION,
				// etc. The message is human-readable enough to surface inline.
				setInviteError(
					result.error.message ??
						t`Could not send the invitation. Please try again.`,
				)
				return
			}
			setSentEmail(trimmed)
			setInviteEmail('')
		} catch {
			setInviteError(
				t`No connection to the server. Try again in a few seconds.`,
			)
		} finally {
			setInviteSubmitting(false)
		}
	}

	const handleCancel = async (invitationId: string, email: string) => {
		setBusyInvitationId(invitationId)
		setError(null)
		try {
			const result = await authClient.organization.cancelInvitation({
				invitationId,
			})
			if (result.error) {
				setError(
					t`Could not cancel the invitation to ${email}. Please try again.`,
				)
				return
			}
			setInvitationNotice({ kind: 'canceled', email })
		} catch {
			setError(t`No connection to the server. Try again in a few seconds.`)
		} finally {
			setBusyInvitationId(null)
		}
	}

	const handleResend = async (invitation: InvitationRow) => {
		setBusyInvitationId(invitation.id)
		setError(null)
		try {
			// `resend: true` refreshes the existing invite's expiry and re-fires
			// sendInvitationEmail — no new row, same id.
			const result = await authClient.organization.inviteMember({
				email: invitation.email,
				role: invitation.role as Role,
				resend: true,
			})
			if (result.error) {
				setError(
					t`Could not resend the invitation to ${invitation.email}. Please try again.`,
				)
				return
			}
			setInvitationNotice({ kind: 'resent', email: invitation.email })
		} catch {
			setError(t`No connection to the server. Try again in a few seconds.`)
		} finally {
			setBusyInvitationId(null)
		}
	}

	const panelOpen = canManage && showInvite

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
						data-testid='invite-open'
						aria-expanded={showInvite}
						onClick={() => {
							setShowInvite(open => !open)
						}}
					>
						<UserPlus size={16} aria-hidden />
						<span>{showInvite ? t`Close invite` : t`Invite member`}</span>
					</PriButton>
				) : null}
			</HeaderRow>

			{error ? <ErrorBanner role='alert'>{error}</ErrorBanner> : null}

			{sentEmail ? (
				<SuccessBanner role='status' data-testid='invite-success'>
					<Mail size={14} aria-hidden />
					<span>
						<Trans>Invitation sent to {sentEmail}.</Trans>
					</span>
					<DismissButton
						type='button'
						aria-label={t`Dismiss`}
						onClick={() => {
							setSentEmail(null)
						}}
					>
						<X size={14} aria-hidden />
					</DismissButton>
				</SuccessBanner>
			) : null}

			{invitationNotice ? (
				<SuccessBanner
					role='status'
					data-testid={
						invitationNotice.kind === 'canceled'
							? 'invitation-cancel-confirm'
							: 'invitation-resend-confirm'
					}
				>
					<Mail size={14} aria-hidden />
					<span>
						{invitationNotice.kind === 'canceled'
							? t`Invitation to ${invitationNotice.email} canceled.`
							: t`Invitation to ${invitationNotice.email} re-sent.`}
					</span>
					<DismissButton
						type='button'
						aria-label={t`Dismiss`}
						onClick={() => {
							setInvitationNotice(null)
						}}
					>
						<X size={14} aria-hidden />
					</DismissButton>
				</SuccessBanner>
			) : null}

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
												<span>{ROLE_LABELS[member.role] ?? member.role}</span>
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

					<Section data-testid='invitations-section'>
						<SectionHeading>
							<Trans>Pending invitations</Trans>
						</SectionHeading>

						{active.isPending && !active.data ? (
							<EmptyCard data-testid='invitations-loading'>
								<Subtitle>
									<Trans>Loading…</Trans>
								</Subtitle>
							</EmptyCard>
						) : pendingInvitations.length === 0 ? (
							<EmptyCard data-testid='invitations-empty'>
								<Subtitle>
									<Trans>No pending invitations.</Trans>
								</Subtitle>
							</EmptyCard>
						) : (
							<InvitationList>
								{pendingInvitations.map(invitation => {
									const expired =
										invitationDisplayStatus(invitation.expiresAt) === 'expired'
									const isBusy = busyInvitationId === invitation.id
									return (
										<InvitationItem
											key={invitation.id}
											data-testid={`invitation-row-${invitation.id}`}
										>
											<InvitationInfo>
												<InvitationEmail
													data-testid={`invitation-email-${invitation.id}`}
												>
													<Mail size={12} aria-hidden />
													<span>{invitation.email}</span>
												</InvitationEmail>
												<InvitationMeta>
													<MetaItem>
														<MetaKey>
															<Trans>Sent</Trans>
														</MetaKey>
														<RelativeDate value={invitation.createdAt} />
													</MetaItem>
													<MetaItem>
														<MetaKey>
															<Trans>Expires</Trans>
														</MetaKey>
														<RelativeDate value={invitation.expiresAt} />
													</MetaItem>
												</InvitationMeta>
											</InvitationInfo>

											<InvitationBadges>
												<RoleBadge
													data-testid={`invitation-role-${invitation.id}`}
													$role={invitation.role}
												>
													<UserCircle2 size={12} aria-hidden />
													<span>
														{ROLE_LABELS[invitation.role] ?? invitation.role}
													</span>
												</RoleBadge>
												<StatusBadge
													data-testid={`invitation-status-${invitation.id}`}
													$expired={expired}
												>
													<Clock size={12} aria-hidden />
													<span>{expired ? t`Expired` : t`Pending`}</span>
												</StatusBadge>
											</InvitationBadges>

											{canManage ? (
												<InvitationActions>
													<PriButton
														type='button'
														$variant='outlined'
														data-testid={`invitation-resend-${invitation.id}`}
														disabled={isBusy}
														onClick={() => {
															void handleResend(invitation)
														}}
													>
														<RotateCcw size={14} aria-hidden />
														<span>{isBusy ? t`Working…` : t`Resend`}</span>
													</PriButton>
													<PriButton
														type='button'
														$variant='outlined'
														data-testid={`invitation-cancel-${invitation.id}`}
														disabled={isBusy}
														onClick={() => {
															void handleCancel(invitation.id, invitation.email)
														}}
													>
														<X size={14} aria-hidden />
														<span>{t`Cancel`}</span>
													</PriButton>
												</InvitationActions>
											) : null}
										</InvitationItem>
									)
								})}
							</InvitationList>
						)}
					</Section>
				</Main>

				{panelOpen ? (
					<Aside>
						<InvitePanel>
							<PanelHeader>
								<PanelTitle>
									<Trans>Invite a member</Trans>
								</PanelTitle>
								<DismissButton
									type='button'
									aria-label={t`Close`}
									onClick={() => {
										setShowInvite(false)
									}}
								>
									<X size={16} aria-hidden />
								</DismissButton>
							</PanelHeader>

							<PanelSubtitle>
								<Trans>
									Send a one-click invitation. The recipient signs in via the
									link in the email — no password to share.
								</Trans>
							</PanelSubtitle>

							{inviteError ? (
								<ErrorBanner role='alert' data-testid='invite-error'>
									{inviteError}
								</ErrorBanner>
							) : null}

							<Form onSubmit={handleInvite} data-testid='invite-form'>
								<Field>
									<Label htmlFor='invite-email'>
										<Trans>Email</Trans>
									</Label>
									<PriInput
										id='invite-email'
										name='email'
										type='email'
										autoComplete='email'
										required
										disabled={inviteSubmitting}
										value={inviteEmail}
										onChange={e => {
											setInviteEmail(e.currentTarget.value)
										}}
										data-testid='invite-email'
									/>
								</Field>

								<Field>
									<Label htmlFor='invite-role'>
										<Trans>Role</Trans>
									</Label>
									<PriSelect.Root
										items={ROLE_ITEMS}
										value={inviteRole}
										onValueChange={value => {
											if (value === 'member' || value === 'admin') {
												setInviteRole(value)
											}
										}}
									>
										<PriSelect.Trigger
											id='invite-role'
											data-testid='invite-role-trigger'
											disabled={inviteSubmitting}
										>
											<PriSelect.Value />
											<PriSelect.Icon>
												<ChevronsUpDown size={14} aria-hidden />
											</PriSelect.Icon>
										</PriSelect.Trigger>
										<PriSelect.Portal>
											<PriSelect.Positioner sideOffset={6}>
												<PriSelect.Popup>
													{ROLE_ITEMS.map(item => (
														<PriSelect.Item
															key={item.value}
															value={item.value}
															data-testid={`invite-role-option-${item.value}`}
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
									disabled={inviteSubmitting}
									data-testid='invite-submit'
								>
									<Send size={16} aria-hidden />
									<span>
										{inviteSubmitting ? t`Sending…` : t`Send invitation`}
									</span>
								</PriButton>
							</Form>

							<Hint>
								<UserPlus size={14} aria-hidden />
								<span>
									<Trans>
										The invitee gets a 48-hour link. They can accept it once.
									</Trans>
								</span>
							</Hint>
						</InvitePanel>
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

// On a phone the invite panel reads as an inline form right under the header
// CTA; on a wide screen it sits as a sticky side panel beside the lists.
const Aside = styled.aside.withConfig({ displayName: 'MembersAside' })`
	order: -1;

	@media (min-width: 60rem) {
		order: 0;
		position: sticky;
		top: var(--space-md);
		align-self: start;
	}
`

const Section = styled.section.withConfig({ displayName: 'MembersSection' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
`

const SectionHeading = styled.h3.withConfig({
	displayName: 'MembersSectionHeading',
})`
	${stenciledTitle}
	${rulerUnderRule}
	font-size: var(--typescale-title-large-size);
	line-height: var(--typescale-title-large-line);
	margin: 0;
	padding-bottom: var(--space-2xs);
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

const InvitationList = styled.ul.withConfig({
	displayName: 'MembersInvitationList',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	margin: 0;
	padding: 0;
	list-style: none;
`

// Wraps so the badges + actions drop below the email/meta column on a phone.
const InvitationItem = styled.li.withConfig({
	displayName: 'MembersInvitationItem',
})`
	${brushedMetalPlate}
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-sm);
	padding: var(--space-sm) var(--space-md);
	border-radius: var(--shape-2xs);
`

const InvitationInfo = styled.div.withConfig({
	displayName: 'MembersInvitationInfo',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	flex: 1;
	min-width: 12rem;
`

const InvitationEmail = styled.p.withConfig({
	displayName: 'MembersInvitationEmail',
})`
	${stenciledTitle}
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	font-size: var(--typescale-title-small-size);
	margin: 0;
	overflow: hidden;
	text-overflow: ellipsis;
`

const InvitationMeta = styled.p.withConfig({
	displayName: 'MembersInvitationMeta',
})`
	display: inline-flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-2xs) var(--space-md);
	margin: 0;
`

const MetaItem = styled.span.withConfig({ displayName: 'MembersMetaItem' })`
	display: inline-flex;
	align-items: baseline;
	gap: var(--space-2xs);
`

const MetaKey = styled.span.withConfig({ displayName: 'MembersMetaKey' })`
	${stenciledTitle}
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const InvitationBadges = styled.div.withConfig({
	displayName: 'MembersInvitationBadges',
})`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
`

const InvitationActions = styled.div.withConfig({
	displayName: 'MembersInvitationActions',
})`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
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

// Amber while the link is still good, error-tinted once it has lapsed.
const StatusBadge = styled.span.withConfig({
	displayName: 'MembersStatusBadge',
	shouldForwardProp: prop => prop !== '$expired',
})<{ $expired: boolean }>`
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
	background: ${({ $expired }) =>
		$expired
			? 'color-mix(in srgb, var(--color-error) 8%, transparent)'
			: 'color-mix(in srgb, var(--color-status-prospect) 12%, transparent)'};
	color: ${({ $expired }) =>
		$expired ? 'var(--color-error)' : 'var(--color-status-prospect)'};
	border: 1px dashed
		${({ $expired }) =>
			$expired
				? 'color-mix(in srgb, var(--color-error) 40%, transparent)'
				: 'color-mix(in srgb, var(--color-status-prospect) 40%, transparent)'};
`

const InvitePanel = styled.div.withConfig({
	displayName: 'MembersInvitePanel',
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

const Form = styled.form.withConfig({ displayName: 'MembersInviteForm' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
`

const Field = styled.div.withConfig({ displayName: 'MembersInviteField' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const Label = styled.label.withConfig({ displayName: 'MembersInviteLabel' })`
	${stenciledTitle}
	font-size: var(--typescale-label-medium-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
`

const Hint = styled.p.withConfig({ displayName: 'MembersInviteHint' })`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	font-style: italic;
`
