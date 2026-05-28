import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import {
	createFileRoute,
	Link,
	redirect,
	useNavigate,
} from '@tanstack/react-router'
import { Schema } from 'effect'
import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriInput } from '@batuda/ui/pri'

import { PriPasswordInput } from '#/components/primitives/pri-password-input'
import { apiBaseUrl } from '#/lib/api-base'
import { normalizeEmail } from '#/lib/forms'
import { validateSearchWith } from '#/lib/search-schema'
import { getServerCookieHeader } from '#/lib/server-cookie'
import { fetchSession } from '#/lib/session-check'
import { rulerUnderRule, stenciledTitle } from '#/lib/workshop-mixins'

/**
 * `returnTo` carries the relative URL the user was trying to reach when
 * the root guard bounced them here, so we can restore their destination
 * after sign-in. Only same-origin relative paths pass — protocol-relative
 * (`//host`) and absolute URLs would be open-redirect vectors.
 */
function isSafeReturnTo(value: string): boolean {
	return value.startsWith('/') && !value.startsWith('//')
}

const safeReturnTo = (value: string | undefined): string =>
	value && isSafeReturnTo(value) ? value : '/'

/**
 * The connection request in the URL when an AI assistant (ChatGPT, Claude.ai)
 * sent the user here to sign in — otherwise empty. Read straight from the URL
 * because it's signed, and the router's parsed search would drop the parts the
 * signature covers. The `sig` marker tells a real request from a hand-typed URL.
 */
function pendingOAuthQuery(): string {
	if (typeof window === 'undefined') return ''
	const raw = window.location.search.replace(/^\?/, '')
	const params = new URLSearchParams(raw)
	return params.has('client_id') && params.has('sig') ? raw : ''
}

// Cross-tab sign-in coordination channel: when the magic-link verify
// endpoint lands the user in a fresh tab, we broadcast so the original
// `/login` tab can navigate off the stale "Check your inbox" panel.
const AUTH_CHANNEL = 'batuda-auth'

/**
 * Standalone route: `__root.tsx` skips the authenticated AppShell for
 * `/login` so this renders on a bare body. No "Create account" link
 * because public sign-up is disabled server-side (see
 * docs/backend.md#invite-only-signup).
 */

// Hoisted to module scope so TanStack infers the search type correctly;
// inline it and the `search` param in `beforeLoad` widens to `{}`.
const validateSearch = validateSearchWith({
	returnTo: Schema.NonEmptyString,
	// Set by the magic-link plugin's `errorCallbackURL` redirect on verify
	// failure — Better-Auth hard-codes the param name `error`, no template.
	error: Schema.NonEmptyString,
})

const MAGIC_LINK_EXPIRY_MINUTES = 5
const RESEND_COOLDOWN_SECONDS = 30

interface ProviderDeepLink {
	readonly host: string
	readonly label: string
	readonly url: string
}

const PROVIDER_DEEP_LINKS: ReadonlyArray<ProviderDeepLink> = [
	{ host: 'gmail.com', label: 'Gmail', url: 'https://mail.google.com' },
	{ host: 'googlemail.com', label: 'Gmail', url: 'https://mail.google.com' },
	{
		host: 'outlook.com',
		label: 'Outlook',
		url: 'https://outlook.live.com/mail',
	},
	{
		host: 'hotmail.com',
		label: 'Outlook',
		url: 'https://outlook.live.com/mail',
	},
	{
		host: 'icloud.com',
		label: 'iCloud Mail',
		url: 'https://www.icloud.com/mail',
	},
	{ host: 'proton.me', label: 'Proton Mail', url: 'https://mail.proton.me' },
	{
		host: 'protonmail.com',
		label: 'Proton Mail',
		url: 'https://mail.proton.me',
	},
	{ host: 'fastmail.com', label: 'Fastmail', url: 'https://app.fastmail.com' },
]

const providerDeepLinkFor = (email: string): ProviderDeepLink | null => {
	const host = email.split('@')[1]?.toLowerCase()
	if (!host) return null
	return PROVIDER_DEEP_LINKS.find(entry => entry.host === host) ?? null
}

