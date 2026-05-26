import { Trans, useLingui } from '@lingui/react/macro'
import {
	createFileRoute,
	Link,
	useNavigate,
	useRouter,
} from '@tanstack/react-router'
import { Building2, KeyRound, LogOut, Mail, UserCircle2 } from 'lucide-react'
import { useActionState, useRef, useState } from 'react'
import styled from 'styled-components'

import { PriButton } from '@batuda/ui/pri'

import { PriPasswordInput } from '#/components/primitives/pri-password-input'
import { LanguageSelect } from '#/components/profile/language-select'
import { apiBaseUrl } from '#/lib/api-base'
import { authClient } from '#/lib/auth-client'
import {
	fetchSecurityState,
	type SecurityState,
	setFirstPassword,
	setPasswordOptOut,
} from '#/lib/security-state'
import { getServerCookieHeader } from '#/lib/server-cookie'
import { fetchSession, type SessionUser } from '#/lib/session-check'
import {
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

const MIN_PASSWORD_LENGTH = 8

export const Route = createFileRoute('/settings/profile/')({
	loader: async () => {
		let cookieHeader: string | undefined
		if (import.meta.env.SSR) {
			cookieHeader = (await getServerCookieHeader()) ?? undefined
		}
		const [user, securityState] = await Promise.all([
			fetchSession(cookieHeader),
			fetchSecurityState(cookieHeader),
		])
		return { user, securityState }
	},
	head: () => ({ meta: [{ title: 'Profile — Batuda' }] }),
	component: ProfilePage,
})

interface SignOutState {
	readonly error: string | null
}

const INITIAL_SIGN_OUT_STATE: SignOutState = { error: null }

function ProfilePage() {
	const { t } = useLingui()
	const { user, securityState } = Route.useLoaderData() as {
		user: SessionUser | null
		securityState: SecurityState | null
	}
	const navigate = useNavigate()

	const [signOutState, signOutAction, isSigningOut] = useActionState<
		SignOutState,
		FormData
	>(async () => {
		try {
			const res = await fetch(`${apiBaseUrl()}/auth/sign-out`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'content-type': 'application/json' },
				body: '{}',
			})
			if (!res.ok) {
				return { error: t`Sign-out failed. Please try again.` }
			}
			await navigate({ to: '/login' })
			return { error: null }
		} catch {
			return {
				error: t`No connection to the server. Try again in a few seconds.`,
			}
		}
	}, INITIAL_SIGN_OUT_STATE)

	const displayName = user?.name ?? user?.email ?? t`Unknown user`
	const initial = displayName.charAt(0).toUpperCase() || 'U'

	return (
		<Page>
			<Intro>
				<Heading>
					<Trans>Profile</Trans>
				</Heading>
				<Subtitle>
					<Trans>Your Batuda workbench identity.</Trans>
				</Subtitle>
			</Intro>

			<SettingsNav aria-label={t`Settings`}>
				<NavRow
					to='/settings/organization'
					data-testid='settings-nav-organization'
				>
					<Building2 size={16} aria-hidden />
					<span>
						<Trans>Organization</Trans>
					</span>
				</NavRow>
				<NavRow to='/settings/api-keys' data-testid='settings-nav-api-keys'>
					<KeyRound size={16} aria-hidden />
					<span>
						<Trans>API keys</Trans>
					</span>
				</NavRow>
			</SettingsNav>

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

			{securityState ? <PasswordCard state={securityState} /> : null}

			{signOutState.error ? (
				<ErrorText role='alert'>{signOutState.error}</ErrorText>
			) : null}

			<SignOutForm action={signOutAction}>
				<PriButton
					type='submit'
					$variant='filled'
					data-testid='profile-signout'
					disabled={isSigningOut}
				>
					<LogOut size={16} />
					<span>{isSigningOut ? t`Signing out…` : t`Sign out`}</span>
				</PriButton>
			</SignOutForm>
		</Page>
	)
}

interface PasswordCardProps {
	readonly state: SecurityState
}

function PasswordCard({ state }: PasswordCardProps) {
	if (state.hasPassword) {
		return <ChangePasswordCard />
	}
	if (state.passwordOptOut) {
		return <OptedOutCard />
	}
	return <SetPasswordCard />
}

