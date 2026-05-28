import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, Link } from '@tanstack/react-router'
import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import styled from 'styled-components'

import { PriButton } from '@batuda/ui/pri'

import { apiBaseUrl } from '#/lib/api-base'
import { agedPaperSurface, stenciledTitle } from '#/lib/workshop-mixins'

/**
 * Consent screen an AI assistant is sent to before it may connect. Approving
 * sends the request back to the server, which replies with where to send the
 * browser next — back to the assistant, now connected. The request is read
 * straight from the URL, untouched: it is signed, so any edit (even reordering)
 * would void it, and the router's parsed search would drop parts of it.
 */

export const Route = createFileRoute('/oauth/consent')({
	validateSearch: (
		search: Record<string, unknown>,
	): { readonly client_id: string; readonly scope: string } => ({
		client_id:
			typeof search['client_id'] === 'string' ? search['client_id'] : '',
		scope: typeof search['scope'] === 'string' ? search['scope'] : '',
	}),
	head: () => ({ meta: [{ title: 'Authorize — Batuda' }] }),
	component: ConsentPage,
})

function ConsentPage() {
	const { t } = useLingui()
	const { client_id, scope } = Route.useSearch()
	const [submitting, setSubmitting] = useState<'allow' | 'deny' | null>(null)
	const [error, setError] = useState<string | null>(null)

	const scopes = scope.split(' ').filter(Boolean)

	const respond = async (accept: boolean) => {
		setSubmitting(accept ? 'allow' : 'deny')
		setError(null)
		try {
			const res = await fetch(`${apiBaseUrl()}/auth/oauth2/consent`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					accept,
					oauth_query: window.location.search.replace(/^\?/, ''),
				}),
			})
			if (!res.ok) {
				setSubmitting(null)
				setError(
					t`Something went wrong. Start the connection again from your assistant.`,
				)
				return
			}
			const data = (await res.json()) as { url?: string }
			if (data.url) {
				// Send the browser back to the assistant — connected, or
				// told it was declined.
				window.location.assign(data.url)
				return
			}
			setSubmitting(null)
			setError(t`Could not complete the connection. Please try again.`)
		} catch {
			setSubmitting(null)
			setError(t`No connection to the server. Try again in a few seconds.`)
		}
	}

	if (!client_id) {
		return (
			<Page>
				<Card>
					<Title>
						<Trans>Nothing to authorize</Trans>
					</Title>
					<Body>
						<Trans>
							This page opens when an AI assistant asks to connect. Start the
							connection from your assistant.
						</Trans>
					</Body>
					<Actions>
						<PriButton
							type='button'
							$variant='text'
							render={props => (
								<Link to='/settings/mcp/connections' {...props} />
							)}
						>
							<Trans>Go to connections</Trans>
						</PriButton>
					</Actions>
				</Card>
			</Page>
		)
	}

	return (
		<Page>
			<Card data-testid='oauth-consent'>
				<Bezel aria-hidden>
					<KeyRound size={20} />
				</Bezel>
				<Title>
					<Trans>Connect to Batuda?</Trans>
				</Title>
				<Body>
					<Trans>
						An AI assistant wants to connect to your Batuda account over MCP and
						act on your behalf. Only approve assistants you trust.
					</Trans>
				</Body>
				<Client>
					<ClientLabel>
						<Trans>Client</Trans>
					</ClientLabel>
					<ClientId data-testid='oauth-consent-client'>{client_id}</ClientId>
				</Client>
				{scopes.length > 0 ? (
					<Scopes>
						<ClientLabel>
							<Trans>Access</Trans>
						</ClientLabel>
						<ScopeList>
							{scopes.map(s => (
								<ScopeItem key={s}>{s}</ScopeItem>
							))}
						</ScopeList>
					</Scopes>
				) : null}
				{error ? (
					<ErrorText role='alert' data-testid='oauth-consent-error'>
						{error}
					</ErrorText>
				) : null}
				<Actions>
					<PriButton
						type='button'
						$variant='text'
						disabled={submitting !== null}
						data-testid='oauth-consent-deny'
						onClick={() => {
							void respond(false)
						}}
					>
						{submitting === 'deny' ? t`Cancelling…` : t`Deny`}
					</PriButton>
					<PriButton
						type='button'
						$variant='filled'
						disabled={submitting !== null}
						data-testid='oauth-consent-allow'
						onClick={() => {
							void respond(true)
						}}
					>
						{submitting === 'allow' ? t`Connecting…` : t`Allow`}
					</PriButton>
				</Actions>
			</Card>
		</Page>
	)
}

const Page = styled.div.withConfig({ displayName: 'ConsentPage' })`
	min-height: 100dvh;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: var(--space-lg);
`

const Card = styled.div.withConfig({ displayName: 'ConsentCard' })`
	${agedPaperSurface}
	position: relative;
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
	width: 100%;
	max-width: 28rem;
	padding: var(--space-xl);
	border-radius: var(--shape-xs);
	color: var(--color-on-surface);
`

const Bezel = styled.span.withConfig({ displayName: 'ConsentBezel' })`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2.5rem;
	height: 2.5rem;
	border-radius: var(--shape-full);
	background: color-mix(in oklab, var(--color-primary) 14%, transparent);
	color: var(--color-primary);
`

const Title = styled.h1.withConfig({ displayName: 'ConsentTitle' })`
	${stenciledTitle}
	font-size: var(--typescale-headline-small-size);
	line-height: var(--typescale-headline-small-line);
	margin: 0;
`

const Body = styled.p.withConfig({ displayName: 'ConsentBody' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	color: var(--color-on-surface-variant);
	margin: 0;
`

const Client = styled.div.withConfig({ displayName: 'ConsentClient' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const ClientLabel = styled.span.withConfig({
	displayName: 'ConsentClientLabel',
})`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const ClientId = styled.code.withConfig({ displayName: 'ConsentClientId' })`
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface);
	word-break: break-all;
`

const Scopes = styled.div.withConfig({ displayName: 'ConsentScopes' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const ScopeList = styled.ul.withConfig({ displayName: 'ConsentScopeList' })`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-2xs);
	margin: 0;
	padding: 0;
	list-style: none;
`

const ScopeItem = styled.li.withConfig({ displayName: 'ConsentScopeItem' })`
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
	font-size: var(--typescale-label-small-size);
	padding: var(--space-3xs) var(--space-2xs);
	border-radius: var(--shape-3xs);
	background: color-mix(in oklab, var(--color-on-surface) 8%, transparent);
	color: var(--color-on-surface);
`

const ErrorText = styled.p.withConfig({ displayName: 'ConsentError' })`
	margin: 0;
	padding: var(--space-2xs) var(--space-sm);
	border-left: 3px solid var(--color-error);
	background: color-mix(in srgb, var(--color-error) 6%, transparent);
	color: var(--color-error);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
`

const Actions = styled.div.withConfig({ displayName: 'ConsentActions' })`
	display: flex;
	justify-content: flex-end;
	gap: var(--space-sm);
	flex-wrap: wrap;
`