export const Route = createFileRoute('/login')({
	validateSearch,
	/**
	 * If the user is already signed in, bounce them to the dashboard
	 * (or to `returnTo` if it's a safe same-origin relative URL). Runs
	 * on SSR (cookie from the incoming request headers) and on client
	 * navigations (browser attaches cookie via fetch credentials).
	 */
	beforeLoad: async ({ search }) => {
		let cookieHeader: string | undefined
		if (import.meta.env.SSR) {
			cookieHeader = (await getServerCookieHeader()) ?? undefined
		}
		const user = await fetchSession(cookieHeader)
		if (user) {
			throw redirect({ href: safeReturnTo(search.returnTo) })
		}
	},
	head: () => ({ meta: [{ title: 'Sign in — Batuda' }] }),
	component: LoginPage,
})

interface FormState {
	readonly error: string | null
}

const INITIAL_STATE: FormState = { error: null }

// Module-scope MessageDescriptors so `lingui extract` finds them
// statically; `t(descriptor)` from `useLingui()` resolves them at render.
// Defining them inside helpers that receive `t` as a parameter would
// silently ship empty strings — the macro only recognises the imported
// `msg` / `t` identifiers, not shadowed local bindings.
const MESSAGES = {
	rateLimit: msg`Too many attempts. Try again in a minute.`,
	invalidCredentials: msg`Email or password is incorrect.`,
	emailNotVerified: msg`Your email isn't verified yet. Use the magic link instead.`,
	passwordFallback: msg`Could not sign in. Check your email and password.`,
	oauthRestart: msg`That connection request expired. Start it again from your AI assistant.`,
	magicLinkFallback: msg`Could not send the link. Try again in a few seconds.`,
	network: msg`No connection to the server. Try again in a few seconds.`,
	enterValidEmail: msg`Enter a valid email above first.`,
	verifyNewUserDisabled: msg`We don't recognize that email. Ask an admin to invite you.`,
	verifyExpired: msg`That link expired. Request a fresh one below.`,
	verifyInvalid: msg`That link is no longer valid. Request a fresh one below.`,
	verifyUnknown: msg`We couldn't sign you in via that link. Try again.`,
} as const

type MagicLinkStatus =
	| { readonly kind: 'idle' }
	| { readonly kind: 'sending' }
	| { readonly kind: 'sent'; readonly email: string }
	| { readonly kind: 'error'; readonly message: string }

