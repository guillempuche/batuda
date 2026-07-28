import { CheckboxGroup } from '@base-ui/react/checkbox-group'
import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import { ArrowLeft, Check, Plug, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriCheckbox, PriDialog, usePriToast } from '@batuda/ui/pri'

import { PriTable } from '#/components/primitives/pri-table'
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
 * Each connection reaches the organizations chosen for it, and every request
 * settles on exactly one — an assistant cannot say which it means, so in
 * practice a connection wants a single organization. This page is where that
 * choice is changed, and where access is taken away again.
 */

type ConnectionBlock = {
	readonly organizationId: string
	readonly blockedBySelf: boolean
}

type Connection = {
	readonly clientId: string
	readonly name: string | null
	readonly createdAt: string
	readonly organizationIds: ReadonlyArray<string>
	readonly chosenOrganizationIds: ReadonlyArray<string>
	readonly blocks: ReadonlyArray<ConnectionBlock>
	readonly redirectHost: string | null
}

const connectionsAtom = BatudaApiAtom.query('mcpOAuth', 'listConnections', {
	reactivityKeys: ['mcpConnections'],
})

const orgConnectionsAtom = BatudaApiAtom.query(
	'mcpOAuth',
	'listOrgConnections',
	{ reactivityKeys: ['mcpConnections'] },
)

type OrgConnection = {
	readonly clientId: string
	readonly userId: string
	readonly memberName: string | null
	readonly memberEmail: string
	readonly name: string | null
	readonly redirectHost: string | null
	readonly client: {
		readonly name: string | null
		readonly version: string | null
	} | null
	readonly lastUsedAt: string | null
}

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
	const selectOrgs = useAtomSet(
		BatudaApiAtom.mutation('mcpOAuth', 'selectOrgs'),
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

	// Only owners and admins get the organization-wide view. Hiding it is a
	// courtesy; the server refuses the call for anyone else regardless.
	const activeMember = authClient.useActiveMember()
	const myRole = activeMember.data?.role ?? null
	const canManage = myRole === 'owner' || myRole === 'admin'

	// The connection currently being revoked, so its button can disable until
	// the call finishes and a second click can't race it.
	const [revokingId, setRevokingId] = useState<string | null>(null)

	// The connection whose organizations are being changed, and the ticks shown
	// for it. One dialog serves every row, so both are set the moment its button
	// is pressed — ticks filled in any later would still show the connection
	// opened before this one.
	const [editingConnection, setEditingConnection] = useState<Connection | null>(
		null,
	)
	const [tickedOrgIds, setTickedOrgIds] = useState<ReadonlyArray<string>>([])
	const [saving, setSaving] = useState(false)

	const openOrgPicker = (connection: Connection) => {
		const blockedIds = new Set(connection.blocks.map(b => b.organizationId))
		setEditingConnection(connection)
		// Start ticked as whatever the connection reaches today: everything the
		// person belongs to while nobody has chosen for it, and only what survives
		// once anything has been chosen or blocked.
		setTickedOrgIds(
			connection.chosenOrganizationIds.length === 0 && blockedIds.size === 0
				? (orgs.data ?? []).map(o => o.id)
				: connection.organizationIds,
		)
	}

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
			// Both lists on this page share a reactivity key, so a successful
			// revoke refreshes each of them — including the organization-wide table
			// below, which would otherwise keep showing a connection just cut off.
			const exit = await revokeConnection({
				payload: { clientId },
				reactivityKeys: ['mcpConnections'],
			} as never)
			if (exit._tag === 'Success') {
				toastManager.add({
					title: t`Connection revoked`,
					description: t`This assistant can no longer reach this organization.`,
					type: 'success',
				})
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

	// Save the ticked organizations for this connection. What goes out is exactly
	// what is ticked — nothing is added back behind the person's back. That
	// matters for the organizations they blocked themselves: sending one again is
	// what lifts their own block, so it has to be their tick that sends it, never
	// something this screen quietly carries along.
	const handleSaveOrgs = async () => {
		if (!editingConnection || tickedOrgIds.length === 0) return
		setSaving(true)
		try {
			const exit = await selectOrgs({
				payload: {
					clientId: editingConnection.clientId,
					organizationIds: tickedOrgIds,
				},
				reactivityKeys: ['mcpConnections'],
			} as never)
			if (exit._tag === 'Success') {
				toastManager.add({
					title: t`Organizations updated`,
					description:
						tickedOrgIds.length === 1
							? t`This assistant now works in one organization.`
							: t`This assistant is authorized for ${tickedOrgIds.length} organizations.`,
					type: 'success',
				})
				setEditingConnection(null)
				return
			}
			toastManager.add({
				title: t`Could not save`,
				description: t`Something went wrong. Try again.`,
				type: 'error',
			})
		} finally {
			setSaving(false)
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
						AI assistants you've connected over MCP. Each works in the
						organizations you choose for it — usually one, since most assistants
						cannot say which they mean when there are several.
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
										row.chosenOrganizationIds.length === 0 &&
										row.blocks.length === 0 ? (
											// Nothing chosen and nothing in the way: the connection
											// reaches everything this person can. Saying "none" here
											// would understate what the assistant can already see.
											<UnboundTag data-testid='mcp-connection-unbound'>
												<Trans>All your organizations</Trans>
											</UnboundTag>
										) : (
											<UnboundTag data-testid='mcp-connection-unbound'>
												<Trans>No organization selected</Trans>
											</UnboundTag>
										)
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
									<PriButton
										type='button'
										$variant='text'
										data-testid={`mcp-connection-change-orgs-${row.clientId}`}
										disabled={orgs.isPending}
										onClick={() => {
											openOrgPicker(row)
										}}
									>
										<Trans>Change organizations</Trans>
									</PriButton>
								</OrgsForConnection>
							</ConnRow>
						))}
					</ConnList>
				)}
			</ListSection>

			{canManage ? <OrgConnectionsSection /> : null}

			<PriDialog.Root
				open={editingConnection !== null}
				onOpenChange={(nextOpen: boolean) => {
					if (!nextOpen && !saving) setEditingConnection(null)
				}}
			>
				<PriDialog.Portal>
					<PriDialog.Backdrop />
					<PriDialog.Popup data-testid='mcp-connection-orgs-dialog'>
						<PriDialog.Title>
							<Trans>Choose organizations</Trans>
						</PriDialog.Title>
						<PriDialog.Description>
							<Trans>
								This assistant works in the organizations you tick here.
							</Trans>
						</PriDialog.Description>

						{editingConnection ? (
							<OrgPicker
								connection={editingConnection}
								orgs={orgs.data ?? []}
								tickedOrgIds={tickedOrgIds}
								onTickedOrgIdsChange={setTickedOrgIds}
							/>
						) : null}

						<ConfirmActions>
							<PriDialog.Close
								render={props => (
									<PriButton
										type='button'
										$variant='text'
										disabled={saving}
										data-testid='mcp-connection-orgs-cancel'
										{...props}
									>
										<Trans>Cancel</Trans>
									</PriButton>
								)}
							/>
							<PriButton
								type='button'
								$variant='filled'
								disabled={saving || tickedOrgIds.length === 0}
								data-testid='mcp-connection-orgs-save'
								onClick={() => {
									void handleSaveOrgs()
								}}
							>
								{saving ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
							</PriButton>
						</ConfirmActions>
					</PriDialog.Popup>
				</PriDialog.Portal>
			</PriDialog.Root>
		</Page>
	)
}