function SetPasswordCard() {
	const router = useRouter()
	const [status, setStatus] = useState<
		| 'idle'
		| 'submitting'
		| 'mismatch'
		| 'too-short'
		| 'already-set'
		| 'error'
		| 'opting-out'
	>('idle')

	// Inputs stay DOM-owned and are read via FormData on submit: BaseUI's
	// FieldControl wires its own `onValueChange`, so a React `value`+`onChange`
	// pair would never update and the field would appear empty.
	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const form = new FormData(event.currentTarget)
		const newPassword = String(form.get('newPassword') ?? '')
		const confirmPassword = String(form.get('newPasswordConfirm') ?? '')
		if (newPassword.length < MIN_PASSWORD_LENGTH) {
			setStatus('too-short')
			return
		}
		if (newPassword !== confirmPassword) {
			setStatus('mismatch')
			return
		}
		setStatus('submitting')
		const result = await setFirstPassword(newPassword)
		if (!result.ok) {
			// PASSWORD_ALREADY_SET fires when another tab beat us to it.
			// Re-render the loader so the card flips to the change form.
			if (result.code === 'PASSWORD_ALREADY_SET') {
				setStatus('already-set')
				await router.invalidate()
				return
			}
			setStatus('error')
			return
		}
		setStatus('idle')
		await router.invalidate()
	}

	const handleOptOut = async () => {
		setStatus('opting-out')
		const ok = await setPasswordOptOut(true)
		if (!ok) {
			setStatus('error')
			return
		}
		setStatus('idle')
		await router.invalidate()
	}

	return (
		<SecurityCard data-testid='profile-password-card'>
			<SecurityCardHeading>
				<Trans>Set a password</Trans>
			</SecurityCardHeading>
			<SecurityCardBody>
				<Trans>
					You currently sign in from email links. Add a password to skip
					checking your email next time.
				</Trans>
			</SecurityCardBody>
			<PasswordForm onSubmit={handleSubmit} data-testid='set-password-form'>
				<FieldRow>
					<FieldLabel htmlFor='set-password-new'>
						<Trans>New password</Trans>
					</FieldLabel>
					<PriPasswordInput
						id='set-password-new'
						name='newPassword'
						autoComplete='new-password'
						required
						minLength={MIN_PASSWORD_LENGTH}
						data-testid='set-password-new'
					/>
				</FieldRow>
				<FieldRow>
					<FieldLabel htmlFor='set-password-confirm'>
						<Trans>Repeat new password</Trans>
					</FieldLabel>
					<PriPasswordInput
						id='set-password-confirm'
						name='newPasswordConfirm'
						autoComplete='new-password'
						required
						minLength={MIN_PASSWORD_LENGTH}
						data-testid='set-password-confirm'
					/>
				</FieldRow>
				{status === 'too-short' ? (
					<StatusText role='alert' data-testid='set-password-error'>
						<Trans>
							Passwords need at least {MIN_PASSWORD_LENGTH} characters.
						</Trans>
					</StatusText>
				) : null}
				{status === 'mismatch' ? (
					<StatusText role='alert' data-testid='set-password-error'>
						<Trans>The two password fields don't match.</Trans>
					</StatusText>
				) : null}
				{status === 'error' ? (
					<StatusText role='alert' data-testid='set-password-error'>
						<Trans>Something went wrong. Try again.</Trans>
					</StatusText>
				) : null}
				<ActionsRow>
					<PriButton
						type='submit'
						$variant='filled'
						disabled={status === 'submitting' || status === 'opting-out'}
						data-testid='set-password-submit'
					>
						{status === 'submitting' ? (
							<Trans>Saving…</Trans>
						) : (
							<Trans>Save password</Trans>
						)}
					</PriButton>
					<TextButton
						type='button'
						onClick={handleOptOut}
						disabled={status === 'submitting' || status === 'opting-out'}
						data-testid='passwordless-only-toggle'
					>
						<Trans>I prefer passwordless — don't ask me again</Trans>
					</TextButton>
				</ActionsRow>
			</PasswordForm>
		</SecurityCard>
	)
}