function LoginPage() {
	const { t } = useLingui()
	const navigate = useNavigate()
	const search = Route.useSearch()
	const emailFieldRef = useRef<HTMLInputElement | null>(null)
	const inboxHeadingRef = useRef<HTMLHeadingElement | null>(null)
	const [magicLinkStatus, setMagicLinkStatus] = useState<MagicLinkStatus>({
		kind: 'idle',
	})
	const [resendCountdown, setResendCountdown] = useState(0)

	// React 19 form action: queued even during the pre-hydration gap, so an
	// early click cannot fall through to a native submit and leak the
	// password into the URL.
	const [state, formAction, isPending] = useActionState<FormState, FormData>(
		async (_previous, formData) => {
			const email = normalizeEmail(String(formData.get('email') ?? ''))
			const password = String(formData.get('password') ?? '')
			// If an AI assistant sent the user here to connect, send its request
			// along with the sign-in so the server can carry on once they're in.
			const oauthQuery = pendingOAuthQuery()
			try {
				const response = await fetch(`${apiBaseUrl()}/auth/sign-in/email`, {
					method: 'POST',
					credentials: 'include',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(
						oauthQuery
							? { email, password, oauth_query: oauthQuery }
							: { email, password },
					),
				})
				if (!response.ok) {
					const body = (await response.json().catch(() => null)) as ErrorBody
					// The credentials were fine; the connection request itself
					// lapsed. Send them back to the assistant, not to "wrong password".
					if (oauthQuery && isOAuthQueryError(body)) {
						return { error: t(MESSAGES.oauthRestart) }
					}
					const key = passwordErrorKey(body, response.status)
					// Known codes have curated copy; unknowns defer to Better-Auth's
					// already-localized `message` and only then to our generic string.
					const error =
						key === 'fallback'
							? (body?.message ?? t(MESSAGES.passwordFallback))
							: t(MESSAGES[key])
					return { error }
				}
				// The server replies with where to send the browser next — the
				// consent screen, or back to the assistant. Go there, not into
				// the app.
				if (oauthQuery) {
					const body = (await response.json().catch(() => null)) as {
						url?: string
					} | null
					if (body?.url) {
						window.location.assign(body.url)
						return { error: null }
					}
					// No next URL came back — they're signed in, so just enter the app.
				}
				// Success — cookie is on the response. Navigate to the
				// originally requested URL (or `/`); the root's beforeLoad
				// re-checks the session and lets us through.
				await navigate({ href: safeReturnTo(search.returnTo) })
				return { error: null }
			} catch (cause) {
				console.error('[Login] sign-in failed:', cause)
				return { error: t(MESSAGES.network) }
			}
		},
		INITIAL_STATE,
	)

	// Verify-time errors land back here via the magic-link plugin's
	// errorCallbackURL, which appends `?error=<code>` to the URL we passed.
	const verifyError = useMemo(() => {
		const key = magicLinkVerifyErrorKey(search.error)
		if (!key) return null
		return t(MESSAGES[key])
	}, [search.error, t])

	// Resend cooldown ticker — stops the user from mashing the button into
	// a 429 from Better-Auth's per-route rate limit.
	useEffect(() => {
		if (resendCountdown <= 0) return
		const id = setTimeout(() => {
			setResendCountdown(value => Math.max(0, value - 1))
		}, 1_000)
		return () => {
			clearTimeout(id)
		}
	}, [resendCountdown])

	// When the magic-link verify endpoint lands the user in a fresh tab,
	// the original /login tab is left on the stale inbox panel. Listen for
	// the sibling navigation event so we follow them off the page.
	useEffect(() => {
		if (typeof BroadcastChannel === 'undefined') return
		const channel = new BroadcastChannel(AUTH_CHANNEL)
		channel.onmessage = event => {
			if (event.data?.kind === 'signed-in') {
				void navigate({ href: safeReturnTo(search.returnTo) })
			}
		}
		return () => {
			channel.close()
		}
	}, [navigate, search.returnTo])

	// Focus management on swap: when the form is replaced by the inbox
	// panel, focus follows the heading so screen readers re-anchor.
	useEffect(() => {
		if (magicLinkStatus.kind === 'sent' && inboxHeadingRef.current) {
			inboxHeadingRef.current.focus()
		}
	}, [magicLinkStatus.kind])

	const sendMagicLink = async (email: string) => {
		setMagicLinkStatus({ kind: 'sending' })
		try {
			const callbackURL = absoluteUrl(safeReturnTo(search.returnTo))
			// Better-Auth appends `?error=<code>` here on verify failure.
			const errorCallbackURL = absoluteUrl('/login')
			const response = await fetch(`${apiBaseUrl()}/auth/sign-in/magic-link`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email, callbackURL, errorCallbackURL }),
			})
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as ErrorBody
				const key = magicLinkErrorKey(response.status)
				// 429 has curated copy; everything else prefers Better-Auth's
				// already-localized `message` over our generic fallback.
				const message =
					key === 'rateLimit'
						? t(MESSAGES.rateLimit)
						: (body?.message ?? t(MESSAGES.magicLinkFallback))
				setMagicLinkStatus({ kind: 'error', message })
				return
			}
			setMagicLinkStatus({ kind: 'sent', email })
			setResendCountdown(RESEND_COOLDOWN_SECONDS)
		} catch (cause) {
			console.error('[Login] magic-link request failed:', cause)
			setMagicLinkStatus({ kind: 'error', message: t(MESSAGES.network) })
		}
	}

	const requestMagicLink = () => {
		const email = normalizeEmail(emailFieldRef.current?.value ?? '')
		if (!isLikelyEmail(email)) {
			setMagicLinkStatus({
				kind: 'error',
				message: t(MESSAGES.enterValidEmail),
			})
			return
		}
		void sendMagicLink(email)
	}

	const resendMagicLink = () => {
		if (magicLinkStatus.kind !== 'sent') return
		if (resendCountdown > 0) return
		void sendMagicLink(magicLinkStatus.email)
	}

	const changeEmail = () => {
		setMagicLinkStatus({ kind: 'idle' })
		setResendCountdown(0)
		requestAnimationFrame(() => {
			if (emailFieldRef.current) {
				emailFieldRef.current.value = ''
				emailFieldRef.current.focus()
			}
		})
	}

	const usePasswordInstead = () => {
		setMagicLinkStatus({ kind: 'idle' })
		setResendCountdown(0)
	}

	if (magicLinkStatus.kind === 'sent') {
		return (
			<InboxView
				email={magicLinkStatus.email}
				resendCountdown={resendCountdown}
				onResend={resendMagicLink}
				onChangeEmail={changeEmail}
				onUsePassword={usePasswordInstead}
				headingRef={inboxHeadingRef}
			/>
		)
	}

	return (
		<Page>
			<Card>
				<Brand>Batuda</Brand>
				<Subtitle>
					<Trans>Sign in to continue</Trans>
				</Subtitle>
				{verifyError ? (
					<ErrorText role='alert' data-testid='login-magic-link-error'>
						{verifyError}
					</ErrorText>
				) : null}
				<Form action={formAction} data-testid='login-form'>
					<Field>
						<Label htmlFor='email'>
							<Trans>Email</Trans>
						</Label>
						<PriInput
							id='email'
							name='email'
							type='email'
							autoComplete='email'
							required
							ref={emailFieldRef}
							disabled={isPending || magicLinkStatus.kind === 'sending'}
							data-testid='login-email'
						/>
					</Field>
					<Field>
						<Label htmlFor='password'>
							<Trans>Password</Trans>
						</Label>
						<PriPasswordInput
							id='password'
							name='password'
							autoComplete='current-password'
							required
							disabled={isPending || magicLinkStatus.kind === 'sending'}
							data-testid='login-password'
						/>
					</Field>
					{state.error ? (
						<ErrorText role='alert' data-testid='login-error'>
							{state.error}
						</ErrorText>
					) : null}
					<SubmitButton
						type='submit'
						disabled={isPending || magicLinkStatus.kind === 'sending'}
						$variant='filled'
						data-testid='login-submit'
					>
						{isPending ? t`Signing in…` : t`Sign in`}
					</SubmitButton>
				</Form>
				<MagicLinkRow>
					<MagicLinkTrigger
						type='button'
						onClick={requestMagicLink}
						disabled={isPending || magicLinkStatus.kind === 'sending'}
						data-testid='login-magic-link-trigger'
					>
						{magicLinkStatus.kind === 'sending'
							? t`Sending…`
							: t`Email me a sign-in link`}
					</MagicLinkTrigger>
					<MagicLinkTrigger
						as={Link}
						to='/forgot-password'
						data-testid='login-forgot-password'
					>
						<Trans>Forgot password?</Trans>
					</MagicLinkTrigger>
				</MagicLinkRow>
				{magicLinkStatus.kind === 'error' ? (
					<ErrorText role='alert' data-testid='login-magic-link-error'>
						{magicLinkStatus.message}
					</ErrorText>
				) : null}
				<Hint>
					<Trans>
						Batuda is invite-only. Request access from the Engranatge team.
					</Trans>
				</Hint>
			</Card>
		</Page>
	)
}