// The organization picker inside the dialog. The two ways a connection loses an
// organization are offered differently: one the person cut off themselves comes
// back by ticking it and saving, which is the way out of an accidental removal,
// while one an owner cut off is shown but not tickable, because nothing done
// here can undo it.
//
// Blocked organizations are never in the ticked list. A checkbox reads its state
// from that list alone, so leaving one in would draw it ticked and greyed —
// telling someone the assistant reaches an organization it cannot.
function OrgPicker({
	connection,
	orgs,
	tickedOrgIds,
	onTickedOrgIdsChange,
}: {
	readonly connection: Connection
	readonly orgs: ReadonlyArray<{ readonly id: string; readonly name: string }>
	readonly tickedOrgIds: ReadonlyArray<string>
	readonly onTickedOrgIdsChange: (next: ReadonlyArray<string>) => void
}) {
	// Missing from the map means the organization is not blocked at all.
	const blockedBySelfByOrgId = useMemo(() => {
		const map = new Map<string, boolean>()
		for (const block of connection.blocks) {
			map.set(block.organizationId, block.blockedBySelf)
		}
		return map
	}, [connection.blocks])

	if (orgs.length === 0) {
		return (
			<PickerEmpty>
				<Trans>Loading your organizations…</Trans>
			</PickerEmpty>
		)
	}

	return (
		<>
			<CheckboxGroup
				value={tickedOrgIds as Array<string>}
				onValueChange={onTickedOrgIdsChange}
				aria-labelledby='mcp-org-picker-label'
			>
				<PickerLabel id='mcp-org-picker-label'>
					<Trans>Organizations</Trans>
				</PickerLabel>
				<PickerList>
					{orgs.map(org => {
						const blockedBySelf = blockedBySelfByOrgId.get(org.id)
						const blockedByOwner = blockedBySelf === false
						const labelId = `mcp-org-pick-label-${org.id}`
						const reasonId = `mcp-org-pick-reason-${org.id}`
						return (
							<PickerRow key={org.id} $blocked={blockedByOwner}>
								<PriCheckbox.Root
									name={org.id}
									disabled={blockedByOwner}
									aria-labelledby={labelId}
									aria-describedby={
										blockedBySelf === undefined ? undefined : reasonId
									}
									data-testid={`mcp-connection-org-pick-${org.id}`}
								>
									<PriCheckbox.Indicator>
										<Check size={14} aria-hidden />
									</PriCheckbox.Indicator>
								</PriCheckbox.Root>
								<PickerText>
									<PickerName id={labelId}>{org.name}</PickerName>
									{blockedBySelf === true ? (
										<PickerReason id={reasonId}>
											<Trans>
												You removed this one. Tick it to restore it.
											</Trans>
										</PickerReason>
									) : null}
									{blockedByOwner ? (
										<PickerReason id={reasonId}>
											<Trans>An owner removed this one.</Trans>
										</PickerReason>
									) : null}
								</PickerText>
							</PickerRow>
						)
					})}
				</PickerList>
			</CheckboxGroup>
			{tickedOrgIds.length > 1 ? (
				<PickerWarning role='status' data-testid='mcp-connection-orgs-warning'>
					<Trans>
						Most assistants can only work in one organization per connection.
						With more than one ticked, this one will keep asking you to choose.
					</Trans>
				</PickerWarning>
			) : null}
		</>
	)
}