function OptedOutCard() {
	const router = useRouter()
	const [status, setStatus] = useState<'idle' | 'undoing' | 'error'>('idle')

	const handleUndo = async () => {
		setStatus('undoing')
		const ok = await setPasswordOptOut(false)
		if (!ok) {
			setStatus('error')
			return
		}
		setStatus('idle')
		await router.invalidate()
	}

	return (
		<SecurityCard data-testid='profile-password-card-opted-out'>
			<SecurityCardHeading>
				<Trans>Passwordless sign-in only</Trans>
			</SecurityCardHeading>
			<SecurityCardBody>
				<Trans>You sign in from email links. I won't bring it up again.</Trans>
			</SecurityCardBody>
			<ActionsRow>
				<TextButton
					type='button'
					onClick={handleUndo}
					disabled={status === 'undoing'}
					data-testid='passwordless-only-undo'
				>
					<Trans>Change my mind — set a password anyway</Trans>
				</TextButton>
			</ActionsRow>
			{status === 'error' ? (
				<StatusText role='alert' data-testid='set-password-error'>
					<Trans>Couldn't update your preference. Try again.</Trans>
				</StatusText>
			) : null}
		</SecurityCard>
	)
}

function ChangePasswordCard() {
	const formRef = useRef<HTMLFormElement | null>(null)
	const [status, setStatus] = useState<
		| 'idle'
		| 'submitting'
		| 'mismatch'
		| 'too-short'
		| 'wrong-current'
		| 'error'
		| 'success'
	>('idle')

	// Uncontrolled inputs; see SetPasswordCard for the rationale
	// (BaseUI FieldControl owns onChange, so React controlled state
	// never updates from typing).
	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const form = new FormData(event.currentTarget)
		const currentPassword = String(form.get('currentPassword') ?? '')
		const newPassword = String(form.get('newPassword') ?? '')
		const confirmPassword = String(form.get('newPasswordConfirm') ?? '')
		if (newPassword.length < MIN_PASSWORD_LENGTH) {
			setStatus('too-short')
			return
		}
		if (newPassword !== confirmPassword) {
			setStatus('mismatch')
			return
		}
		setStatus('submitting')
		const { error } = await authClient.changePassword({
			currentPassword,
			newPassword,
			revokeOtherSessions: true,
		})
		if (error) {
			// `changePassword` returns INVALID_PASSWORD when the current password
			// doesn't match — code stays stable across locale, message doesn't.
			setStatus(error.code === 'INVALID_PASSWORD' ? 'wrong-current' : 'error')
			return
		}
		formRef.current?.reset()
		setStatus('success')
	}

	return (
		<SecurityCard data-testid='profile-password-card'>
			<SecurityCardHeading>
				<Trans>Change password</Trans>
			</SecurityCardHeading>
			<SecurityCardBody>
				<Trans>
					Pick a new password. Other signed-in devices will be signed out.
				</Trans>
			</SecurityCardBody>
			<PasswordForm
				ref={formRef}
				onSubmit={handleSubmit}
				data-testid='change-password-form'
			>
				<FieldRow>
					<FieldLabel htmlFor='change-password-current'>
						<Trans>Current password</Trans>
					</FieldLabel>
					<PriPasswordInput
						id='change-password-current'
						name='currentPassword'
						autoComplete='current-password'
						required
						data-testid='change-password-current'
					/>
				</FieldRow>
				<FieldRow>
					<FieldLabel htmlFor='change-password-new'>
						<Trans>New password</Trans>
					</FieldLabel>
					<PriPasswordInput
						id='change-password-new'
						name='newPassword'
						autoComplete='new-password'
						required
						minLength={MIN_PASSWORD_LENGTH}
						data-testid='change-password-new'
					/>
				</FieldRow>
				<FieldRow>
					<FieldLabel htmlFor='change-password-confirm'>
						<Trans>Repeat new password</Trans>
					</FieldLabel>
					<PriPasswordInput
						id='change-password-confirm'
						name='newPasswordConfirm'
						autoComplete='new-password'
						required
						minLength={MIN_PASSWORD_LENGTH}
						data-testid='change-password-confirm'
					/>
				</FieldRow>
				{status === 'too-short' ? (
					<StatusText role='alert' data-testid='change-password-error'>
						<Trans>
							Passwords need at least {MIN_PASSWORD_LENGTH} characters.
						</Trans>
					</StatusText>
				) : null}
				{status === 'mismatch' ? (
					<StatusText role='alert' data-testid='change-password-error'>
						<Trans>The two new password fields don't match.</Trans>
					</StatusText>
				) : null}
				{status === 'wrong-current' ? (
					<StatusText role='alert' data-testid='change-password-error'>
						<Trans>Current password is incorrect.</Trans>
					</StatusText>
				) : null}
				{status === 'error' ? (
					<StatusText role='alert' data-testid='change-password-error'>
						<Trans>Something went wrong. Try again.</Trans>
					</StatusText>
				) : null}
				{status === 'success' ? (
					<SuccessText role='status' data-testid='change-password-success'>
						<Trans>Password updated.</Trans>
					</SuccessText>
				) : null}
				<ActionsRow>
					<PriButton
						type='submit'
						$variant='filled'
						disabled={status === 'submitting'}
						data-testid='change-password-submit'
					>
						{status === 'submitting' ? (
							<Trans>Saving…</Trans>
						) : (
							<Trans>Change password</Trans>
						)}
					</PriButton>
				</ActionsRow>
			</PasswordForm>
		</SecurityCard>
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

const SettingsNav = styled.nav.withConfig({
	displayName: 'ProfileSettingsNav',
})`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-sm);
`

const NavRow = styled(Link).withConfig({
	displayName: 'ProfileSettingsNavRow',
})`
	${brushedMetalPlate}
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-md);
	border-radius: var(--shape-3xs);
	color: var(--color-on-surface);
	text-decoration: none;
	font-family: var(--font-display);
	font-size: var(--typescale-label-large-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	transition: box-shadow 160ms ease;

	&:hover {
		box-shadow: var(--elevation-workshop-md);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
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

const SignOutForm = styled.form.withConfig({
	displayName: 'ProfileSignOutForm',
})`
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

const SecurityCard = styled.section.withConfig({
	displayName: 'ProfileSecurityCard',
})`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md);
	border-radius: var(--shape-2xs);
`

const SecurityCardHeading = styled.h3.withConfig({
	displayName: 'ProfileSecurityHeading',
})`
	${stenciledTitle}
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
	margin: 0;
`

const SecurityCardBody = styled.p.withConfig({
	displayName: 'ProfileSecurityBody',
})`
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	color: var(--color-on-surface-variant);
`

const PasswordForm = styled.form.withConfig({
	displayName: 'ProfilePasswordForm',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
`

const FieldRow = styled.div.withConfig({ displayName: 'ProfileFieldRow' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const FieldLabel = styled.label.withConfig({
	displayName: 'ProfileFieldLabel',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-label-medium-size);
	line-height: var(--typescale-label-medium-line);
	color: var(--color-on-surface-variant);
`

const ActionsRow = styled.div.withConfig({ displayName: 'ProfileActionsRow' })`
	display: flex;
	align-items: center;
	gap: var(--space-md);
	flex-wrap: wrap;
`

const TextButton = styled.button.withConfig({
	displayName: 'ProfileTextButton',
})`
	background: none;
	border: none;
	padding: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	cursor: pointer;
	text-decoration: underline;

	&:hover:not(:disabled) {
		color: var(--color-on-surface);
	}

	&:disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}
`

const StatusText = styled.p.withConfig({ displayName: 'ProfileStatusText' })`
	margin: 0;
	padding: var(--space-2xs) var(--space-sm);
	border-left: 3px solid var(--color-error);
	background: color-mix(in srgb, var(--color-error) 6%, transparent);
	color: var(--color-error);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
`

const SuccessText = styled.p.withConfig({ displayName: 'ProfileSuccessText' })`
	margin: 0;
	padding: var(--space-2xs) var(--space-sm);
	border-left: 3px solid var(--color-primary);
	background: color-mix(in srgb, var(--color-primary) 6%, transparent);
	color: var(--color-primary);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
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