interface InboxViewProps {
	readonly email: string
	readonly resendCountdown: number
	readonly onResend: () => void
	readonly onChangeEmail: () => void
	readonly onUsePassword: () => void
	readonly headingRef: React.RefObject<HTMLHeadingElement | null>
}

function InboxView({
	email,
	resendCountdown,
	onResend,
	onChangeEmail,
	onUsePassword,
	headingRef,
}: InboxViewProps) {
	const { t } = useLingui()
	const provider = providerDeepLinkFor(email)

	return (
		<Page>
			<Card
				role='status'
				aria-live='polite'
				data-testid='magic-link-sent-panel'
			>
				<Brand>Batuda</Brand>
				<InboxHeading ref={headingRef} tabIndex={-1}>
					<Trans>Check your inbox</Trans>
				</InboxHeading>
				<Subtitle>
					<Trans>We sent a sign-in link to</Trans>{' '}
					<strong data-testid='magic-link-sent-email'>{email}</strong>.
				</Subtitle>
				<Subtitle>
					<Trans>
						It expires in {MAGIC_LINK_EXPIRY_MINUTES} minutes. Not seeing it?
						Check spam.
					</Trans>
				</Subtitle>
				<ButtonRow>
					<PriButton
						type='button'
						$variant='filled'
						onClick={onResend}
						disabled={resendCountdown > 0}
						data-testid='magic-link-resend'
					>
						{resendCountdown > 0 ? (
							<>
								<Trans>Resend in</Trans>{' '}
								<span data-testid='magic-link-resend-countdown'>
									{resendCountdown}s
								</span>
							</>
						) : (
							t`Resend link`
						)}
					</PriButton>
					{provider ? (
						<PriButton
							type='button'
							$variant='outlined'
							onClick={() => {
								window.open(provider.url, '_blank', 'noopener,noreferrer')
							}}
							data-testid='magic-link-open-provider'
						>
							<Trans>Open {provider.label}</Trans>
						</PriButton>
					) : null}
				</ButtonRow>
				<SecondaryRow>
					<SecondaryLink
						type='button'
						onClick={onChangeEmail}
						data-testid='magic-link-change-email'
					>
						<Trans>Use a different email</Trans>
					</SecondaryLink>
					<SecondaryLink
						type='button'
						onClick={onUsePassword}
						data-testid='magic-link-use-password'
					>
						<Trans>Use password instead</Trans>
					</SecondaryLink>
				</SecondaryRow>
			</Card>
		</Page>
	)
}

