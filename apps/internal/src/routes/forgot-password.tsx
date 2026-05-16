import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriInput } from '@batuda/ui/pri'

import { authClient } from '#/lib/auth-client'
import { stenciledTitle } from '#/lib/workshop-mixins'

/**
 * Email-based password reset request. The form POSTs the email to
 * Better Auth's `/auth/request-password-reset` with a `redirectTo` set
 * to the frontend's `/reset-password` route. BA returns an opaque success
 * regardless of whether the email exists (anti-enumeration); we render
 * the same "if this email is registered…" confirmation either way.
 *
 * The email lands in `apps/server/.dev-inbox/` with `labels: password-reset`
 * in dev; in prod it ships via the configured transactional provider.
 */

export const Route = createFileRoute('/forgot-password')({
	head: () => ({ meta: [{ title: 'Reset password — Batuda' }] }),
	component: ForgotPasswordPage,
})

type Status = 'idle' | 'submitting' | 'sent' | 'error'

function ForgotPasswordPage() {
	const { t } = useLingui()
	const [status, setStatus] = useState<Status>('idle')
	const [submittedEmail, setSubmittedEmail] = useState('')

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const form = new FormData(event.currentTarget)
		const email = String(form.get('email') ?? '')
			.trim()
			.toLowerCase()
		if (!email.includes('@')) {
			setStatus('error')
			return
		}
		setStatus('submitting')
		const redirectTo = new URL(
			'/reset-password',
			window.location.origin,
		).toString()
		const result = await authClient.requestPasswordReset({ email, redirectTo })
		if (result.error) {
			setStatus('error')
			return
		}
		setSubmittedEmail(email)
		setStatus('sent')
	}

	if (status === 'sent') {
		return (
			<Page>
				<Card
					role='status'
					aria-live='polite'
					data-testid='forgot-password-sent'
				>
					<Brand>Batuda</Brand>
					<Heading>
						<Trans>Check your inbox</Trans>
					</Heading>
					<Body>
						<Trans>
							If <strong>{submittedEmail}</strong> is registered, a reset link
							is on its way. The link expires in 1 hour.
						</Trans>
					</Body>
					<Body>
						<Trans>
							Not seeing it? Check your spam folder. If you're sure the email is
							right and it never arrives, an admin can help.
						</Trans>
					</Body>
					<BackRow>
						<BackLink to='/login'>
							<ArrowLeft size={14} aria-hidden />
							<Trans>Back to sign in</Trans>
						</BackLink>
					</BackRow>
				</Card>
			</Page>
		)
	}

	return (
		<Page>
			<Card>
				<Brand>Batuda</Brand>
				<Heading>
					<Trans>Reset your password</Trans>
				</Heading>
				<Body>
					<Trans>
						Type the email you sign in with. We'll send a reset link.
					</Trans>
				</Body>
				<Form onSubmit={handleSubmit} data-testid='forgot-password-form'>
					<Field>
						<Label htmlFor='forgot-email'>
							<Trans>Email</Trans>
						</Label>
						<PriInput
							id='forgot-email'
							name='email'
							type='email'
							autoComplete='email'
							required
							disabled={status === 'submitting'}
							data-testid='forgot-password-email'
						/>
					</Field>
					{status === 'error' ? (
						<ErrorText role='alert' data-testid='forgot-password-error'>
							<Trans>
								Could not send the link. Try again in a few seconds.
							</Trans>
						</ErrorText>
					) : null}
					<PriButton
						type='submit'
						$variant='filled'
						disabled={status === 'submitting'}
						data-testid='forgot-password-submit'
					>
						{status === 'submitting' ? t`Sending…` : t`Send reset link`}
					</PriButton>
				</Form>
				<BackRow>
					<BackLink to='/login'>
						<ArrowLeft size={14} aria-hidden />
						<Trans>Back to sign in</Trans>
					</BackLink>
				</BackRow>
			</Card>
		</Page>
	)
}

const Page = styled.div.withConfig({ displayName: 'ForgotPasswordPage' })`
	min-height: 100dvh;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: var(--space-lg);
	background-color: var(--color-surface);
`

const Card = styled.div.withConfig({ displayName: 'ForgotPasswordCard' })`
	position: relative;
	width: 100%;
	max-width: 26rem;
	padding: var(--space-xl);
	background-color: var(--color-paper-aged);
	border: 1px solid rgba(120, 95, 60, 0.45);
	border-radius: var(--shape-2xs);
	box-shadow:
		var(--shadow-paper-inset),
		0 6px 20px rgba(0, 0, 0, 0.18);
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
`

const Brand = styled.h1.withConfig({ displayName: 'ForgotPasswordBrand' })`
	${stenciledTitle}
	font-size: var(--typescale-display-small-size);
	line-height: var(--typescale-display-small-line);
	letter-spacing: 0.1em;
	color: var(--color-primary);
	margin: 0;
`

const Heading = styled.h2.withConfig({ displayName: 'ForgotPasswordHeading' })`
	${stenciledTitle}
	font-size: var(--typescale-headline-small-size);
	line-height: var(--typescale-headline-small-line);
	margin: 0;
`

const Body = styled.p.withConfig({ displayName: 'ForgotPasswordBody' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Form = styled.form.withConfig({ displayName: 'ForgotPasswordForm' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
`

const Field = styled.div.withConfig({ displayName: 'ForgotPasswordField' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const Label = styled.label.withConfig({ displayName: 'ForgotPasswordLabel' })`
	font-family: var(--font-body);
	font-size: var(--typescale-label-medium-size);
	color: var(--color-on-surface-variant);
`

const ErrorText = styled.p.withConfig({ displayName: 'ForgotPasswordError' })`
	margin: 0;
	padding: var(--space-2xs) var(--space-sm);
	border-left: 3px solid var(--color-error);
	background: color-mix(in srgb, var(--color-error) 6%, transparent);
	color: var(--color-error);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
`

const BackRow = styled.div.withConfig({ displayName: 'ForgotPasswordBackRow' })`
	display: flex;
	justify-content: center;
`

const BackLink = styled(Link).withConfig({
	displayName: 'ForgotPasswordBackLink',
})`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	text-decoration: none;

	&:hover {
		color: var(--color-on-surface);
		text-decoration: underline;
	}
`
