import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriInput } from '@engranatge/ui/pri'

import { fetchSession } from '#/lib/session-check'
import { rulerUnderRule, stenciledTitle } from '#/lib/workshop-mixins'

/**
 * Login page search params. `returnTo` captures the full relative URL
 * (pathname + search string) the user was trying to reach when the
 * `__root.tsx` guard bounced them here, so we can send them back to
 * exactly where they wanted to be after a successful sign-in. Only
 * same-origin relative paths are honored (leading `/` and no
 * protocol/host) — anything else falls back to `/` to defeat open-
 * redirect abuse.
 */
type LoginSearch = { returnTo?: string }

function isSafeReturnTo(value: string): boolean {
	// Must be a same-origin relative URL: starts with `/` and doesn't
	// start with `//` (which would be a protocol-relative URL that the
	// browser resolves to a different host).
	return value.startsWith('/') && !value.startsWith('//')
}

/**
 * Login page.
 *
 * Completely standalone — `__root.tsx` detects the `/login` path and
 * skips the authenticated AppShell, so this route renders on a bare
 * body. The form POSTs to Better-Auth's `/auth/sign-in/email` endpoint
 * on the API server; on success, the server sets the `forja.*` session
 * cookie (cross-origin, `credentials: 'include'` from the fetch here
 * and `access-control-allow-credentials` from our CORS middleware),
 * and we client-navigate to `/`.
 *
 * Public sign-up is disabled on the server — see
 * `docs/backend.md#invite-only-signup` — so this page deliberately has
 * no "Create account" link. New users are provisioned via the admin
 * plugin by an existing admin or an API-key-authenticated caller.
 */

const SERVER_URL =
	(typeof import.meta !== 'undefined' &&
		import.meta.env?.['VITE_SERVER_URL']) ||
	'http://localhost:3010'

export const Route = createFileRoute('/login')({
	validateSearch: (search: Record<string, unknown>): LoginSearch => {
		const raw = search['returnTo']
		return typeof raw === 'string' ? { returnTo: raw } : {}
	},
	/**
	 * If the user is already signed in, bounce them to the dashboard
	 * (or to `returnTo` if it's a safe same-origin relative URL). Runs
	 * on SSR (cookie from the incoming request headers) and on client
	 * navigations (browser attaches cookie via fetch credentials).
	 */
	beforeLoad: async ({ search }) => {
		let cookieHeader: string | undefined
		if (import.meta.env.SSR) {
			const { getRequestHeader } = await import('@tanstack/react-start/server')
			cookieHeader = getRequestHeader('cookie')
		}
		const user = await fetchSession(cookieHeader)
		if (user) {
			const target =
				search.returnTo && isSafeReturnTo(search.returnTo)
					? search.returnTo
					: '/'
			throw redirect({ href: target })
		}
	},
	component: LoginPage,
})

function LoginPage() {
	const { t } = useLingui()
	const navigate = useNavigate()
	const search = Route.useSearch()
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [submitting, setSubmitting] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const handleSubmit = useCallback(
		async (event: React.FormEvent<HTMLFormElement>) => {
			event.preventDefault()
			setSubmitting(true)
			setError(null)
			try {
				const res = await fetch(`${SERVER_URL}/auth/sign-in/email`, {
					method: 'POST',
					credentials: 'include',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ email, password }),
				})
				if (!res.ok) {
					const body = (await res.json().catch(() => null)) as {
						message?: string
					} | null
					setError(
						body?.message ??
							t`Could not sign in. Check your email and password.`,
					)
					return
				}
				// Success — cookie is set on the response. Navigate back to
				// the page the user originally tried to reach, or to the
				// dashboard as a fallback. We use `href` so the full URL
				// (pathname + search + hash) round-trips cleanly; the root's
				// `beforeLoad` will re-check the session and let us through.
				const target =
					search.returnTo && isSafeReturnTo(search.returnTo)
						? search.returnTo
						: '/'
				await navigate({ href: target })
			} catch (err) {
				console.error('[Login] sign-in failed:', err)
				setError(t`No connection to the server. Try again in a few seconds.`)
			} finally {
				setSubmitting(false)
			}
		},
		[email, password, navigate],
	)

	return (
		<Page>
			<Card>
				<Brand>Forja</Brand>
				<Subtitle>
					<Trans>Engranatge internal CRM</Trans>
				</Subtitle>
				<Form onSubmit={handleSubmit}>
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
							value={email}
							onChange={e => setEmail(e.currentTarget.value)}
							disabled={submitting}
						/>
					</Field>
					<Field>
						<Label htmlFor='password'>
							<Trans>Password</Trans>
						</Label>
						<PriInput
							id='password'
							name='password'
							type='password'
							autoComplete='current-password'
							required
							value={password}
							onChange={e => setPassword(e.currentTarget.value)}
							disabled={submitting}
						/>
					</Field>
					{error ? <ErrorText role='alert'>{error}</ErrorText> : null}
					<SubmitButton type='submit' disabled={submitting} $variant='filled'>
						{submitting ? t`Signing in…` : t`Sign in`}
					</SubmitButton>
				</Form>
				<Hint>
					<Trans>
						Forja is invite-only. Request access from the Engranatge team.
					</Trans>
				</Hint>
			</Card>
		</Page>
	)
}

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