// --- helpers ----------------------------------------------------------------

// Shape of Better-Auth's error responses. The literal return-type unions on
// the helpers below are load-bearing: they let the call-site narrow against
// `MESSAGES` and let TS catch a missing key the moment one is added here.
type ErrorBody = { code?: string; message?: string; error?: string } | null

// A forwarded authorize query that's expired or tampered fails sign-in with
// this code (not a credential error), so the user can be pointed back to their
// assistant instead of being told their password is wrong.
const isOAuthQueryError = (body: ErrorBody): boolean =>
	body?.error === 'invalid_signature' || body?.code === 'invalid_signature'

// HTTP 429 short-circuits the body — Better-Auth's rate-limit response has
// no `code`, so status has to be checked before `body.code`.
const passwordErrorKey = (
	body: ErrorBody,
	status: number,
): 'rateLimit' | 'invalidCredentials' | 'emailNotVerified' | 'fallback' => {
	if (status === 429) return 'rateLimit'
	switch (body?.code) {
		case 'INVALID_EMAIL_OR_PASSWORD':
			return 'invalidCredentials'
		case 'EMAIL_NOT_VERIFIED':
			return 'emailNotVerified'
		default:
			return 'fallback'
	}
}

// Magic-link send has no body-level codes worth distinguishing — only
// the 429 needs a custom message, everything else defers to the body.
const magicLinkErrorKey = (
	status: number,
): 'rateLimit' | 'magicLinkFallback' =>
	status === 429 ? 'rateLimit' : 'magicLinkFallback'

// Codes arrive via `?error=` from the magic-link plugin's errorCallbackURL.
// `new_user_signup_disabled` is lowercase because Better-Auth emits it from
// the signup path, the others are SCREAMING_SNAKE from the verify path.
const magicLinkVerifyErrorKey = (
	code: string | undefined,
):
	| 'verifyNewUserDisabled'
	| 'verifyExpired'
	| 'verifyInvalid'
	| 'verifyUnknown'
	| null => {
	if (!code) return null
	switch (code) {
		case 'new_user_signup_disabled':
			return 'verifyNewUserDisabled'
		case 'EXPIRED_TOKEN':
			return 'verifyExpired'
		case 'INVALID_TOKEN':
		case 'ATTEMPTS_EXCEEDED':
			return 'verifyInvalid'
		default:
			return 'verifyUnknown'
	}
}

const isLikelyEmail = (value: string): boolean =>
	value.length > 3 && value.includes('@') && !value.includes(' ')

const absoluteUrl = (path: string, query?: Record<string, string>): string => {
	const origin =
		typeof window !== 'undefined' && window.location?.origin
			? window.location.origin
			: 'http://localhost'
	const url = new URL(path, origin)
	if (query) {
		for (const [key, value] of Object.entries(query)) {
			url.searchParams.set(key, value)
		}
	}
	return url.toString()
}

// --- styled components ------------------------------------------------------

const Page = styled.div.withConfig({ displayName: 'LoginPage' })`
	min-height: 100dvh;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: var(--space-lg);
	background-color: var(--color-pegboard);
	background-image:
		radial-gradient(
			circle,
			rgba(80, 60, 40, 0.18) 1px,
			transparent 1px
		);
	background-size: 24px 24px;
`

