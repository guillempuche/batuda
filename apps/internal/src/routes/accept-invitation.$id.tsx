import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import styled from 'styled-components'

import { PriButton } from '@batuda/ui/pri'

import { authClient } from '#/lib/auth-client'
import {
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

/**
 * Accept-invitation landing page. The user arrives here from the
 * invitation magic link, which already established a session — we just
 * need to call BA's `acceptInvitation` to flip the membership row from
 * `pending` to `accepted` and surface the result.
 *
 * Defensive fallback: if the user lacks a session (e.g. they shared the
 * URL with a third party who clicked it after the magic link expired),
 * we redirect to /login with `returnTo` so they sign back in and re-land
 * here.
 */

type Status = 'pending' | 'accepting' | 'accepted' | 'error' | 'unauthenticated'

export const Route = createFileRoute('/accept-invitation/$id')({
	component: AcceptInvitationPage,
})

function AcceptInvitationPage() {
	const { t } = useLingui()
	const navigate = useNavigate()
	const { id } = Route.useParams()
	const session = authClient.useSession()
	const [status, setStatus] = useState<Status>('pending')
	const [error, setError] = useState<string | null>(null)
	const [orgName, setOrgName] = useState<string | null>(null)

	useEffect(() => {
		// Wait for session to load before deciding.
		if (session.isPending) return

		if (!session.data) {
			setStatus('unauthenticated')
			return
		}

		// Avoid double-firing (StrictMode mounts the effect twice in dev).
		if (status !== 'pending') return

		setStatus('accepting')
		void (async () => {
			try {
				const result = await authClient.organization.acceptInvitation({
					invitationId: id,
				})
				if (result.error) {
					setStatus('error')
					setError(
						result.error.message ?? t`This invitation is no longer valid.`,
					)
					return
				}
				const accepted = result.data
				if (accepted && 'invitation' in accepted) {
					// BA returns { invitation, member } — neither carries the
					// org name. Fetch the active org to surface a friendly
					// confirmation, but don't block on it.
					const active = await authClient.organization.getFullOrganization()
					setOrgName(active.data?.name ?? null)
				}
				setStatus('accepted')
			} catch {
				setStatus('error')
				setError(t`No connection to the server. Try again in a few seconds.`)
			}
		})()
	}, [session.isPending, session.data, id, status, t])

	if (status === 'unauthenticated') {
		// Defer the redirect to a click so the user understands they need to
		// sign in. The magic-link path lands them already authed; this
		// branch is the "URL was shared" / "magic link expired" recovery.
		return (
			<Page>
				<Card data-testid='accept-invitation-needs-signin'>
					<Heading>
						<Trans>Sign in to accept this invitation</Trans>
					</Heading>
					<Subtitle>
						<Trans>
							The invitation link signs you in automatically. If you're seeing
							this page, the link may have expired — sign in again to continue.
						</Trans>
					</Subtitle>
					<PriButton
						type='button'
						$variant='filled'
						onClick={() => {
							void navigate({
								to: '/login',
								search: { returnTo: `/accept-invitation/${id}` },
							})
						}}
					>
						<Trans>Sign in</Trans>
					</PriButton>
				</Card>
			</Page>
		)
	}

	return (
		<Page>
			<Intro>
				<Heading>
					<Trans>Join the workspace</Trans>
				</Heading>
				<Subtitle>
					<Trans>One click to accept the invitation.</Trans>
				</Subtitle>
			</Intro>

			{status === 'pending' || status === 'accepting' ? (
				<Card data-testid='accept-invitation-pending'>
					<Spinner aria-hidden>
						<Loader2 size={20} />
					</Spinner>
					<Subtitle>
						<Trans>Accepting the invitation…</Trans>
					</Subtitle>
				</Card>
			) : null}

			{status === 'accepted' ? (
				<Card data-testid='accept-invitation-success'>
					<SuccessIcon aria-hidden>
						<CheckCircle2 size={24} />
					</SuccessIcon>
					<div>
						<CardTitle>
							{orgName
								? t`You're now a member of ${orgName}.`
								: t`You're now a member.`}
						</CardTitle>
						<Subtitle>
							<Trans>Heading to the dashboard…</Trans>
						</Subtitle>
					</div>
					<PriButton
						type='button'
						$variant='filled'
						data-testid='accept-invitation-go'
						onClick={() => {
							void navigate({ to: '/' })
						}}
					>
						<Trans>Open dashboard</Trans>
					</PriButton>
				</Card>
			) : null}

			{status === 'error' ? (
				<Card data-testid='accept-invitation-error'>
					<ErrorIcon aria-hidden>
						<XCircle size={24} />
					</ErrorIcon>
					<div>
						<CardTitle>
							<Trans>This invitation can't be accepted</Trans>
						</CardTitle>
						<Subtitle>
							{error ??
								t`The invitation may have expired or already been used.`}
						</Subtitle>
					</div>
				</Card>
			) : null}
		</Page>
	)
}

const Page = styled.div.withConfig({ displayName: 'AcceptInvitationPage' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
	max-width: 32rem;
	margin: 0 auto;
	padding: var(--space-xl) var(--space-md);
`

const Intro = styled.div.withConfig({ displayName: 'AcceptInvitationIntro' })`
	${rulerUnderRule}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-bottom: var(--space-xs);
`

const Heading = styled.h2.withConfig({
	displayName: 'AcceptInvitationHeading',
})`
	${stenciledTitle}
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
	margin: 0;
`

const Subtitle = styled.p.withConfig({
	displayName: 'AcceptInvitationSubtitle',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Card = styled.div.withConfig({ displayName: 'AcceptInvitationCard' })`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--space-md);
	padding: var(--space-lg);
	border-radius: var(--shape-2xs);
`

const CardTitle = styled.p.withConfig({
	displayName: 'AcceptInvitationCardTitle',
})`
	${stenciledTitle}
	font-size: var(--typescale-title-large-size);
	margin: 0 0 var(--space-2xs);
`

const Spinner = styled.span.withConfig({
	displayName: 'AcceptInvitationSpinner',
})`
	display: inline-flex;
	align-items: center;
	color: var(--color-primary);
	animation: spin 1s linear infinite;

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
`

const SuccessIcon = styled.span.withConfig({
	displayName: 'AcceptInvitationSuccessIcon',
})`
	color: var(--color-status-client);
`

const ErrorIcon = styled.span.withConfig({
	displayName: 'AcceptInvitationErrorIcon',
})`
	color: var(--color-error);
`
