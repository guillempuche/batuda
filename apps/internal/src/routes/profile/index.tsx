import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { LogOut, Mail, UserCircle2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import styled from 'styled-components'

import { PriButton } from '@engranatge/ui/pri'

import { LanguageSelect } from '#/components/profile/language-select'
import { getServerCookieHeader } from '#/lib/server-cookie'
import { fetchSession, type SessionUser } from '#/lib/session-check'
import {
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

/**
 * Profile page.
 *
 * Loads the current session via `fetchSession` (same helper the root
 * guard uses) so the route renders the signed-in user's name + email.
 * The sign-out button POSTs to Better-Auth's `/auth/sign-out` endpoint
 * and then client-navigates to `/login` — the root guard won't let us
 * stay on `/profile` once the cookie is gone, so the redirect is both
 * correctness and UX.
 */

const SERVER_URL =
	(typeof import.meta !== 'undefined' &&
		import.meta.env?.['VITE_SERVER_URL']) ||
	''

export const Route = createFileRoute('/profile/')({
	loader: async () => {
		let cookieHeader: string | undefined
		if (import.meta.env.SSR) {
			cookieHeader = (await getServerCookieHeader()) ?? undefined
		}
		const user = await fetchSession(cookieHeader)
		return { user }
	},
	component: ProfilePage,
})

function ProfilePage() {
	const { t } = useLingui()
	const { user } = Route.useLoaderData() as { user: SessionUser | null }
	const navigate = useNavigate()
	const [signingOut, setSigningOut] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const handleSignOut = useCallback(async () => {
		setSigningOut(true)
		setError(null)
		try {
			const res = await fetch(`${SERVER_URL}/auth/sign-out`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'content-type': 'application/json' },
			})
			if (!res.ok) {
				setError(t`Sign-out failed. Please try again.`)
				return
			}
			await navigate({ to: '/login' })
		} catch {
			setError(t`No connection to the server. Try again in a few seconds.`)
		} finally {
			setSigningOut(false)
		}
	}, [navigate, t])

	const displayName = user?.name ?? user?.email ?? t`Unknown user`
	const initial = displayName.charAt(0).toUpperCase() || 'U'

	return (
		<Page>
			<Intro>
				<Heading>
					<Trans>Profile</Trans>
				</Heading>
				<Subtitle>
					<Trans>Your Forja workbench identity.</Trans>
				</Subtitle>
			</Intro>

			<Card data-testid='profile-card'>
				<AvatarPlate>
					<Initial>{initial}</Initial>
				</AvatarPlate>
				<Info>
					<DisplayName>{displayName}</DisplayName>
					{user?.email ? (
						<MetaRow>
							<Mail size={14} aria-hidden />
							<span>{user.email}</span>
						</MetaRow>
					) : null}
					{user?.id ? (
						<MetaRow>
							<UserCircle2 size={14} aria-hidden />
							<IdText>{user.id}</IdText>
						</MetaRow>
					) : null}
				</Info>
			</Card>

			<LanguageRow data-testid='profile-language'>
				<LanguageRowLabel>
					<Trans>Language</Trans>
				</LanguageRowLabel>
				<LanguageSelect />
			</LanguageRow>

			{error ? <ErrorText role='alert'>{error}</ErrorText> : null}

			<Actions>
				<PriButton
					type='button'
					$variant='filled'
					data-testid='profile-signout'
					disabled={signingOut}
					onClick={handleSignOut}
				>
					<LogOut size={16} />
					<span>{signingOut ? t`Signing out…` : t`Sign out`}</span>
				</PriButton>
			</Actions>
		</Page>
	)
}

const Page = styled.div.withConfig({ displayName: 'ProfilePage' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`

const Intro = styled.div.withConfig({ displayName: 'ProfileIntro' })`
	${rulerUnderRule}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-bottom: var(--space-xs);
`

const Heading = styled.h2.withConfig({ displayName: 'ProfileHeading' })`
	${stenciledTitle}
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
	margin: 0;
`

const Subtitle = styled.p.withConfig({ displayName: 'ProfileSubtitle' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Card = styled.div.withConfig({ displayName: 'ProfileCard' })`
	${brushedMetalPlate}
	display: flex;
	align-items: center;
	gap: var(--space-md);
	padding: var(--space-md);
	border-radius: var(--shape-2xs);
`

const AvatarPlate = styled.div.withConfig({
	displayName: 'ProfileAvatarPlate',
})`
	width: 64px;
	height: 64px;
	border-radius: var(--shape-full);
	background: radial-gradient(
		circle at 35% 30%,
		color-mix(in oklab, var(--color-status-prospect) 88%, white) 0%,
		var(--color-status-prospect) 55%,
		color-mix(in oklab, var(--color-status-prospect) 68%, black) 100%
	);
	border: 2px solid color-mix(in oklab, var(--color-status-prospect) 60%, black);
	box-shadow:
		inset 0 2px 4px rgba(255, 255, 255, 0.35),
		inset 0 -2px 4px rgba(0, 0, 0, 0.2),
		0 2px 6px rgba(0, 0, 0, 0.25);
	display: flex;
	align-items: center;
	justify-content: center;
	color: #fff;
	flex-shrink: 0;
`

const Initial = styled.span.withConfig({ displayName: 'ProfileInitial' })`
	${stenciledTitle}
	font-size: var(--typescale-headline-small-size);
	line-height: 1;
	color: #fff;
	text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
`

const Info = styled.div.withConfig({ displayName: 'ProfileInfo' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	min-width: 0;
`

const DisplayName = styled.p.withConfig({ displayName: 'ProfileDisplayName' })`
	${stenciledTitle}
	font-size: var(--typescale-title-large-size);
	line-height: var(--typescale-title-large-line);
	margin: 0;
	overflow: hidden;
	text-overflow: ellipsis;
`

const MetaRow = styled.p.withConfig({ displayName: 'ProfileMetaRow' })`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	color: var(--color-on-surface-variant);
	min-width: 0;
`

const IdText = styled.span.withConfig({ displayName: 'ProfileIdText' })`
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
	font-size: var(--typescale-body-small-size);
	overflow: hidden;
	text-overflow: ellipsis;
`

const Actions = styled.div.withConfig({ displayName: 'ProfileActions' })`
	display: flex;
	gap: var(--space-sm);
`

const LanguageRow = styled.div.withConfig({
	displayName: 'ProfileLanguageRow',
})`
	${brushedMetalPlate}
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-md);
	padding: var(--space-sm) var(--space-md);
	border-radius: var(--shape-2xs);
`

const LanguageRowLabel = styled.span.withConfig({
	displayName: 'ProfileLanguageRowLabel',
})`
	${stenciledTitle}
	font-size: var(--typescale-label-large-size);
	line-height: var(--typescale-label-large-line);
	letter-spacing: 0.08em;
`

const ErrorText = styled.p.withConfig({ displayName: 'ProfileError' })`
	margin: 0;
	padding: var(--space-2xs) var(--space-sm);
	border-left: 3px solid var(--color-error);
	background: color-mix(in srgb, var(--color-error) 6%, transparent);
	color: var(--color-error);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
`
