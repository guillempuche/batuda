import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import styled from 'styled-components'

import { PriButton } from '@batuda/ui/pri'

import { PriPasswordInput } from '#/components/primitives/pri-password-input'
import { authClient } from '#/lib/auth-client'
import { stenciledTitle } from '#/lib/workshop-mixins'

/**
 * Landing page for the reset-password email link. Better Auth bounces
 * the user from `${api}/auth/reset-password/:token?callbackURL=...` to
 * this route with `?token=` (success) or `?error=INVALID_TOKEN` (expired
 * or used). The form renders when a token is present; otherwise the
 * page shows a recovery panel that points back at /forgot-password.
 *
 * Password inputs are uncontrolled and read via `FormData` because
 * `PriPasswordInput` doesn't accept a controlled `value`.
 */

const MIN_PASSWORD_LENGTH = 8

interface ResetSearch {
	readonly token?: string
	readonly error?: string
}

export const Route = createFileRoute('/reset-password')({
	validateSearch: (search: Record<string, unknown>): ResetSearch => {
		const result: { token?: string; error?: string } = {}
		if (typeof search['token'] === 'string') result.token = search['token']
		if (typeof search['error'] === 'string') result.error = search['error']
		return result
	},
	head: () => ({ meta: [{ title: 'Set new password — Batuda' }] }),
	component: ResetPasswordPage,
})

type Status =
	| 'idle'
	| 'submitting'
	| 'too-short'
	| 'mismatch'
	| 'invalid-token'
	| 'error'
	| 'success'

