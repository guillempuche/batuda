import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Mail, Trash2, UserCircle2 } from 'lucide-react'
import { useState } from 'react'
import styled from 'styled-components'

import { PriButton } from '@batuda/ui/pri'

import { authClient } from '#/lib/auth-client'
import {
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

/**
 * Active-organization member list. Reads via Better Auth's
 * `useListMembers` atom; the active-org signal auto-invalidates on
 * setActive so switching from the TopBar dropdown re-fetches without a
 * manual refresh.
 *
 * Owners/admins can remove members; regular members see a read-only view
 * (the remove control is hidden, mirroring how the inboxes page hides
 * destructive controls when the active member's role can't act).
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

export const Route = createFileRoute('/settings/organization/members')({
	head: () => ({ meta: [{ title: 'Members — Batuda' }] }),
	component: MembersPage,
})

function MembersPage() {
	const { t } = useLingui()
	// `useActiveOrganization` returns the full org payload — including its
	// members list — and is signal-backed so it auto-refetches when the
	// active-org cookie changes. Saves us a separate /list-members fetch
	// on every page load.
	const active = authClient.useActiveOrganization()
	const activeMember = authClient.useActiveMember()
	const [pending, setPending] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	const members = (active.data?.members ?? []) as ReadonlyArray<MemberRow>
	const myRole = activeMember.data?.role ?? null
	const canRemove = myRole === 'owner' || myRole === 'admin'

	// Inline so Lingui's macro extractor sees each `t` call.
	const ROLE_LABELS: Record<string, string> = {
		owner: t`Owner`,
		admin: t`Admin`,
		member: t`Member`,
	}

	const handleRemove = async (memberId: string, email: string) => {
		const confirmed = window.confirm(t`Remove ${email} from this organization?`)
		if (!confirmed) return
		setPending(memberId)
		setError(null)
		try {
			const result = await authClient.organization.removeMember({
				memberIdOrEmail: memberId,
			})
			if (result.error) {
				setError(t`Could not remove ${email}. Please try again.`)
				return
			}
			// `useListMembers` re-fetches via the activeOrgSignal listener
			// in better-auth's atomListeners; nothing to invalidate here.
		} catch {
			setError(t`No connection to the server. Try again in a few seconds.`)
		} finally {
			setPending(null)
		}
	}

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

			<Intro>
				<Heading>
					<Trans>Members</Trans>
				</Heading>
				<Subtitle>
					<Trans>People with access to this workspace.</Trans>
				</Subtitle>
			</Intro>

			{error ? <ErrorBanner role='alert'>{error}</ErrorBanner> : null}

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
						const isPending = pending === member.id
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
								<RoleBadge
									data-testid={`member-role-${member.userId}`}
									$role={member.role}
								>
									<UserCircle2 size={12} aria-hidden />
									<span>{ROLE_LABELS[member.role] ?? member.role}</span>
								</RoleBadge>
								{canRemove ? (
									<PriButton
										type='button'
										$variant='outlined'
										data-testid={`member-remove-${member.userId}`}
										disabled={isPending}
										onClick={() => {
											void handleRemove(member.id, member.user.email)
										}}
									>
										<Trash2 size={14} aria-hidden />
										<span>{isPending ? t`Removing…` : t`Remove`}</span>
									</PriButton>
								) : null}
							</MemberRow>
						)
					})}
				</MemberList>
			)}
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

const Intro = styled.div.withConfig({ displayName: 'MembersIntro' })`
	${rulerUnderRule}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-bottom: var(--space-xs);
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

const MemberRow = styled.li.withConfig({ displayName: 'MembersRow' })`
	${brushedMetalPlate}
	display: flex;
	align-items: center;
	gap: var(--space-md);
	padding: var(--space-sm) var(--space-md);
	border-radius: var(--shape-2xs);
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
	min-width: 0;
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
