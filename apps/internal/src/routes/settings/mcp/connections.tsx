import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import { ArrowLeft, Plug, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import styled from 'styled-components'

import { PriButton, usePriToast } from '@batuda/ui/pri'

import { ErrorState } from '#/components/shared/error-state'
import { authClient } from '#/lib/auth-client'
import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import {
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

/**
 * The AI assistants (ChatGPT, Claude.ai, …) a member has connected over MCP.
 * Each connection may act in one or more organizations. Single-org users have
 * their lone org auto-bound at consent time; multi-org users pick one or more
 * there. This page only takes access away again; per-request org selection
 * happens via the X-Batuda-Organization-Id header the MCP client sends.
 */

type Connection = {
	readonly clientId: string
	readonly name: string | null
	readonly createdAt: string
	readonly organizationIds: ReadonlyArray<string>
	readonly redirectHost: string | null
}

const connectionsAtom = BatudaApiAtom.query('mcpOAuth', 'listConnections', {})

export const Route = createFileRoute('/settings/mcp/connections')({
	head: () => ({ meta: [{ title: 'MCP connections — Batuda' }] }),
	component: ConnectionsPage,
})

// Known MCP clients whose redirect host identifies them more usefully than the
// self-asserted `oauthClient.name`. Lets the connections page show "ChatGPT"
// rather than a generic library name when the host matches a known assistant.
const KNOWN_CLIENTS: ReadonlyMap<string, string> = new Map([
	['chatgpt.com', 'ChatGPT'],
	['claude.ai', 'Claude'],
	['chat.com', 'ChatGPT'],
	['anthropic.com', 'Claude'],
])

// The connection's display title: the known-client name when the redirect
// host matches (e.g. chatgpt.com → "ChatGPT"), else the self-reported name,
// else a fallback. The redirect host is the trusted provenance signal;
// the self-reported name is the fallback. Brand names from KNOWN_CLIENTS are
// not translated; the fallback is wrapped at the call site with `t`.
const connectionTitle = (
	name: string | null,
	redirectHost: string | null,
	fallback: string,
): string => {
	if (redirectHost && KNOWN_CLIENTS.has(redirectHost)) {
		return KNOWN_CLIENTS.get(redirectHost)!
	}
	return name ?? fallback
}

function ConnectionsPage() {
	const { t } = useLingui()
	const toastManager = usePriToast()

	const listResult = useAtomValue(connectionsAtom)
	const refreshList = useAtomRefresh(connectionsAtom)
	const revokeConnection = useAtomSet(
		BatudaApiAtom.mutation('mcpOAuth', 'revokeConnection'),
		{
			mode: 'promiseExit',
		},
	)

	const orgs = authClient.useListOrganizations()
	const orgNameById = useMemo(() => {
		const map = new Map<string, string>()
		for (const o of orgs.data ?? []) map.set(o.id, o.name)
		return map
	}, [orgs.data])

	// Cutting a connection off is recorded against the organization you are
	// currently working in, so only that organization's chip offers it. The
	// others are shown for context — switch organization to manage them.
	const activeOrg = authClient.useActiveOrganization()
	const activeOrgId = activeOrg.data?.id ?? null

	// The connection currently being revoked, so its button can disable until
	// the call finishes and a second click can't race it.
	const [revokingId, setRevokingId] = useState<string | null>(null)

	const rows = useMemo<ReadonlyArray<Connection>>(
		() =>
			AsyncResult.isSuccess(listResult)
				? narrowConnections(listResult.value)
				: [],
		[listResult],
	)
	const isLoading = AsyncResult.isInitial(listResult)
	const isFailure = AsyncResult.isFailure(listResult)

	// Cut this connection off from the organization being worked in. Which
	// organization that is comes from the session, never from here — which is
	// also why only the active organization's chip offers the button. The
	// assistant stops reaching this organization's data on its very next
	// request; if the same assistant is connected to another organization, it
	// keeps working there.
	const handleRevoke = async (clientId: string) => {
		setRevokingId(clientId)
		try {
			const exit = await revokeConnection({
				payload: { clientId },
			} as never)
			if (exit._tag === 'Success') {
				toastManager.add({
					title: t`Connection revoked`,
					description: t`This assistant can no longer reach this organization.`,
					type: 'success',
				})
				refreshList()
				return
			}
			toastManager.add({
				title: t`Could not revoke`,
				description: t`Something went wrong. Try again.`,
				type: 'error',
			})
		} finally {
			setRevokingId(null)
		}
	}

	return (
		<Page>
			<BackLink to='/settings' aria-label={t`Back to settings`}>
				<ArrowLeft size={14} aria-hidden />
				<span>
					<Trans>Settings</Trans>
				</span>
			</BackLink>

			<Intro>
				<Heading>
					<Plug size={20} aria-hidden />
					<Trans>MCP connections</Trans>
				</Heading>
				<Subtitle>
					<Trans>
						AI assistants you've connected over MCP. Each may act in one or more
						of your organizations; the assistant picks which per request.
					</Trans>
				</Subtitle>
			</Intro>

			<ListSection>
				<SectionTitle>
					<Trans>Your connections</Trans>
				</SectionTitle>
				{isLoading ? (
					<Empty>
						<Trans>Loading…</Trans>
					</Empty>
				) : isFailure ? (
					<ErrorState
						variant='inline'
						data-testid='mcp-connections-error'
						title={t`Could not load your connections.`}
						onRetry={refreshList}
					/>
				) : rows.length === 0 ? (
					<Empty data-testid='mcp-connections-empty'>
						<Trans>
							No connections yet. Add this server in your AI assistant and
							authorize it, then it appears here.
						</Trans>
					</Empty>
				) : (
					<ConnList>
						{rows.map(row => (
							<ConnRow key={row.clientId} data-testid='mcp-connection-row'>
								<ConnInfo>
									<ConnName data-testid='mcp-connection-name'>
										{connectionTitle(
											row.name,
											row.redirectHost,
											t`Unnamed client`,
										)}
									</ConnName>
									<ConnMeta>
										<Trans>Connected {formatDate(row.createdAt)}</Trans>
									</ConnMeta>
									<ConnMeta>
										{row.redirectHost
											? t`Sends you to ${row.redirectHost}`
											: t`No redirect URI`}
									</ConnMeta>
								</ConnInfo>
								<OrgsForConnection>
									<OrgsLabel>
										<Trans>Organizations</Trans>
									</OrgsLabel>
									{row.organizationIds.length === 0 ? (
										<UnboundTag data-testid='mcp-connection-unbound'>
											<Trans>No organization selected</Trans>
										</UnboundTag>
									) : (
										<OrgChips>
											{row.organizationIds.map(orgId => (
												<OrgChip key={orgId} data-testid='mcp-connection-org'>
													<OrgChipName>
														{orgNameById.get(orgId) ?? orgId}
													</OrgChipName>
													{orgId === activeOrgId ? (
														<PriButton
															type='button'
															$variant='text'
															aria-label={t`Revoke ${orgNameById.get(orgId) ?? orgId}`}
															data-testid='mcp-connection-org-revoke'
															disabled={revokingId === row.clientId}
															onClick={() => {
																void handleRevoke(row.clientId)
															}}
														>
															<X size={12} aria-hidden />
														</PriButton>
													) : null}
												</OrgChip>
											))}
										</OrgChips>
									)}
								</OrgsForConnection>
							</ConnRow>
						))}
					</ConnList>
				)}
			</ListSection>
		</Page>
	)
}

function narrowConnections(
	rows: ReadonlyArray<unknown>,
): ReadonlyArray<Connection> {
	const out: Array<Connection> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		const clientId = typeof r['clientId'] === 'string' ? r['clientId'] : null
		const createdAt = typeof r['createdAt'] === 'string' ? r['createdAt'] : null
		if (clientId === null || createdAt === null) continue
		const organizationIdsRaw = r['organizationIds']
		const organizationIds = Array.isArray(organizationIdsRaw)
			? organizationIdsRaw.filter((id): id is string => typeof id === 'string')
			: []
		out.push({
			clientId,
			createdAt,
			name: typeof r['name'] === 'string' ? r['name'] : null,
			organizationIds,
			redirectHost:
				typeof r['redirectHost'] === 'string' ? r['redirectHost'] : null,
		})
	}
	return out
}

function formatDate(iso: string): string {
	const date = new Date(iso)
	if (Number.isNaN(date.getTime())) return iso
	return date.toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	})
}