function ResetPasswordPage() {
	const { t } = useLingui()
	const navigate = useNavigate()
	const search = Route.useSearch()
	const [status, setStatus] = useState<Status>('idle')

	if (search.error || !search.token) {
		return (
			<Page>
				<Card data-testid='reset-password-token-error'>
					<Brand>Batuda</Brand>
					<Heading>
						<Trans>This link is no longer valid</Trans>
					</Heading>
					<Body>
						<Trans>
							Reset links expire after 1 hour and can only be used once. Ask for
							a new one and follow it within the hour.
						</Trans>
					</Body>
					<PriButton
						as={Link}
						to='/forgot-password'
						$variant='filled'
						data-testid='reset-password-request-new'
					>
						<Trans>Request a new link</Trans>
					</PriButton>
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

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const form = new FormData(event.currentTarget)
		const newPassword = String(form.get('newPassword') ?? '')
		const confirm = String(form.get('newPasswordConfirm') ?? '')
		if (newPassword.length < MIN_PASSWORD_LENGTH) {
			setStatus('too-short')
			return
		}
		if (newPassword !== confirm) {
			setStatus('mismatch')
			return
		}
		setStatus('submitting')
		const result = await authClient.resetPassword({
			newPassword,
			token: search.token,
		})
		if (result.error) {
			// BA returns INVALID_TOKEN for expired/used tokens — distinct
			// state so the recovery copy points the user back at /forgot.
			if (result.error.code === 'INVALID_TOKEN') {
				setStatus('invalid-token')
				return
			}
			setStatus('error')
			return
		}
		setStatus('success')
	}

	if (status === 'invalid-token') {
		return (
			<Page>
				<Card data-testid='reset-password-token-error'>
					<Brand>Batuda</Brand>
					<Heading>
						<Trans>This link is no longer valid</Trans>
					</Heading>
					<Body>
						<Trans>
							The token expired or was already used. Request a fresh link.
						</Trans>
					</Body>
					<PriButton
						as={Link}
						to='/forgot-password'
						$variant='filled'
						data-testid='reset-password-request-new'
					>
						<Trans>Request a new link</Trans>
					</PriButton>
				</Card>
			</Page>
		)
	}

	if (status === 'success') {
		return (
			<Page>
				<Card
					role='status'
					aria-live='polite'
					data-testid='reset-password-success'
				>
					<Brand>Batuda</Brand>
					<Heading>
						<Trans>Password updated</Trans>
					</Heading>
					<Body>
						<Trans>
							Sign in with your new password. Other devices will need to sign in
							again too.
						</Trans>
					</Body>
					<PriButton
						type='button'
						$variant='filled'
						onClick={() => {
							void navigate({ to: '/login' })
						}}
						data-testid='reset-password-go-login'
					>
						<Trans>Go to sign in</Trans>
					</PriButton>
				</Card>
			</Page>
		)
	}

	return (
		<Page>
			<Card>
				<Brand>Batuda</Brand>
				<Heading>
					<Trans>Set a new password</Trans>
				</Heading>
				<Body>
					<Trans>Pick a password you'll remember. Minimum 8 characters.</Trans>
				</Body>
				<Form onSubmit={handleSubmit} data-testid='reset-password-form'>
					<Field>
						<Label htmlFor='reset-new'>
							<Trans>New password</Trans>
						</Label>
						<PriPasswordInput
							id='reset-new'
							name='newPassword'
							autoComplete='new-password'
							required
							minLength={MIN_PASSWORD_LENGTH}
							disabled={status === 'submitting'}
							data-testid='reset-password-new'
						/>
					</Field>
					<Field>
						<Label htmlFor='reset-confirm'>
							<Trans>Repeat new password</Trans>
						</Label>
						<PriPasswordInput
							id='reset-confirm'
							name='newPasswordConfirm'
							autoComplete='new-password'
							required
							minLength={MIN_PASSWORD_LENGTH}
							disabled={status === 'submitting'}
							data-testid='reset-password-confirm'
						/>
					</Field>
					{status === 'too-short' ? (
						<ErrorText role='alert' data-testid='reset-password-error'>
							<Trans>
								Passwords need at least {MIN_PASSWORD_LENGTH} characters.
							</Trans>
						</ErrorText>
					) : null}
					{status === 'mismatch' ? (
						<ErrorText role='alert' data-testid='reset-password-error'>
							<Trans>The two passwords don't match.</Trans>
						</ErrorText>
					) : null}
					{status === 'error' ? (
						<ErrorText role='alert' data-testid='reset-password-error'>
							<Trans>Something went wrong. Try again.</Trans>
						</ErrorText>
					) : null}
					<PriButton
						type='submit'
						$variant='filled'
						disabled={status === 'submitting'}
						data-testid='reset-password-submit'
					>
						{status === 'submitting' ? t`Saving…` : t`Save new password`}
					</PriButton>
				</Form>
			</Card>
		</Page>
	)
}

const Page = styled.div.withConfig({ displayName: 'ResetPasswordPage' })`
	min-height: 100dvh;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: var(--space-lg);
	background-color: var(--color-surface);
`

const Card = styled.div.withConfig({ displayName: 'ResetPasswordCard' })`
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

const Brand = styled.h1.withConfig({ displayName: 'ResetPasswordBrand' })`
	${stenciledTitle}
	font-size: var(--typescale-display-small-size);
	line-height: var(--typescale-display-small-line);
	letter-spacing: 0.1em;
	color: var(--color-primary);
	margin: 0;
`

const Heading = styled.h2.withConfig({ displayName: 'ResetPasswordHeading' })`
	${stenciledTitle}
	font-size: var(--typescale-headline-small-size);
	line-height: var(--typescale-headline-small-line);
	margin: 0;
`

const Body = styled.p.withConfig({ displayName: 'ResetPasswordBody' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Form = styled.form.withConfig({ displayName: 'ResetPasswordForm' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
`

const Field = styled.div.withConfig({ displayName: 'ResetPasswordField' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const Label = styled.label.withConfig({ displayName: 'ResetPasswordLabel' })`
	font-family: var(--font-body);
	font-size: var(--typescale-label-medium-size);
	color: var(--color-on-surface-variant);
`

const ErrorText = styled.p.withConfig({ displayName: 'ResetPasswordError' })`
	margin: 0;
	padding: var(--space-2xs) var(--space-sm);
	border-left: 3px solid var(--color-error);
	background: color-mix(in srgb, var(--color-error) 6%, transparent);
	color: var(--color-error);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
`

const BackRow = styled.div.withConfig({
	displayName: 'ResetPasswordBackRow',
})`
	display: flex;
	justify-content: center;
`

const BackLink = styled(Link).withConfig({
	displayName: 'ResetPasswordBackLink',
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
