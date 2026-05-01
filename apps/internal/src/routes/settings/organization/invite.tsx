import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Mail, Send, UserPlus } from 'lucide-react'
import { useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriInput } from '@batuda/ui/pri'

import { authClient } from '#/lib/auth-client'
import {
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

/**
 * Invite a user to the active organization. The form posts to Better
 * Auth's `organization.inviteMember`, which fires the
 * `sendInvitationEmail` callback wired in `apps/server/src/lib/auth.ts`
 * — that callback pre-creates the invitee, mints a magic-link sign-in
 * URL pointing at /accept-invitation/<id>, and ships it via the
 * transactional provider. So a successful submit here is the entire
 * server-side end of the flow.
 *
 * Owners + admins reach this page; the page is gated by the active
 * member's role (read from `useActiveMember`). Non-admins land here only
 * via direct URL — they see a read-only message instead of the form.
 */

type Role = 'member' | 'admin'

export const Route = createFileRoute('/settings/organization/invite')({
	component: InvitePage,
})

function InvitePage() {
	const { t } = useLingui()
	const navigate = useNavigate()
	const activeMember = authClient.useActiveMember()
	const myRole = activeMember.data?.role ?? null
	const canInvite = myRole === 'owner' || myRole === 'admin'

	const [email, setEmail] = useState('')
	const [role, setRole] = useState<Role>('member')
	const [pending, setPending] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [sent, setSent] = useState<string | null>(null)

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const trimmed = email.trim().toLowerCase()
		if (!trimmed) {
			setError(t`Enter an email address.`)
			return
		}
		setPending(true)
		setError(null)
		try {
			const result = await authClient.organization.inviteMember({
				email: trimmed,
				role,
			})
			if (result.error) {
				// BA returns INVITER_NOT_FOUND, USER_ALREADY_INVITED_TO_THIS_
				// ORGANIZATION, USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION,
				// etc. The message is human-readable enough to surface inline.
				setError(
					result.error.message ??
						t`Could not send the invitation. Please try again.`,
				)
				return
			}
			setSent(trimmed)
			setEmail('')
		} catch {
			setError(t`No connection to the server. Try again in a few seconds.`)
		} finally {
			setPending(false)
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
					<Trans>Invite a member</Trans>
				</Heading>
				<Subtitle>
					<Trans>
						Send a one-click invitation. The recipient signs in via the link in
						the email — no password to share.
					</Trans>
				</Subtitle>
			</Intro>

			{!canInvite ? (
				<Card>
					<Subtitle>
						<Trans>Only owners and admins can invite new members.</Trans>
					</Subtitle>
				</Card>
			) : (
				<>
					{error ? <ErrorBanner role='alert'>{error}</ErrorBanner> : null}
					{sent ? (
						<SuccessBanner role='status' data-testid='invite-success'>
							<Mail size={14} aria-hidden />
							<span>
								<Trans>Invitation sent to {sent}.</Trans>
							</span>
							<Link
								to='/settings/organization/members'
								onClick={() => {
									void navigate({ to: '/settings/organization/members' })
								}}
							>
								<Trans>View members</Trans>
							</Link>
						</SuccessBanner>
					) : null}

					<Card>
						<Form onSubmit={handleSubmit} data-testid='invite-form'>
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
									disabled={pending}
									value={email}
									onChange={e => {
										setEmail(e.currentTarget.value)
									}}
									data-testid='invite-email'
								/>
							</Field>

							<Field>
								<Label htmlFor='invite-role'>
									<Trans>Role</Trans>
								</Label>
								<RoleSelect
									id='invite-role'
									name='role'
									disabled={pending}
									value={role}
									onChange={e => {
										setRole(e.currentTarget.value as Role)
									}}
									data-testid='invite-role'
								>
									<option value='member'>{t`Member`}</option>
									<option value='admin'>{t`Admin`}</option>
								</RoleSelect>
							</Field>

							<PriButton
								type='submit'
								$variant='filled'
								disabled={pending}
								data-testid='invite-submit'
							>
								<Send size={16} aria-hidden />
								<span>{pending ? t`Sending…` : t`Send invitation`}</span>
							</PriButton>
						</Form>
					</Card>

					<Hint>
						<UserPlus size={14} aria-hidden />
						<span>
							<Trans>
								The invitee gets a 48-hour link. They can accept it once.
							</Trans>
						</span>
					</Hint>
				</>
			)}
		</Page>
	)
}

const Page = styled.div.withConfig({ displayName: 'InvitePage' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`

const BackLink = styled(Link).withConfig({ displayName: 'InviteBackLink' })`
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

const Intro = styled.div.withConfig({ displayName: 'InviteIntro' })`
	${rulerUnderRule}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-bottom: var(--space-xs);
`

const Heading = styled.h2.withConfig({ displayName: 'InviteHeading' })`
	${stenciledTitle}
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
	margin: 0;
`

const Subtitle = styled.p.withConfig({ displayName: 'InviteSubtitle' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Card = styled.div.withConfig({ displayName: 'InviteCard' })`
	${brushedMetalPlate}
	padding: var(--space-md);
	border-radius: var(--shape-2xs);
`

const Form = styled.form.withConfig({ displayName: 'InviteForm' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
`

const Field = styled.div.withConfig({ displayName: 'InviteField' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const Label = styled.label.withConfig({ displayName: 'InviteLabel' })`
	${stenciledTitle}
	font-size: var(--typescale-label-medium-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
`

const RoleSelect = styled.select.withConfig({
	displayName: 'InviteRoleSelect',
})`
	${brushedMetalPlate}
	padding: var(--space-2xs) var(--space-sm);
	border: 1px solid rgba(0, 0, 0, 0.18);
	border-radius: var(--shape-2xs);
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
`

const ErrorBanner = styled.p.withConfig({ displayName: 'InviteError' })`
	margin: 0;
	padding: var(--space-2xs) var(--space-sm);
	border-left: 3px solid var(--color-error);
	background: color-mix(in srgb, var(--color-error) 6%, transparent);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-error);
`

const SuccessBanner = styled.p.withConfig({ displayName: 'InviteSuccess' })`
	margin: 0;
	padding: var(--space-2xs) var(--space-sm);
	border-left: 3px solid var(--color-status-client);
	background: color-mix(in srgb, var(--color-status-client) 6%, transparent);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	display: inline-flex;
	gap: var(--space-2xs);
	align-items: center;

	a {
		margin-left: auto;
		color: var(--color-primary);
	}
`

const Hint = styled.p.withConfig({ displayName: 'InviteHint' })`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	font-style: italic;
`