const Card = styled.div.withConfig({ displayName: 'LoginCard' })`
	position: relative;
	width: 100%;
	max-width: 26rem;
	padding: var(--space-xl) var(--space-xl) var(--space-lg);
	background-color: var(--color-paper-aged);
	background-image:
		radial-gradient(
			ellipse 80px 60px at 15% 20%,
			rgba(180, 155, 120, 0.08) 0%,
			transparent 100%
		),
		radial-gradient(
			ellipse 80px 60px at 85% 80%,
			var(--color-paper-fibre-a) 0%,
			transparent 100%
		);
	border: 1px solid rgba(120, 95, 60, 0.45);
	box-shadow:
		var(--shadow-paper-inset),
		0 6px 20px rgba(0, 0, 0, 0.28);
	display: flex;
	flex-direction: column;
	gap: var(--space-md);

	/* Masking tape strip at top-left */
	&::before {
		content: '';
		position: absolute;
		top: -10px;
		left: -10px;
		width: 82px;
		height: 22px;
		background: linear-gradient(
			180deg,
			rgba(244, 232, 196, 0.88) 0%,
			rgba(226, 210, 166, 0.85) 100%
		);
		border: 1px solid rgba(0, 0, 0, 0.08);
		transform: rotate(-4deg);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
		pointer-events: none;
	}
`

const Brand = styled.h1.withConfig({ displayName: 'LoginBrand' })`
	${stenciledTitle}
	font-size: var(--typescale-display-small-size);
	line-height: var(--typescale-display-small-line);
	letter-spacing: 0.1em;
	color: var(--color-primary);
	margin: 0;
`

const Subtitle = styled.p.withConfig({ displayName: 'LoginSubtitle' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Form = styled.form.withConfig({ displayName: 'LoginForm' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
	margin-top: var(--space-sm);
`

const Field = styled.div.withConfig({ displayName: 'LoginField' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const Label = styled.label.withConfig({ displayName: 'LoginLabel' })`
	${stenciledTitle}
	font-size: var(--typescale-label-small-size);
`

const ErrorText = styled.p.withConfig({ displayName: 'LoginError' })`
	padding: var(--space-2xs) var(--space-sm);
	border-left: 3px solid var(--color-error);
	background: color-mix(in srgb, var(--color-error) 6%, transparent);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	font-style: italic;
	color: var(--color-error);
	margin: 0;
`

const SubmitButton = styled(PriButton).withConfig({
	displayName: 'LoginSubmit',
})`
	margin-top: var(--space-xs);
`

const MagicLinkRow = styled.div.withConfig({
	displayName: 'LoginMagicLinkRow',
})`
	display: flex;
	justify-content: center;
	margin-top: calc(var(--space-xs) * -1);
`

const MagicLinkTrigger = styled.button.withConfig({
	displayName: 'LoginMagicLinkTrigger',
})`
	background: none;
	border: none;
	padding: var(--space-2xs) var(--space-xs);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-primary);
	text-decoration: underline;
	text-underline-offset: 3px;
	cursor: pointer;

	&:hover:not(:disabled) {
		color: var(--color-on-surface);
	}

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
		border-radius: var(--shape-2xs);
	}

	&:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
`

const InboxHeading = styled.h2.withConfig({
	displayName: 'LoginInboxHeading',
})`
	${stenciledTitle}
	font-size: var(--typescale-headline-small-size);
	margin: 0;
	&:focus {
		outline: none;
	}
`

const ButtonRow = styled.div.withConfig({ displayName: 'LoginInboxButtonRow' })`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-sm);
	margin-top: var(--space-xs);
`

const SecondaryRow = styled.div.withConfig({
	displayName: 'LoginInboxSecondaryRow',
})`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-md);
	margin-top: var(--space-xs);
`

const SecondaryLink = styled.button.withConfig({
	displayName: 'LoginInboxSecondaryLink',
})`
	background: none;
	border: none;
	padding: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-primary);
	text-decoration: underline;
	cursor: pointer;

	&:hover {
		color: var(--color-on-surface);
	}

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
		border-radius: var(--shape-2xs);
	}
`

const Hint = styled.p.withConfig({ displayName: 'LoginHint' })`
	${rulerUnderRule}
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	font-style: italic;
	color: var(--color-on-surface-variant);
	text-align: center;
	margin: 0;
	padding-top: var(--space-xs);
	background-position: left top;
`
