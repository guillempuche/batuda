import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import { ArrowLeft, Check, ChevronsUpDown, Plug } from 'lucide-react'
import { useMemo, useState } from 'react'
import styled from 'styled-components'

import { PriSelect, usePriToast } from '@batuda/ui/pri'

import { authClient } from '#/lib/auth-client'
import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import {
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

/**
 * The AI assistants (ChatGPT, Claude.ai, …) a member has connected over MCP.
 * Belong to one organization and you never need this page — a connection just
 * acts in that org. Belong to several and you pick which org each assistant
 * acts in here; that choice is re-checked on every request it makes.
 */

type Connection = {
	readonly clientId: string
	readonly name: string | null
	readonly createdAt: string
	readonly organizationId: string | null
	readonly redirectHost: string | null
}

const connectionsAtom = BatudaApiAtom.query('mcpOAuth', 'listConnections', {})

export const Route = createFileRoute('/settings/mcp/connections')({
	head: () => ({ meta: [{ title: 'MCP connections — Batuda' }] }),
	component: ConnectionsPage,
})

function ConnectionsPage() {
	const { t } = useLingui()
	const toastManager = usePriToast()

	const listResult = useAtomValue(connectionsAtom)
	const refreshList = useAtomRefresh(connectionsAtom)
	const selectOrg = useAtomSet(
		BatudaApiAtom.mutation('mcpOAuth', 'selectOrg'),
		{
			mode: 'promiseExit',
		},
	)

	const orgs = authClient.useListOrganizations()
	const orgOptions = useMemo(
		() => (orgs.data ?? []).map(o => ({ value: o.id, label: o.name })),
		[orgs.data],
	)

	// The connection currently being saved, so its picker can disable until
	// the save finishes and a second pick can't race it.
	const [savingId, setSavingId] = useState<string | null>(null)

	const rows = useMemo<ReadonlyArray<Connection>>(
		() =>
			AsyncResult.isSuccess(listResult)
				? narrowConnections(listResult.value)
				: [],
		[listResult],
	)
	const isLoading = AsyncResult.isInitial(listResult)
	const isFailure = AsyncResult.isFailure(listResult)

	const handleSelect = async (clientId: string, organizationId: string) => {
		setSavingId(clientId)
		try {
			const exit = await selectOrg({
				payload: { clientId, organizationId },
			} as never)
			if (exit._tag === 'Success') {
				toastManager.add({
					title: t`Organization updated`,
					description: t`This connection now acts in the chosen organization.`,
					type: 'success',
				})
				refreshList()
				return
			}
			toastManager.add({
				title: t`Could not update`,
				description: t`You may not be a member of that organization. Try again.`,
				type: 'error',
			})
		} finally {
			setSavingId(null)
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
						AI assistants you've connected over MCP. Choose which organization
						each one acts in.
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
					<Empty role='alert'>
						<Trans>
							Could not load your connections. Refresh to try again.
						</Trans>
					</Empty>
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
									<ConnName>{row.name ?? t`Unnamed client`}</ConnName>
									<ConnMeta>
										<Trans>Connected {formatDate(row.createdAt)}</Trans>
									</ConnMeta>
									<ConnMeta>
										{row.redirectHost
											? t`Self-reported name · sends you to ${row.redirectHost}`
											: t`Self-reported name`}
									</ConnMeta>
								</ConnInfo>
								<PriSelect.Root
									items={orgOptions}
									value={row.organizationId ?? ''}
									onValueChange={(value: string | null) => {
										// Skip an empty, unchanged, or still-saving pick, so we
										// never save the same choice twice.
										if (
											value &&
											value !== row.organizationId &&
											savingId !== row.clientId
										) {
											void handleSelect(row.clientId, value)
										}
									}}
									disabled={
										orgOptions.length === 0 || savingId === row.clientId
									}
								>
									<SelectTrigger
										data-testid='mcp-connection-org'
										aria-label={t`Organization for ${row.name ?? t`Unnamed client`}`}
									>
										<PriSelect.Value>
											{orgLabel(orgOptions, row.organizationId) ??
												t`Choose organization`}
										</PriSelect.Value>
										<PriSelect.Icon>
											<ChevronsUpDown size={12} aria-hidden />
										</PriSelect.Icon>
									</SelectTrigger>
									<PriSelect.Portal>
										<PriSelect.Positioner
											alignItemWithTrigger={false}
											sideOffset={6}
										>
											<PriSelect.Popup>
												<PriSelect.List>
													{orgOptions.map(opt => (
														<PriSelect.Item key={opt.value} value={opt.value}>
															<PriSelect.ItemIndicator>
																<Check size={12} />
															</PriSelect.ItemIndicator>
															<PriSelect.ItemText>
																{opt.label}
															</PriSelect.ItemText>
														</PriSelect.Item>
													))}
												</PriSelect.List>
											</PriSelect.Popup>
										</PriSelect.Positioner>
									</PriSelect.Portal>
								</PriSelect.Root>
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
		out.push({
			clientId,
			createdAt,
			name: typeof r['name'] === 'string' ? r['name'] : null,
			organizationId:
				typeof r['organizationId'] === 'string' ? r['organizationId'] : null,
			redirectHost:
				typeof r['redirectHost'] === 'string' ? r['redirectHost'] : null,
		})
	}
	return out
}

const orgLabel = (
	options: ReadonlyArray<{ value: string; label: string }>,
	organizationId: string | null,
): string | null =>
	organizationId === null
		? null
		: (options.find(o => o.value === organizationId)?.label ?? null)

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
	align-items: center;
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
	gap: var(--space-2xs);
	flex: 1;
	min-width: 0;
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

const SelectTrigger = styled(PriSelect.Trigger).withConfig({
	displayName: 'McpConnSelectTrigger',
})`
	display: inline-flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-2xs);
	min-width: 12rem;
	padding: var(--space-2xs) var(--space-sm);
	border-radius: var(--shape-3xs);
	border: 1px solid var(--color-outline);
	background: var(--color-surface);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface);
	cursor: pointer;

	&:disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}
`