const Page = styled.div.withConfig({ displayName: 'McpConnectionsPage' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`

const BackLink = styled(Link).withConfig({ displayName: 'McpConnBackLink' })`
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

const Intro = styled.div.withConfig({ displayName: 'McpConnIntro' })`
	${rulerUnderRule}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-bottom: var(--space-xs);
`

const Heading = styled.h2.withConfig({ displayName: 'McpConnHeading' })`
	${stenciledTitle}
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
	margin: 0;
`

const Subtitle = styled.p.withConfig({ displayName: 'McpConnSubtitle' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const ListSection = styled.section.withConfig({ displayName: 'McpConnList' })`
	${brushedMetalPlate}
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md);
	border-radius: var(--shape-2xs);
`

const SectionTitle = styled.h3.withConfig({
	displayName: 'McpConnSectionTitle',
})`
	${stenciledTitle}
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
	margin: 0;
`

const Empty = styled.p.withConfig({ displayName: 'McpConnEmpty' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const ConnList = styled.ul.withConfig({ displayName: 'McpConnRows' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	margin: 0;
	padding: 0;
	list-style: none;
`

const ConnRow = styled.li.withConfig({ displayName: 'McpConnRow' })`
	display: flex;
	align-items: flex-start;
	gap: var(--space-md);
	flex-wrap: wrap;
	padding: var(--space-sm) var(--space-md);
	border-radius: var(--shape-3xs);
	background: color-mix(in oklab, var(--color-on-surface) 4%, transparent);
	border: 1px solid color-mix(in oklab, var(--color-on-surface) 10%, transparent);
`

const ConnInfo = styled.div.withConfig({ displayName: 'McpConnInfo' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	flex: 1;
	min-width: 12rem;
`

const ConnName = styled.span.withConfig({ displayName: 'McpConnName' })`
	${stenciledTitle}
	font-size: var(--typescale-title-small-size);
	overflow: hidden;
	text-overflow: ellipsis;
`

const ConnMeta = styled.span.withConfig({ displayName: 'McpConnMeta' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const OrgsForConnection = styled.div.withConfig({
	displayName: 'McpConnOrgs',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	flex: 1;
	min-width: 12rem;
`

const OrgsLabel = styled.span.withConfig({ displayName: 'McpConnOrgsLabel' })`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const OrgChips = styled.div.withConfig({ displayName: 'McpConnOrgChips' })`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-2xs);
`

const OrgChip = styled.span.withConfig({ displayName: 'McpConnOrgChip' })`
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
	padding: var(--space-3xs) var(--space-2xs);
	border-radius: var(--shape-3xs);
	background: color-mix(in oklab, var(--color-primary) 10%, transparent);
	border: 1px solid color-mix(in oklab, var(--color-primary) 25%, transparent);
	color: var(--color-on-surface);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
`

const OrgChipName = styled.span.withConfig({
	displayName: 'McpConnOrgChipName',
})`
	font-weight: var(--typescale-label-medium-weight);
`

const UnboundTag = styled.span.withConfig({ displayName: 'McpConnUnbound' })`
	display: inline-flex;
	align-items: center;
	padding: var(--space-3xs) var(--space-2xs);
	border-radius: var(--shape-3xs);
	background: color-mix(in srgb, var(--color-error) 8%, transparent);
	border: 1px solid color-mix(in srgb, var(--color-error) 20%, transparent);
	color: var(--color-error);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
`