// Every assistant that can reach this organization right now, whoever set it
// up. Only mounted for owners and admins, so it never has to handle the
// refusal the server sends anyone else.
function OrgConnectionsSection() {
	const { t } = useLingui()
	const toastManager = usePriToast()

	const listResult = useAtomValue(orgConnectionsAtom)
	const refreshList = useAtomRefresh(orgConnectionsAtom)
	const revokeConnection = useAtomSet(
		BatudaApiAtom.mutation('mcpOAuth', 'revokeConnection'),
		{ mode: 'promiseExit' },
	)

	// The row awaiting confirmation, and the one whose revoke is in flight so a
	// second click can't race it.
	const [confirmTarget, setConfirmTarget] = useState<OrgConnection | null>(null)
	const [revokingId, setRevokingId] = useState<string | null>(null)

	const rows = useMemo<ReadonlyArray<OrgConnection>>(
		() =>
			AsyncResult.isSuccess(listResult)
				? narrowOrgConnections(listResult.value)
				: [],
		[listResult],
	)
	const isLoading = AsyncResult.isInitial(listResult)
	const isFailure = AsyncResult.isFailure(listResult)

	const confirmRevoke = async () => {
		const target = confirmTarget
		if (!target || revokingId !== null) return
		setRevokingId(`${target.userId}:${target.clientId}`)
		try {
			// The shared reactivity key refreshes both lists on this page, so the
			// member's own list above cannot keep showing what was just cut off.
			const exit = await revokeConnection({
				payload: { clientId: target.clientId, userId: target.userId },
				reactivityKeys: ['mcpConnections'],
			} as never)
			if (exit._tag === 'Success') {
				toastManager.add({
					title: t`Connection revoked`,
					description: t`It can no longer reach this organization.`,
					type: 'success',
				})
				return
			}
			toastManager.add({
				title: t`Could not revoke`,
				description: t`Something went wrong. Try again.`,
				type: 'error',
			})
		} finally {
			// Always clear, or the dialog latches open: its dismissal is blocked
			// while a revoke is in flight.
			setRevokingId(null)
			setConfirmTarget(null)
		}
	}

	const confirmLabel = confirmTarget
		? (confirmTarget.memberName ?? confirmTarget.memberEmail)
		: ''

	return (
		<ListSection>
			<SectionTitle>
				<Trans>Everyone's connections</Trans>
			</SectionTitle>
			<SectionLead>
				<Trans>
					Every assistant that can reach this organization's data right now.
					Names come from the assistant itself, so treat them as labels rather
					than proof.
				</Trans>
			</SectionLead>

			{isLoading ? (
				<Empty>
					<Trans>Loading…</Trans>
				</Empty>
			) : isFailure ? (
				<ErrorState
					variant='inline'
					data-testid='mcp-org-connections-error'
					title={t`Could not load the organization's connections.`}
					onRetry={refreshList}
				/>
			) : rows.length === 0 ? (
				<Empty data-testid='mcp-org-connections-empty'>
					<Trans>Nothing is connected to this organization yet.</Trans>
				</Empty>
			) : (
				<PriTable.Root data-testid='mcp-org-connections'>
					<PriTable.Head>
						<PriTable.Row>
							<PriTable.ColumnHeader $flex='grow'>
								<Trans>Member</Trans>
							</PriTable.ColumnHeader>
							<PriTable.ColumnHeader $flex='grow'>
								<Trans>Assistant</Trans>
							</PriTable.ColumnHeader>
							<PriTable.ColumnHeader $flex='shrink'>
								<Trans>Last used</Trans>
							</PriTable.ColumnHeader>
							<PriTable.ColumnHeader $flex='shrink'>
								<span className='sr-only'>
									<Trans>Actions</Trans>
								</span>
							</PriTable.ColumnHeader>
						</PriTable.Row>
					</PriTable.Head>
					<PriTable.Body>
						{rows.map(row => {
							const rowId = `${row.userId}:${row.clientId}`
							const toolLabel = row.client
								? [row.client.name, row.client.version]
										.filter(part => part !== null)
										.join(' ')
								: null
							return (
								<PriTable.Row key={rowId} data-testid='mcp-org-connection-row'>
									<PriTable.Cell $flex='grow'>
										<MemberName>{row.memberName ?? row.memberEmail}</MemberName>
										<ConnMeta>{row.memberEmail}</ConnMeta>
									</PriTable.Cell>
									<PriTable.Cell $flex='grow'>
										{connectionTitle(
											row.name,
											row.redirectHost,
											t`Unnamed client`,
										)}
										{toolLabel ? <ConnMeta>{toolLabel}</ConnMeta> : null}
									</PriTable.Cell>
									<PriTable.Cell $flex='shrink'>
										{row.lastUsedAt ? (
											formatDate(row.lastUsedAt)
										) : (
											<Trans>Never used</Trans>
										)}
									</PriTable.Cell>
									<PriTable.Cell $flex='shrink'>
										<PriButton
											type='button'
											$variant='outlined'
											disabled={revokingId === rowId}
											data-testid={`mcp-org-connection-revoke-${rowId}`}
											onClick={() => {
												setConfirmTarget(row)
											}}
										>
											<Trans>Revoke</Trans>
										</PriButton>
									</PriTable.Cell>
								</PriTable.Row>
							)
						})}
					</PriTable.Body>
				</PriTable.Root>
			)}

			<PriDialog.Root
				open={confirmTarget !== null}
				onOpenChange={(nextOpen: boolean) => {
					// Hold the dialog open while the revoke is in flight so the row
					// can't vanish mid-request.
					if (!nextOpen && revokingId === null) setConfirmTarget(null)
				}}
			>
				<PriDialog.Portal>
					<PriDialog.Backdrop />
					<PriDialog.Popup data-testid='mcp-org-revoke-dialog'>
						<PriDialog.Title>
							<Trans>Cut off this connection?</Trans>
						</PriDialog.Title>
						<PriDialog.Description>
							<Trans>
								{confirmLabel}'s assistant stops reaching this organization on
								its next request. It keeps working in any other organization
								they belong to, and they can't undo this themselves.
							</Trans>
						</PriDialog.Description>
						<ConfirmActions>
							<PriDialog.Close
								render={props => (
									<PriButton
										type='button'
										$variant='text'
										disabled={revokingId !== null}
										data-testid='mcp-org-revoke-cancel'
										{...props}
									>
										<Trans>Cancel</Trans>
									</PriButton>
								)}
							/>
							<PriButton
								type='button'
								$variant='filled'
								disabled={revokingId !== null}
								data-testid='mcp-org-revoke-confirm'
								onClick={() => {
									void confirmRevoke()
								}}
							>
								<Trans>Revoke</Trans>
							</PriButton>
						</ConfirmActions>
					</PriDialog.Popup>
				</PriDialog.Portal>
			</PriDialog.Root>
		</ListSection>
	)
}

function narrowOrgConnections(
	rows: ReadonlyArray<unknown>,
): ReadonlyArray<OrgConnection> {
	const out: Array<OrgConnection> = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		const clientId = typeof r['clientId'] === 'string' ? r['clientId'] : null
		const userId = typeof r['userId'] === 'string' ? r['userId'] : null
		const memberEmail =
			typeof r['memberEmail'] === 'string' ? r['memberEmail'] : null
		if (clientId === null || userId === null || memberEmail === null) continue
		const client = r['client']
		out.push({
			clientId,
			userId,
			memberEmail,
			memberName: typeof r['memberName'] === 'string' ? r['memberName'] : null,
			name: typeof r['name'] === 'string' ? r['name'] : null,
			redirectHost:
				typeof r['redirectHost'] === 'string' ? r['redirectHost'] : null,
			lastUsedAt: typeof r['lastUsedAt'] === 'string' ? r['lastUsedAt'] : null,
			client:
				client && typeof client === 'object'
					? {
							name:
								typeof (client as Record<string, unknown>)['name'] === 'string'
									? ((client as Record<string, unknown>)['name'] as string)
									: null,
							version:
								typeof (client as Record<string, unknown>)['version'] ===
								'string'
									? ((client as Record<string, unknown>)['version'] as string)
									: null,
						}
					: null,
		})
	}
	return out
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
		const chosenRaw = r['chosenOrganizationIds']
		const chosenOrganizationIds = Array.isArray(chosenRaw)
			? chosenRaw.filter((id): id is string => typeof id === 'string')
			: []
		const blocksRaw = r['blocks']
		const blocks = Array.isArray(blocksRaw)
			? blocksRaw.flatMap((block): ReadonlyArray<ConnectionBlock> => {
					if (!block || typeof block !== 'object') return []
					const b = block as Record<string, unknown>
					return typeof b['organizationId'] === 'string' &&
						typeof b['blockedBySelf'] === 'boolean'
						? [
								{
									organizationId: b['organizationId'],
									blockedBySelf: b['blockedBySelf'],
								},
							]
						: []
				})
			: []
		out.push({
			clientId,
			createdAt,
			name: typeof r['name'] === 'string' ? r['name'] : null,
			organizationIds,
			chosenOrganizationIds,
			blocks,
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

// ── The organization picker ──

const PickerLabel = styled.span.withConfig({
	displayName: 'McpConnPickerLabel',
})`
	display: block;
	font-family: var(--font-body);
	font-size: var(--typescale-label-medium-size);
	font-weight: var(--typescale-label-medium-weight);
	color: var(--color-on-surface-variant);
	margin-bottom: var(--space-2xs);
`

const PickerList = styled.div.withConfig({ displayName: 'McpConnPickerList' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const PickerRow = styled.div.withConfig({
	displayName: 'McpConnPickerRow',
})<{ $blocked?: boolean }>`
	display: flex;
	align-items: flex-start;
	gap: var(--space-2xs);
	opacity: ${p => (p.$blocked ? 0.6 : 1)};
`

const PickerText = styled.span.withConfig({ displayName: 'McpConnPickerText' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const PickerName = styled.span.withConfig({ displayName: 'McpConnPickerName' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
`

const PickerReason = styled.span.withConfig({
	displayName: 'McpConnPickerReason',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const PickerEmpty = styled.p.withConfig({ displayName: 'McpConnPickerEmpty' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface-variant);
	margin: 0;
`

const PickerWarning = styled.p.withConfig({
	displayName: 'McpConnPickerWarning',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	color: var(--color-on-surface-variant);
	padding: var(--space-2xs);
	border-radius: var(--shape-3xs);
	background: color-mix(in srgb, var(--color-secondary) 8%, transparent);
	margin: 0;
`

// ── The organization-wide section ──

const SectionLead = styled.p.withConfig({ displayName: 'McpConnSectionLead' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	color: var(--color-on-surface-variant);
	margin: 0;
`

const MemberName = styled.span.withConfig({ displayName: 'McpConnMemberName' })`
	display: block;
	font-weight: var(--typescale-label-medium-weight);
	color: var(--color-on-surface);
`

const ConfirmActions = styled.div.withConfig({
	displayName: 'McpConnConfirmActions',
})`
	display: flex;
	justify-content: flex-end;
	gap: var(--space-sm);
	flex-wrap: wrap;
`
