import {
	useAtom,
	useAtomRefresh,
	useAtomSet,
	useAtomValue,
} from '@effect/atom-react'
import { useLingui } from '@lingui/react/macro'
import { createFileRoute, Link, useLocation } from '@tanstack/react-router'
import { Option, Schema } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import {
	Check,
	ChevronLeft,
	FileText,
	Inbox as InboxIcon,
	Pencil,
	Plus,
	RefreshCw,
	Star,
	Trash2,
	X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import styled, { css } from 'styled-components'

import { EmailEditor } from '@batuda/email/editor'
import type { EmailBlocks } from '@batuda/email/schema'
import {
	PriButton,
	PriDialog,
	PriInput,
	PriSelect,
	usePriToast,
} from '@batuda/ui/pri'

import {
	createFooterAtom,
	createInboxAtom,
	deleteFooterAtom,
	deleteInboxAtom,
	footersAtomFor,
	inboxesListAtom,
	inboxStatusAtom,
	providerPresetsAtom,
	setPrimaryInboxAtom,
	testInboxAtom,
	updateFooterAtom,
	updateInboxAtom,
} from '#/atoms/emails-atoms'
import {
	emptyInboxDraft,
	type InboxDraft,
	inboxDraftAtom,
} from '#/atoms/inbox-draft-atoms'
import { EmptyState } from '#/components/shared/empty-state'
import { RelativeDate } from '#/components/shared/relative-date'
import { SkeletonRows } from '#/components/shared/skeleton-row'
import { dehydrateAtom } from '#/lib/atom-hydration'
import { dlgNoId, dlgWithId } from '#/lib/dlg-search'
import { validateSearchWith } from '#/lib/search-schema'
import { getServerCookieHeader } from '#/lib/server-cookie'
import {
	agedPaperRow,
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

type InboxPurpose = 'human' | 'agent' | 'shared'
type TransportSecurity = 'tls' | 'starttls' | 'plain'
type GrantStatus = 'connected' | 'auth_failed' | 'connect_failed' | 'disabled'

type InboxRow = {
	readonly id: string
	readonly email: string
	readonly displayName: string | null
	readonly purpose: InboxPurpose
	readonly ownerUserId: string | null
	readonly isDefault: boolean
	readonly isPrivate: boolean
	readonly active: boolean
	readonly imapHost: string
	readonly imapPort: number
	readonly imapSecurity: TransportSecurity
	readonly smtpHost: string
	readonly smtpPort: number
	readonly smtpSecurity: TransportSecurity
	readonly username: string
	readonly grantStatus: GrantStatus
	readonly grantLastError: string | null
	readonly grantLastSeenAt: string | null
	readonly createdAt: string | null
	readonly updatedAt: string | null
}

type ProviderPreset = {
	readonly name: string
	readonly imapHost: string
	readonly imapPort: number
	readonly imapSecurity: TransportSecurity
	readonly smtpHost: string
	readonly smtpPort: number
	readonly smtpSecurity: TransportSecurity
	readonly helpUrl: string
	readonly appPasswordUrl: string
	readonly passwordAuthSupported: boolean
}

async function loadInboxesOnServer(): Promise<ReadonlyArray<unknown>> {
	const [{ Effect }, { makeBatudaApiServer }, cookie] = await Promise.all([
		import('effect'),
		import('#/lib/batuda-api-server'),
		getServerCookieHeader(),
	])
	const program = Effect.gen(function* () {
		const client = yield* makeBatudaApiServer(cookie ?? undefined)
		return yield* client.email.listInboxes({ query: {} })
	})
	return Effect.runPromise(program)
}

// Which dialog is open lives in the `?dlg=` URL param so dialogs are
// deep-linkable and the back button closes them. This route owns exactly three
// dialogs; a `?dlg=` value outside this set fails to decode and stays closed.
// `dlg` is intentionally not a loaderDep — opening a dialog never refetches.
const inboxDlgSchema = Schema.Union([
	dlgNoId('create'),
	dlgWithId('edit'),
	dlgWithId('footers'),
])
type InboxDlg = Schema.Schema.Type<typeof inboxDlgSchema>
const decodeInboxDlg = Schema.decodeUnknownOption(inboxDlgSchema)

export const Route = createFileRoute('/emails/inboxes')({
	validateSearch: validateSearchWith({ dlg: inboxDlgSchema }),
	loader: async () => {
		if (!import.meta.env.SSR) return { dehydrated: [] as const }
		try {
			const inboxes = await loadInboxesOnServer()
			return {
				dehydrated: [
					dehydrateAtom(inboxesListAtom, AsyncResult.success(inboxes)),
				] as const,
			}
		} catch (error) {
			console.warn('[InboxesLoader] falling back to empty hydration:', error)
			return { dehydrated: [] as const }
		}
	},
	head: () => ({ meta: [{ title: 'Inboxes — Batuda' }] }),
	component: InboxesPage,
})

// Open pushes a history entry (so Back closes the dialog); close drops `dlg`
// with replace (so Back doesn't reopen it).
//
// `dlg` is read from the live URL rather than this route's validated search:
// a programmatic navigate that removes the last search param updates the URL
// but leaves the route match's validated search stale (only a real back/forward
// re-resolves it), so the dialog wouldn't close. The URL always reflects the
// truth, so we decode it through the same schema here — keeping the scope gate
// (an unknown `dlg` decodes to nothing) without casts.
function useInboxDlg() {
	const rawDlg = useLocation({ select: l => l.search?.dlg })
	const dlg = useMemo(
		() => Option.getOrUndefined(decodeInboxDlg(rawDlg)),
		[rawDlg],
	)
	const navigate = Route.useNavigate()
	const open = useCallback(
		(next: InboxDlg) => {
			void navigate({
				to: '/emails/inboxes',
				search: prev => ({ ...prev, dlg: next }),
			})
		},
		[navigate],
	)
	const close = useCallback(() => {
		if (dlg === undefined) return
		// Drop the `dlg` key entirely (rather than blank it) so the param
		// disappears from the address bar and the URL goes back to clean.
		void navigate({
			to: '/emails/inboxes',
			search: ({ dlg: _, ...rest }) => rest,
			replace: true,
		})
	}, [navigate, dlg])
	return { dlg, open, close }
}

function InboxesPage() {
	const { t } = useLingui()
	const toastManager = usePriToast()
	const inboxesResult = useAtomValue(inboxesListAtom)
	const refreshInboxes = useAtomRefresh(inboxesListAtom)
	const inboxStatusResult = useAtomValue(inboxStatusAtom)
	const refreshInboxStatus = useAtomRefresh(inboxStatusAtom)

	const createInbox = useAtomSet(createInboxAtom, { mode: 'promiseExit' })
	const updateInbox = useAtomSet(updateInboxAtom, { mode: 'promiseExit' })
	const deleteInbox = useAtomSet(deleteInboxAtom, { mode: 'promiseExit' })
	const testInbox = useAtomSet(testInboxAtom, { mode: 'promiseExit' })
	const setPrimaryInbox = useAtomSet(setPrimaryInboxAtom, {
		mode: 'promiseExit',
	})

	const { dlg, open, close } = useInboxDlg()

	const rows = useMemo<ReadonlyArray<InboxRow>>(
		() =>
			AsyncResult.isSuccess(inboxesResult)
				? narrowInboxRows(inboxesResult.value)
				: [],
		[inboxesResult],
	)
	const presetsResult = useAtomValue(providerPresetsAtom)
	const presets = useMemo<ReadonlyArray<ProviderPreset>>(
		() =>
			AsyncResult.isSuccess(presetsResult)
				? narrowPresets(presetsResult.value)
				: [],
		[presetsResult],
	)
	const isLoading = AsyncResult.isInitial(inboxesResult)
	const isFailure = AsyncResult.isFailure(inboxesResult)
	const listSettled =
		AsyncResult.isSuccess(inboxesResult) || AsyncResult.isFailure(inboxesResult)

	// Edit/footers dialogs carry only the row id in the URL; resolve the row
	// from the loaded list. A deep link to a row that no longer exists closes
	// itself once the list has loaded.
	const targetRow = useMemo(() => {
		if (dlg === undefined || dlg.kind === 'create') return null
		return rows.find(row => row.id === dlg.id) ?? null
	}, [dlg, rows])
	useEffect(() => {
		if (dlg === undefined || dlg.kind === 'create') return
		if (listSettled && targetRow === null) close()
	}, [dlg, listSettled, targetRow, close])

	// hasDefault is the only signal we need from inboxStatus to drive the
	// banner; the picker walks the inbox list itself.
	const hasPrimary = useMemo(
		() =>
			AsyncResult.isSuccess(inboxStatusResult) &&
			isInboxStatus(inboxStatusResult.value) &&
			inboxStatusResult.value.hasDefault,
		[inboxStatusResult],
	)

	const primarySuggestions = useMemo(
		() =>
			rows.filter(
				row =>
					row.active &&
					row.purpose === 'human' &&
					row.ownerUserId !== null &&
					row.ownerUserId !== '',
			),
		[rows],
	)
	const showPrimaryBanner = !hasPrimary && primarySuggestions.length > 0

	const openCreate = useCallback(() => open({ kind: 'create' }), [open])
	const openEdit = useCallback(
		(row: InboxRow) => open({ kind: 'edit', id: row.id }),
		[open],
	)
	const openFooters = useCallback(
		(row: InboxRow) => open({ kind: 'footers', id: row.id }),
		[open],
	)

	const toggleActive = useCallback(
		async (row: InboxRow) => {
			const exit = await updateInbox({
				params: { id: row.id },
				payload: { active: !row.active },
			})
			if (exit._tag !== 'Success') {
				toastManager.add({
					title: t`Update failed`,
					description: t`Could not toggle the inbox state.`,
					type: 'error',
				})
				return
			}
			refreshInboxes()
			refreshInboxStatus()
		},
		[updateInbox, refreshInboxes, refreshInboxStatus, toastManager, t],
	)

	const setDefault = useCallback(
		async (row: InboxRow) => {
			if (row.isDefault) return
			const exit = await updateInbox({
				params: { id: row.id },
				payload: { isDefault: true },
			})
			if (exit._tag !== 'Success') {
				toastManager.add({
					title: t`Update failed`,
					description: t`Could not set the default inbox.`,
					type: 'error',
				})
				return
			}
			refreshInboxes()
		},
		[updateInbox, refreshInboxes, toastManager, t],
	)

	const handleTest = useCallback(
		async (row: InboxRow) => {
			const exit = await testInbox({ params: { id: row.id } })
			if (exit._tag !== 'Success') {
				toastManager.add({
					title: t`Test failed`,
					description: t`Could not reach ${row.email}.`,
					type: 'error',
				})
				return
			}
			toastManager.add({
				title: t`Connection tested`,
				description: t`Refreshing inbox status…`,
				type: 'success',
			})
			refreshInboxes()
		},
		[testInbox, refreshInboxes, toastManager, t],
	)

	const handleDelete = useCallback(
		async (row: InboxRow) => {
			const ok = window.confirm(
				t`Delete inbox ${row.email}? Stored messages stay; the connection stops.`,
			)
			if (!ok) return
			const exit = await deleteInbox({ params: { id: row.id } })
			if (exit._tag !== 'Success') {
				toastManager.add({
					title: t`Delete failed`,
					type: 'error',
				})
				return
			}
			refreshInboxes()
			refreshInboxStatus()
			toastManager.add({
				title: t`Inbox removed`,
				type: 'success',
			})
		},
		[deleteInbox, refreshInboxes, refreshInboxStatus, toastManager, t],
	)

	const handleSetPrimary = useCallback(
		async (id: string) => {
			const exit = await setPrimaryInbox({ params: { id } })
			if (exit._tag !== 'Success') {
				toastManager.add({
					title: t`Could not set primary inbox`,
					type: 'error',
				})
				return
			}
			refreshInboxStatus()
			toastManager.add({
				title: t`Primary inbox set`,
				type: 'success',
			})
		},
		[setPrimaryInbox, refreshInboxStatus, toastManager, t],
	)

	return (
		<Page>
			<Intro>
				<IntroText>
					<BackLink>
						<Link to='/emails'>
							<ChevronLeft size={14} aria-hidden />
							<span>{t`Back to emails`}</span>
						</Link>
					</BackLink>
					<Title>{t`Inbox management`}</Title>
					<Subtitle>{t`Connect IMAP/SMTP mailboxes and choose your primary sender.`}</Subtitle>
				</IntroText>
				<IntroActions>
					<PriButton
						type='button'
						$variant='filled'
						data-testid='inboxes-connect'
						onClick={openCreate}
					>
						<Plus size={14} aria-hidden />
						<span>{t`Connect mailbox`}</span>
					</PriButton>
				</IntroActions>
			</Intro>

			{showPrimaryBanner && (
				<PrimaryBanner role='status'>
					<PrimaryBannerText>
						<strong>{t`No primary inbox set.`}</strong>{' '}
						<span>{t`Pick one to use as your default sender.`}</span>
					</PrimaryBannerText>
					<PrimaryBannerActions>
						{primarySuggestions.length === 1 ? (
							<PriButton
								type='button'
								$variant='filled'
								onClick={() => {
									const only = primarySuggestions[0]
									if (only !== undefined) {
										void handleSetPrimary(only.id)
									}
								}}
							>
								{t`Use ${primarySuggestions[0]?.email ?? ''} as primary`}
							</PriButton>
						) : (
							<PriSelect.Root
								value=''
								onValueChange={value => {
									if (value !== null && value !== '') {
										void handleSetPrimary(value)
									}
								}}
							>
								<PriSelect.Trigger aria-label={t`Choose primary inbox`}>
									<PriSelect.Value placeholder={t`Choose primary inbox`} />
									<PriSelect.Icon>
										<ChevronLeft
											size={14}
											aria-hidden
											style={{ transform: 'rotate(-90deg)' }}
										/>
									</PriSelect.Icon>
								</PriSelect.Trigger>
								<PriSelect.Portal>
									<PriSelect.Positioner>
										<PriSelect.Popup>
											{primarySuggestions.map(row => (
												<PriSelect.Item key={row.id} value={row.id}>
													<PriSelect.ItemIndicator>
														<Check size={12} aria-hidden />
													</PriSelect.ItemIndicator>
													<PriSelect.ItemText>{row.email}</PriSelect.ItemText>
												</PriSelect.Item>
											))}
										</PriSelect.Popup>
									</PriSelect.Positioner>
								</PriSelect.Portal>
							</PriSelect.Root>
						)}
					</PrimaryBannerActions>
				</PrimaryBanner>
			)}

			{isLoading ? (
				<SkeletonRows count={5} height='3rem' />
			) : isFailure ? (
				<EmptyState
					title={t`Could not load inboxes`}
					description={t`Check the session or try again.`}
				/>
			) : rows.length === 0 ? (
				<EmptyState
					icon={InboxIcon}
					title={t`No inboxes yet`}
					description={t`Connect your IMAP/SMTP mailbox to start sending and receiving email.`}
					action={
						<PriButton
							type='button'
							$variant='filled'
							data-testid='inboxes-empty-connect'
							onClick={openCreate}
						>
							<Plus size={14} aria-hidden />
							<span>{t`Connect mailbox`}</span>
						</PriButton>
					}
				/>
			) : (
				<InboxesTable role='table' aria-label={t`Local inboxes`}>
					<TableHead role='row'>
						<HeadCell role='columnheader'>{t`Email`}</HeadCell>
						<HeadCell role='columnheader'>{t`Status`}</HeadCell>
						<HeadCell role='columnheader'>{t`Purpose`}</HeadCell>
						<HeadCell role='columnheader'>{t`Default`}</HeadCell>
						<HeadCell role='columnheader'>{t`Active`}</HeadCell>
						<HeadCell role='columnheader'>{t`Created`}</HeadCell>
						<HeadCell role='columnheader' aria-label={t`Actions`}>
							{' '}
						</HeadCell>
					</TableHead>
					{rows.map(row => (
						<TableRow key={row.id} role='row' $inactive={!row.active}>
							<CellEmail role='cell'>
								<EmailAddress>{row.email}</EmailAddress>
								<EmailMeta>
									{row.displayName !== null && row.displayName !== '' ? (
										<DisplayName>{row.displayName}</DisplayName>
									) : null}
									{row.imapHost !== '' && (
										<HostName title={`IMAP ${row.imapHost}:${row.imapPort}`}>
											{row.imapHost}
										</HostName>
									)}
									{row.isPrivate && (
										<PrivacyTag aria-label={t`Private inbox`}>
											{t`Private`}
										</PrivacyTag>
									)}
								</EmailMeta>
							</CellEmail>
							<CellStatus role='cell'>
								<StatusBadge
									$status={row.grantStatus}
									title={row.grantLastError ?? ''}
								>
									{row.grantStatus === 'connected'
										? t`Connected`
										: row.grantStatus === 'auth_failed'
											? t`Auth failed`
											: row.grantStatus === 'connect_failed'
												? t`Connect failed`
												: t`Disabled`}
								</StatusBadge>
								{row.grantStatus === 'auth_failed' && (
									<AuthHint>
										{t`2FA accounts need an app-specific password.`}
										{authPasswordUrlFor(presets, row.imapHost) !== '' && (
											<>
												{' '}
												<PresetLink
													href={authPasswordUrlFor(presets, row.imapHost)}
													aria-label={t`Create an app-specific password for ${row.email}, opens in a new tab`}
													target='_blank'
													rel='noreferrer noopener'
												>
													{t`Create an app password →`}
												</PresetLink>
											</>
										)}
									</AuthHint>
								)}
							</CellStatus>
							<CellPurpose role='cell'>
								<PurposeBadge $purpose={row.purpose}>
									{row.purpose === 'human'
										? t`Human`
										: row.purpose === 'agent'
											? t`Agent`
											: t`Shared`}
								</PurposeBadge>
							</CellPurpose>
							<CellDefault role='cell'>
								<IconToggle
									type='button'
									$active={row.isDefault}
									onClick={() => {
										void setDefault(row)
									}}
									aria-label={
										row.isDefault ? t`Default inbox` : t`Mark as default`
									}
									aria-pressed={row.isDefault}
								>
									<Star
										size={14}
										aria-hidden
										fill={row.isDefault ? 'currentColor' : 'none'}
									/>
								</IconToggle>
							</CellDefault>
							<CellActive role='cell'>
								<IconToggle
									type='button'
									$active={row.active}
									onClick={() => {
										void toggleActive(row)
									}}
									aria-label={row.active ? t`Mark inactive` : t`Mark active`}
									aria-pressed={row.active}
								>
									{row.active ? (
										<Check size={14} aria-hidden />
									) : (
										<X size={14} aria-hidden />
									)}
								</IconToggle>
							</CellActive>
							<CellDate role='cell'>
								{row.createdAt !== null ? (
									<RelativeDate value={row.createdAt} />
								) : (
									<Muted>—</Muted>
								)}
							</CellDate>
							<CellActions role='cell'>
								<IconAction
									type='button'
									onClick={() => {
										void handleTest(row)
									}}
									aria-label={t`Test connection for ${row.email}`}
								>
									<RefreshCw size={14} aria-hidden />
								</IconAction>
								<IconAction
									type='button'
									onClick={() => openFooters(row)}
									aria-label={t`Manage footers for ${row.email}`}
								>
									<FileText size={14} aria-hidden />
								</IconAction>
								<IconAction
									type='button'
									onClick={() => openEdit(row)}
									aria-label={t`Edit inbox ${row.email}`}
								>
									<Pencil size={14} aria-hidden />
								</IconAction>
								<IconAction
									type='button'
									onClick={() => {
										void handleDelete(row)
									}}
									aria-label={t`Delete inbox ${row.email}`}
								>
									<Trash2 size={14} aria-hidden />
								</IconAction>
							</CellActions>
						</TableRow>
					))}
				</InboxesTable>
			)}

			{dlg !== undefined &&
				(dlg.kind === 'create' ||
					(dlg.kind === 'edit' && targetRow !== null)) && (
					<InboxFormDialog
						key={dlg.kind === 'edit' ? `edit:${dlg.id}` : 'create'}
						editing={dlg.kind === 'edit' ? targetRow : null}
						onClose={close}
						onCreate={async input => {
							const exit = await createInbox({ payload: input } as never)
							if (exit._tag !== 'Success') {
								return {
									ok: false,
									error: t`Could not create the inbox. Check transport or credentials.`,
								}
							}
							refreshInboxes()
							refreshInboxStatus()
							toastManager.add({
								title: t`Inbox connected`,
								description: t`The mailbox is ready.`,
								type: 'success',
							})
							return { ok: true }
						}}
						onUpdate={async (id, patch) => {
							const exit = await updateInbox({
								params: { id },
								payload: patch,
							})
							if (exit._tag !== 'Success') {
								return { ok: false, error: t`Could not save the inbox.` }
							}
							refreshInboxes()
							refreshInboxStatus()
							toastManager.add({
								title: t`Inbox updated`,
								type: 'success',
							})
							return { ok: true }
						}}
					/>
				)}

			{dlg?.kind === 'footers' && targetRow !== null && (
				<FooterManageDialog
					key={`footers:${targetRow.id}`}
					row={targetRow}
					onClose={close}
				/>
			)}

			{dlg !== undefined &&
				dlg.kind !== 'create' &&
				targetRow === null &&
				!listSettled && <DialogPending onClose={close} />}
		</Page>
	)
}

// Shown briefly when a deep link names a row (?dlg={kind:'edit',id}) before the
// inbox list has loaded, so the dialog doesn't flash empty or closed.
function DialogPending({ onClose }: { readonly onClose: () => void }) {
	const { t } = useLingui()
	return (
		<PriDialog.Root
			open
			onOpenChange={(next: boolean) => {
				if (!next) onClose()
			}}
		>
			<PriDialog.Portal>
				<PriDialog.Backdrop />
				<PriDialog.Popup>
					<DialogHeader>
						<PriDialog.Title>{t`Loading…`}</PriDialog.Title>
						<PriDialog.Close
							render={props => (
								<CloseButton type='button' aria-label={t`Close`} {...props}>
									<X size={16} aria-hidden />
								</CloseButton>
							)}
						/>
					</DialogHeader>
					<SkeletonRows count={3} height='2rem' />
				</PriDialog.Popup>
			</PriDialog.Portal>
		</PriDialog.Root>
	)
}

function isInboxStatus(value: unknown): value is {
	hasDefault: boolean
	primary: { inboxId: string; email: string } | null
} {
	if (!value || typeof value !== 'object') return false
	const r = value as Record<string, unknown>
	return typeof r['hasDefault'] === 'boolean'
}

// ── Dialog ───────────────────────────────────────────────────────

type MutationResult =
	| { readonly ok: true }
	| { readonly ok: false; readonly error: string }

type CreatePayload = {
	readonly email: string
	readonly displayName?: string
	readonly purpose: InboxPurpose
	readonly ownerUserId?: string
	readonly isDefault?: boolean
	readonly isPrivate?: boolean
	readonly imapHost: string
	readonly imapPort: number
	readonly imapSecurity: TransportSecurity
	readonly smtpHost: string
	readonly smtpPort: number
	readonly smtpSecurity: TransportSecurity
	readonly username: string
	readonly password: string
}

type UpdatePayload = {
	readonly displayName?: string | null
	readonly purpose?: InboxPurpose
	readonly ownerUserId?: string | null
	readonly isDefault?: boolean
	readonly isPrivate?: boolean
	readonly active?: boolean
	readonly imapHost?: string
	readonly imapPort?: number
	readonly imapSecurity?: TransportSecurity
	readonly smtpHost?: string
	readonly smtpPort?: number
	readonly smtpSecurity?: TransportSecurity
	readonly username?: string
	readonly password?: string
}

// Seed the edit form from a row. Password is intentionally omitted — it is
// never read back, only set when the user opts to change it.
function rowToDraft(row: InboxRow): InboxDraft {
	return {
		email: row.email,
		displayName: row.displayName ?? '',
		purpose: row.purpose,
		ownerUserId: row.ownerUserId ?? '',
		isDefault: row.isDefault,
		isPrivate: row.isPrivate,
		imapHost: row.imapHost,
		imapPort: row.imapPort,
		imapSecurity: row.imapSecurity,
		smtpHost: row.smtpHost,
		smtpPort: row.smtpPort,
		smtpSecurity: row.smtpSecurity,
		username: row.username,
	}
}

function InboxFormDialog({
	editing,
	onClose,
	onCreate,
	onUpdate,
}: {
	readonly editing: InboxRow | null
	readonly onClose: () => void
	readonly onCreate: (input: CreatePayload) => Promise<MutationResult>
	readonly onUpdate: (
		id: string,
		patch: UpdatePayload,
	) => Promise<MutationResult>
}) {
	const { t } = useLingui()
	const isCreate = editing === null

	const presetsResult = useAtomValue(providerPresetsAtom)
	const presets = useMemo<ReadonlyArray<ProviderPreset>>(
		() =>
			AsyncResult.isSuccess(presetsResult)
				? narrowPresets(presetsResult.value)
				: [],
		[presetsResult],
	)

	// Create keeps its draft in a global atom so a half-filled form survives
	// closing the dialog and navigating away; edit uses local state seeded from
	// the row. Both share the InboxDraft shape, so the form binds to one `draft`
	// regardless of mode. The password is never part of the draft.
	const [createDraft, setCreateDraft] = useAtom(inboxDraftAtom)
	const [editDraft, setEditDraft] = useState<InboxDraft>(() =>
		editing !== null ? rowToDraft(editing) : emptyInboxDraft,
	)
	const draft = isCreate ? createDraft : editDraft
	const patchDraft = useCallback(
		(partial: Partial<InboxDraft>) => {
			if (isCreate) setCreateDraft(prev => ({ ...prev, ...partial }))
			else setEditDraft(prev => ({ ...prev, ...partial }))
		},
		[isCreate, setCreateDraft],
	)

	// Preset name selected in the dropdown — '' means none / custom.
	const [presetName, setPresetName] = useState<string>('')
	const [password, setPassword] = useState('')
	// In edit mode the password field is empty and only sent when the
	// user types a new one, so existing credentials aren't blanked.
	const [changeCredentials, setChangeCredentials] = useState(false)

	const [submitting, setSubmitting] = useState(false)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)

	const applyPreset = useCallback(
		(name: string) => {
			setPresetName(name)
			const preset = presets.find(p => p.name === name)
			if (preset === undefined) return
			patchDraft({
				imapHost: preset.imapHost,
				imapPort: preset.imapPort,
				imapSecurity: preset.imapSecurity,
				smtpHost: preset.smtpHost,
				smtpPort: preset.smtpPort,
				smtpSecurity: preset.smtpSecurity,
			})
		},
		[presets, patchDraft],
	)

	// Derived from the chosen preset: powers the 2FA app-password hint and
	// blocks submit for providers that no longer accept password sign-in.
	const selectedPreset = useMemo(
		() => presets.find(p => p.name === presetName) ?? null,
		[presets, presetName],
	)
	const providerUnsupported =
		selectedPreset !== null && !selectedPreset.passwordAuthSupported
	const appPasswordUrl = selectedPreset?.appPasswordUrl ?? ''
	const setupUrl =
		appPasswordUrl !== '' ? appPasswordUrl : (selectedPreset?.helpUrl ?? '')
	// Tie the active hint or warning to the provider select for screen readers.
	const providerHintId = providerUnsupported
		? 'ix-provider-warning'
		: selectedPreset !== null
			? 'ix-provider-2fa-hint'
			: undefined

	const usernameForSubmit = draft.username !== '' ? draft.username : draft.email

	// Create requires email + transport + credentials. Edit lets the user
	// patch any subset; we always send the full transport so the server's
	// re-probe runs against current state, but only send the password when
	// the user opted into changing it.
	const canSubmit =
		!submitting &&
		!providerUnsupported &&
		(editing !== null
			? draft.email !== ''
			: draft.email !== '' &&
				draft.imapHost !== '' &&
				draft.smtpHost !== '' &&
				password !== '' &&
				usernameForSubmit !== '')

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!canSubmit) return
		setSubmitting(true)
		setErrorMessage(null)

		const result =
			editing !== null
				? await onUpdate(editing.id, {
						displayName: draft.displayName === '' ? null : draft.displayName,
						purpose: draft.purpose,
						ownerUserId:
							draft.purpose === 'human' && draft.ownerUserId !== ''
								? draft.ownerUserId
								: null,
						isDefault: draft.isDefault,
						isPrivate: draft.isPrivate,
						imapHost: draft.imapHost,
						imapPort: draft.imapPort,
						imapSecurity: draft.imapSecurity,
						smtpHost: draft.smtpHost,
						smtpPort: draft.smtpPort,
						smtpSecurity: draft.smtpSecurity,
						username: usernameForSubmit,
						...(changeCredentials && password !== '' && { password }),
					})
				: await onCreate({
						email: draft.email,
						...(draft.displayName !== '' && { displayName: draft.displayName }),
						purpose: draft.purpose,
						...(draft.purpose === 'human' &&
							draft.ownerUserId !== '' && { ownerUserId: draft.ownerUserId }),
						...(draft.isDefault && { isDefault: true }),
						...(draft.isPrivate && { isPrivate: true }),
						imapHost: draft.imapHost,
						imapPort: draft.imapPort,
						imapSecurity: draft.imapSecurity,
						smtpHost: draft.smtpHost,
						smtpPort: draft.smtpPort,
						smtpSecurity: draft.smtpSecurity,
						username: usernameForSubmit,
						password,
					})

		if (result.ok) {
			// Clear the persisted create draft only after a successful connect;
			// closing or navigating away keeps it.
			if (isCreate) setCreateDraft(emptyInboxDraft)
			onClose()
			return
		}
		setErrorMessage(result.error)
		setSubmitting(false)
	}

	return (
		<PriDialog.Root
			open
			onOpenChange={(next: boolean) => {
				if (!next) onClose()
			}}
		>
			<PriDialog.Portal>
				<PriDialog.Backdrop />
				<PriDialog.Popup>
					<DialogHeader>
						<PriDialog.Title>
							{editing !== null ? t`Edit inbox` : t`Connect mailbox`}
						</PriDialog.Title>
						<PriDialog.Close
							render={props => (
								<CloseButton type='button' aria-label={t`Close`} {...props}>
									<X size={16} aria-hidden />
								</CloseButton>
							)}
						/>
					</DialogHeader>

					<Form onSubmit={handleSubmit}>
						{editing === null && presets.length > 0 && (
							<Field>
								<Label>{t`Provider preset`}</Label>
								<PriSelect.Root
									value={presetName}
									onValueChange={value => {
										if (value !== null) applyPreset(value)
									}}
								>
									<PriSelect.Trigger
										aria-label={t`Provider preset`}
										aria-describedby={providerHintId}
									>
										<PriSelect.Value placeholder={t`Pick a provider`} />
										<PriSelect.Icon>
											<ChevronLeft
												size={14}
												aria-hidden
												style={{ transform: 'rotate(-90deg)' }}
											/>
										</PriSelect.Icon>
									</PriSelect.Trigger>
									<PriSelect.Portal>
										<PriSelect.Positioner>
											<PriSelect.Popup>
												{presets.map(p => (
													<PriSelect.Item key={p.name} value={p.name}>
														<PriSelect.ItemIndicator>
															<Check size={12} aria-hidden />
														</PriSelect.ItemIndicator>
														<PriSelect.ItemText>{p.name}</PriSelect.ItemText>
													</PriSelect.Item>
												))}
											</PriSelect.Popup>
										</PriSelect.Positioner>
									</PriSelect.Portal>
								</PriSelect.Root>
								<Hint>{t`Selecting a preset fills IMAP and SMTP defaults — you can still edit them.`}</Hint>
								{selectedPreset !== null &&
									(providerUnsupported ? (
										<Warning role='alert' id='ix-provider-warning'>
											{t`${selectedPreset.name} no longer allows password sign-in for mail apps, so it can't be connected here yet — it needs an OAuth sign-in. Pick another provider or use Generic IMAP.`}
										</Warning>
									) : (
										<Hint id='ix-provider-2fa-hint'>
											{t`Has two-factor authentication enabled? Use a provider app-specific password below, not your normal login password.`}
											{setupUrl !== '' && (
												<>
													{' '}
													<PresetLink
														href={setupUrl}
														aria-label={
															appPasswordUrl !== ''
																? t`Create an app-specific password, opens in a new tab`
																: t`Open the setup guide, opens in a new tab`
														}
														target='_blank'
														rel='noreferrer noopener'
													>
														{appPasswordUrl !== ''
															? t`Create an app password →`
															: t`Setup guide →`}
													</PresetLink>
												</>
											)}
										</Hint>
									))}
							</Field>
						)}

						<Field>
							<Label htmlFor='ix-email'>{t`Email address`}</Label>
							<PriInput
								id='ix-email'
								type='email'
								value={draft.email}
								onChange={e => patchDraft({ email: e.target.value })}
								placeholder={t`you@example.com`}
								required
								disabled={editing !== null}
							/>
						</Field>

						<Field>
							<Label htmlFor='ix-display'>{t`Display name`}</Label>
							<PriInput
								id='ix-display'
								type='text'
								value={draft.displayName}
								onChange={e => patchDraft({ displayName: e.target.value })}
								placeholder={t`e.g. Sales — Acme`}
							/>
						</Field>

						<TransportGrid>
							<Field>
								<Label htmlFor='ix-imap-host'>{t`IMAP host`}</Label>
								<PriInput
									id='ix-imap-host'
									type='text'
									value={draft.imapHost}
									onChange={e => patchDraft({ imapHost: e.target.value })}
									placeholder='imap.example.com'
								/>
							</Field>
							<Field>
								<Label htmlFor='ix-imap-port'>{t`IMAP port`}</Label>
								<PriInput
									id='ix-imap-port'
									type='number'
									value={draft.imapPort}
									onChange={e =>
										patchDraft({ imapPort: parseInt(e.target.value, 10) || 0 })
									}
								/>
							</Field>
							<Field>
								<Label>{t`IMAP security`}</Label>
								<SecuritySelect
									value={draft.imapSecurity}
									onChange={next => patchDraft({ imapSecurity: next })}
									ariaLabel={t`IMAP security`}
								/>
							</Field>

							<Field>
								<Label htmlFor='ix-smtp-host'>{t`SMTP host`}</Label>
								<PriInput
									id='ix-smtp-host'
									type='text'
									value={draft.smtpHost}
									onChange={e => patchDraft({ smtpHost: e.target.value })}
									placeholder='smtp.example.com'
								/>
							</Field>
							<Field>
								<Label htmlFor='ix-smtp-port'>{t`SMTP port`}</Label>
								<PriInput
									id='ix-smtp-port'
									type='number'
									value={draft.smtpPort}
									onChange={e =>
										patchDraft({ smtpPort: parseInt(e.target.value, 10) || 0 })
									}
								/>
							</Field>
							<Field>
								<Label>{t`SMTP security`}</Label>
								<SecuritySelect
									value={draft.smtpSecurity}
									onChange={next => patchDraft({ smtpSecurity: next })}
									ariaLabel={t`SMTP security`}
								/>
							</Field>
						</TransportGrid>

						<Field>
							<Label htmlFor='ix-username'>{t`Username`}</Label>
							<PriInput
								id='ix-username'
								type='text'
								value={draft.username}
								onChange={e => patchDraft({ username: e.target.value })}
								placeholder={t`Defaults to the email address.`}
							/>
						</Field>

						{editing !== null && (
							<CheckboxRow>
								<input
									id='ix-changecreds'
									type='checkbox'
									checked={changeCredentials}
									onChange={e => setChangeCredentials(e.target.checked)}
								/>
								<label htmlFor='ix-changecreds'>
									{t`Change password (re-probes the connection)`}
								</label>
							</CheckboxRow>
						)}

						{(editing === null || changeCredentials) && (
							<Field>
								<Label htmlFor='ix-password'>
									{editing !== null
										? t`New password or app-password`
										: t`Password or app-password`}
								</Label>
								<PriInput
									id='ix-password'
									type='password'
									value={password}
									onChange={e => setPassword(e.target.value)}
									placeholder={t`Stored encrypted with AES-256-GCM.`}
									autoComplete='new-password'
								/>
							</Field>
						)}

						<Field>
							<Label>{t`Purpose`}</Label>
							<PriSelect.Root
								value={draft.purpose}
								onValueChange={value => {
									if (
										value === 'human' ||
										value === 'agent' ||
										value === 'shared'
									) {
										patchDraft({ purpose: value })
									}
								}}
							>
								<PriSelect.Trigger aria-label={t`Purpose`}>
									<PriSelect.Value />
									<PriSelect.Icon>
										<ChevronLeft
											size={14}
											aria-hidden
											style={{ transform: 'rotate(-90deg)' }}
										/>
									</PriSelect.Icon>
								</PriSelect.Trigger>
								<PriSelect.Portal>
									<PriSelect.Positioner>
										<PriSelect.Popup>
											<PriSelect.Item value='human'>
												<PriSelect.ItemIndicator>
													<Check size={12} aria-hidden />
												</PriSelect.ItemIndicator>
												<PriSelect.ItemText>{t`Human`}</PriSelect.ItemText>
											</PriSelect.Item>
											<PriSelect.Item value='agent'>
												<PriSelect.ItemIndicator>
													<Check size={12} aria-hidden />
												</PriSelect.ItemIndicator>
												<PriSelect.ItemText>{t`Agent`}</PriSelect.ItemText>
											</PriSelect.Item>
											<PriSelect.Item value='shared'>
												<PriSelect.ItemIndicator>
													<Check size={12} aria-hidden />
												</PriSelect.ItemIndicator>
												<PriSelect.ItemText>{t`Shared`}</PriSelect.ItemText>
											</PriSelect.Item>
										</PriSelect.Popup>
									</PriSelect.Positioner>
								</PriSelect.Portal>
							</PriSelect.Root>
						</Field>

						{draft.purpose === 'human' && (
							<Field>
								<Label htmlFor='ix-owner'>{t`Owner user ID`}</Label>
								<PriInput
									id='ix-owner'
									type='text'
									value={draft.ownerUserId}
									onChange={e => patchDraft({ ownerUserId: e.target.value })}
									placeholder={t`Defaults to you when omitted.`}
								/>
							</Field>
						)}

						<CheckboxRow>
							<input
								id='ix-default'
								type='checkbox'
								checked={draft.isDefault}
								onChange={e => patchDraft({ isDefault: e.target.checked })}
							/>
							<label htmlFor='ix-default'>{t`Use as default for this purpose`}</label>
						</CheckboxRow>

						{draft.purpose !== 'shared' && (
							<CheckboxRow>
								<input
									id='ix-private'
									type='checkbox'
									checked={draft.isPrivate}
									onChange={e => patchDraft({ isPrivate: e.target.checked })}
								/>
								<label htmlFor='ix-private'>
									{t`Private — hide threads from other members`}
								</label>
							</CheckboxRow>
						)}

						{errorMessage !== null && (
							<ErrorText role='alert'>{errorMessage}</ErrorText>
						)}

						<Footer>
							<PriButton
								type='button'
								$variant='text'
								onClick={onClose}
								disabled={submitting}
							>
								{t`Cancel`}
							</PriButton>
							<PriButton
								type='submit'
								$variant='filled'
								disabled={!canSubmit}
								aria-describedby={
									providerUnsupported ? 'ix-provider-warning' : undefined
								}
							>
								{submitting
									? t`Testing connection…`
									: editing !== null
										? t`Save`
										: t`Test & connect`}
							</PriButton>
						</Footer>
					</Form>
				</PriDialog.Popup>
			</PriDialog.Portal>
		</PriDialog.Root>
	)
}

function SecuritySelect({
	value,
	onChange,
	ariaLabel,
}: {
	readonly value: TransportSecurity
	readonly onChange: (next: TransportSecurity) => void
	readonly ariaLabel: string
}) {
	const { t } = useLingui()
	return (
		<PriSelect.Root
			value={value}
			onValueChange={next => {
				if (next === 'tls' || next === 'starttls' || next === 'plain') {
					onChange(next)
				}
			}}
		>
			<PriSelect.Trigger aria-label={ariaLabel}>
				<PriSelect.Value />
				<PriSelect.Icon>
					<ChevronLeft
						size={14}
						aria-hidden
						style={{ transform: 'rotate(-90deg)' }}
					/>
				</PriSelect.Icon>
			</PriSelect.Trigger>
			<PriSelect.Portal>
				<PriSelect.Positioner>
					<PriSelect.Popup>
						<PriSelect.Item value='tls'>
							<PriSelect.ItemIndicator>
								<Check size={12} aria-hidden />
							</PriSelect.ItemIndicator>
							<PriSelect.ItemText>{t`TLS`}</PriSelect.ItemText>
						</PriSelect.Item>
						<PriSelect.Item value='starttls'>
							<PriSelect.ItemIndicator>
								<Check size={12} aria-hidden />
							</PriSelect.ItemIndicator>
							<PriSelect.ItemText>{t`STARTTLS`}</PriSelect.ItemText>
						</PriSelect.Item>
						<PriSelect.Item value='plain'>
							<PriSelect.ItemIndicator>
								<Check size={12} aria-hidden />
							</PriSelect.ItemIndicator>
							<PriSelect.ItemText>{t`Plain`}</PriSelect.ItemText>
						</PriSelect.Item>
					</PriSelect.Popup>
				</PriSelect.Positioner>
			</PriSelect.Portal>
		</PriSelect.Root>
	)
}

// App-password page for the provider matching an inbox's IMAP host, or '' when
// the host isn't a known preset. Points an auth-failed inbox (usually a 2FA
// account missing its app password) at the right place to create one.
function authPasswordUrlFor(
	presets: ReadonlyArray<ProviderPreset>,
	imapHost: string,
): string {
	if (imapHost === '') return ''
	const preset = presets.find(p => p.imapHost === imapHost)
	return preset?.appPasswordUrl ?? ''
}

function narrowPresets(raw: unknown): ReadonlyArray<ProviderPreset> {
	if (!Array.isArray(raw)) return []
	const out: Array<ProviderPreset> = []
	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') continue
		const r = entry as Record<string, unknown>
		const sec = (s: unknown): TransportSecurity | null =>
			s === 'tls' || s === 'starttls' || s === 'plain' ? s : null
		const imapSec = sec(r['imapSecurity'])
		const smtpSec = sec(r['smtpSecurity'])
		if (
			typeof r['name'] !== 'string' ||
			typeof r['imapHost'] !== 'string' ||
			typeof r['imapPort'] !== 'number' ||
			imapSec === null ||
			typeof r['smtpHost'] !== 'string' ||
			typeof r['smtpPort'] !== 'number' ||
			smtpSec === null
		) {
			continue
		}
		out.push({
			name: r['name'],
			imapHost: r['imapHost'],
			imapPort: r['imapPort'],
			imapSecurity: imapSec,
			smtpHost: r['smtpHost'],
			smtpPort: r['smtpPort'],
			smtpSecurity: smtpSec,
			helpUrl: typeof r['helpUrl'] === 'string' ? r['helpUrl'] : '',
			appPasswordUrl:
				typeof r['appPasswordUrl'] === 'string' ? r['appPasswordUrl'] : '',
			passwordAuthSupported: r['passwordAuthSupported'] !== false,
		})
	}
	return out
}

// ── Footer management dialog ────────────────────────────────────

type FooterRow = {
	readonly id: string
	readonly name: string
	readonly bodyJson: EmailBlocks
	readonly isDefault: boolean
}

type FooterEditing =
	| { readonly kind: 'none' }
	| { readonly kind: 'create' }
	| { readonly kind: 'edit'; readonly footer: FooterRow }

function FooterManageDialog({
	row,
	onClose,
}: {
	readonly row: InboxRow
	readonly onClose: () => void
}) {
	const { t } = useLingui()
	const toastManager = usePriToast()
	const footersResult = useAtomValue(footersAtomFor(row.id))
	const refreshFooters = useAtomRefresh(footersAtomFor(row.id))

	const createFooter = useAtomSet(createFooterAtom, { mode: 'promiseExit' })
	const updateFooter = useAtomSet(updateFooterAtom, { mode: 'promiseExit' })
	const deleteFooter = useAtomSet(deleteFooterAtom, { mode: 'promiseExit' })

	const footers = useMemo<ReadonlyArray<FooterRow>>(
		() =>
			AsyncResult.isSuccess(footersResult)
				? narrowFooterRows(footersResult.value)
				: [],
		[footersResult],
	)

	const [editing, setEditing] = useState<FooterEditing>({ kind: 'none' })
	const [name, setName] = useState('')
	const [bodyJson, setBodyJson] = useState<EmailBlocks>([])
	const [bodyText, setBodyText] = useState('')
	const [isDefault, setIsDefault] = useState(false)
	const [submitting, setSubmitting] = useState(false)

	const startCreate = useCallback(() => {
		setName('')
		setBodyJson([])
		setBodyText('')
		setIsDefault(false)
		setEditing({ kind: 'create' })
	}, [])

	const startEdit = useCallback((footer: FooterRow) => {
		setName(footer.name)
		setBodyJson(footer.bodyJson)
		setBodyText('')
		setIsDefault(footer.isDefault)
		setEditing({ kind: 'edit', footer })
	}, [])

	const cancelEdit = useCallback(() => {
		setEditing({ kind: 'none' })
	}, [])

	const handleSave = useCallback(async () => {
		if (name.trim() === '' || bodyText.trim() === '') return
		setSubmitting(true)
		if (editing.kind === 'create') {
			const exit = await createFooter({
				params: { inboxId: row.id },
				payload: {
					name,
					bodyJson,
					...(isDefault && { isDefault: true }),
				},
			} as never)
			if (exit._tag !== 'Success') {
				toastManager.add({
					title: t`Create failed`,
					type: 'error',
				})
				setSubmitting(false)
				return
			}
		} else if (editing.kind === 'edit') {
			const exit = await updateFooter({
				params: { id: editing.footer.id },
				payload: {
					name,
					bodyJson,
					isDefault,
				},
			} as never)
			if (exit._tag !== 'Success') {
				toastManager.add({
					title: t`Update failed`,
					type: 'error',
				})
				setSubmitting(false)
				return
			}
		}
		refreshFooters()
		setEditing({ kind: 'none' })
		setSubmitting(false)
	}, [
		editing,
		name,
		bodyJson,
		bodyText,
		isDefault,
		row.id,
		createFooter,
		updateFooter,
		refreshFooters,
		toastManager,
		t,
	])

	const handleDelete = useCallback(
		async (footerId: string) => {
			const ok = window.confirm(t`Delete this footer? This cannot be undone.`)
			if (!ok) return
			const exit = await deleteFooter({
				params: { id: footerId },
			} as never)
			if (exit._tag !== 'Success') {
				toastManager.add({
					title: t`Delete failed`,
					type: 'error',
				})
				return
			}
			refreshFooters()
		},
		[deleteFooter, refreshFooters, toastManager, t],
	)

	const handleSetDefault = useCallback(
		async (footer: FooterRow) => {
			if (footer.isDefault) return
			const exit = await updateFooter({
				params: { id: footer.id },
				payload: { isDefault: true },
			} as never)
			if (exit._tag !== 'Success') {
				toastManager.add({
					title: t`Update failed`,
					type: 'error',
				})
				return
			}
			refreshFooters()
		},
		[updateFooter, refreshFooters, toastManager, t],
	)

	return (
		<PriDialog.Root
			open
			onOpenChange={(next: boolean) => {
				if (!next) onClose()
			}}
		>
			<PriDialog.Portal>
				<PriDialog.Backdrop />
				<PriDialog.Popup>
					<DialogHeader>
						<PriDialog.Title>{t`Footers — ${row.email}`}</PriDialog.Title>
						<PriDialog.Close
							render={props => (
								<CloseButton type='button' aria-label={t`Close`} {...props}>
									<X size={16} aria-hidden />
								</CloseButton>
							)}
						/>
					</DialogHeader>

					{editing.kind === 'none' ? (
						<FooterListView>
							{footers.length === 0 ? (
								<EmptyState
									icon={FileText}
									title={t`No footers`}
									description={t`Create a footer to append to outgoing emails from this inbox.`}
								/>
							) : (
								<FooterTable>
									{footers.map(f => (
										<FooterItem key={f.id}>
											<FooterName>
												{f.name}
												{f.isDefault ? (
													<DefaultTag>{t`Default`}</DefaultTag>
												) : null}
											</FooterName>
											<FooterActions>
												{!f.isDefault && (
													<IconAction
														type='button'
														onClick={() => {
															void handleSetDefault(f)
														}}
														aria-label={t`Set as default`}
													>
														<Star size={14} aria-hidden />
													</IconAction>
												)}
												<IconAction
													type='button'
													onClick={() => startEdit(f)}
													aria-label={t`Edit`}
												>
													<Pencil size={14} aria-hidden />
												</IconAction>
												<IconAction
													type='button'
													onClick={() => {
														void handleDelete(f.id)
													}}
													aria-label={t`Delete`}
												>
													<Trash2 size={14} aria-hidden />
												</IconAction>
											</FooterActions>
										</FooterItem>
									))}
								</FooterTable>
							)}
							<FooterDialogFooter>
								<PriButton
									type='button'
									$variant='filled'
									onClick={startCreate}
								>
									<Plus size={14} aria-hidden />
									<span>{t`Create footer`}</span>
								</PriButton>
							</FooterDialogFooter>
						</FooterListView>
					) : (
						<Form
							onSubmit={e => {
								e.preventDefault()
								void handleSave()
							}}
						>
							<Field>
								<Label htmlFor='ftr-name'>{t`Name`}</Label>
								<PriInput
									id='ftr-name'
									type='text'
									value={name}
									onChange={e => setName(e.target.value)}
									placeholder={t`e.g. Company signature`}
								/>
							</Field>
							<Field>
								<Label>{t`Content`}</Label>
								<FooterEditorWrap>
									<EmailEditor
										mode='footer'
										inboxId={row.id}
										initialJson={bodyJson}
										onChange={({ json, text }) => {
											setBodyJson(json)
											setBodyText(text)
										}}
										placeholder={t`Write footer…`}
									/>
								</FooterEditorWrap>
							</Field>
							<CheckboxRow>
								<input
									id='ftr-default'
									type='checkbox'
									checked={isDefault}
									onChange={e => setIsDefault(e.target.checked)}
								/>
								<label htmlFor='ftr-default'>{t`Use as default footer`}</label>
							</CheckboxRow>
							<Footer>
								<PriButton
									type='button'
									$variant='text'
									onClick={cancelEdit}
									disabled={submitting}
								>
									{t`Cancel`}
								</PriButton>
								<PriButton
									type='submit'
									$variant='filled'
									disabled={
										submitting || name.trim() === '' || bodyText.trim() === ''
									}
								>
									{submitting
										? t`Saving…`
										: editing.kind === 'create'
											? t`Create`
											: t`Save`}
								</PriButton>
							</Footer>
						</Form>
					)}
				</PriDialog.Popup>
			</PriDialog.Portal>
		</PriDialog.Root>
	)
}

function narrowFooterRows(raw: unknown): ReadonlyArray<FooterRow> {
	if (!Array.isArray(raw)) return []
	const out: FooterRow[] = []
	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') continue
		const r = entry as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		const bodyJson = Array.isArray(r['bodyJson'])
			? (r['bodyJson'] as EmailBlocks)
			: []
		out.push({
			id: r['id'],
			name: typeof r['name'] === 'string' ? r['name'] : '',
			bodyJson,
			isDefault: r['isDefault'] === true,
		})
	}
	return out
}

// ── Narrowing ────────────────────────────────────────────────────

function narrowInboxRows(rows: unknown): ReadonlyArray<InboxRow> {
	if (!Array.isArray(rows)) return []
	const out: Array<InboxRow> = []
	const sec = (v: unknown): TransportSecurity =>
		v === 'starttls' ? 'starttls' : v === 'plain' ? 'plain' : 'tls'
	const status = (v: unknown): GrantStatus =>
		v === 'auth_failed'
			? 'auth_failed'
			: v === 'connect_failed'
				? 'connect_failed'
				: v === 'disabled'
					? 'disabled'
					: 'connected'
	const isoString = (v: unknown): string | null =>
		typeof v === 'string' ? v : v instanceof Date ? v.toISOString() : null
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		if (typeof r['email'] !== 'string') continue
		const purpose = r['purpose']
		if (purpose !== 'human' && purpose !== 'agent' && purpose !== 'shared') {
			continue
		}
		out.push({
			id: r['id'],
			email: r['email'],
			displayName:
				typeof r['displayName'] === 'string' ? r['displayName'] : null,
			purpose,
			ownerUserId:
				typeof r['ownerUserId'] === 'string' ? r['ownerUserId'] : null,
			isDefault: r['isDefault'] === true,
			isPrivate: r['isPrivate'] === true,
			active: r['active'] !== false,
			imapHost: typeof r['imapHost'] === 'string' ? r['imapHost'] : '',
			imapPort: typeof r['imapPort'] === 'number' ? r['imapPort'] : 993,
			imapSecurity: sec(r['imapSecurity']),
			smtpHost: typeof r['smtpHost'] === 'string' ? r['smtpHost'] : '',
			smtpPort: typeof r['smtpPort'] === 'number' ? r['smtpPort'] : 465,
			smtpSecurity: sec(r['smtpSecurity']),
			username: typeof r['username'] === 'string' ? r['username'] : '',
			grantStatus: status(r['grantStatus']),
			grantLastError:
				typeof r['grantLastError'] === 'string' ? r['grantLastError'] : null,
			grantLastSeenAt: isoString(r['grantLastSeenAt']),
			createdAt: isoString(r['createdAt']),
			updatedAt: isoString(r['updatedAt']),
		})
	}
	return out
}

// ── Styles ───────────────────────────────────────────────────────

const Page = styled.div.withConfig({ displayName: 'InboxesPage' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`

const Intro = styled.div.withConfig({ displayName: 'InboxesIntro' })`
	display: grid;
	gap: var(--space-md);
	align-items: end;

	@media (min-width: 768px) {
		grid-template-columns: 1fr auto;
	}
`

const IntroText = styled.div.withConfig({ displayName: 'InboxesIntroText' })`
	${rulerUnderRule}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-bottom: var(--space-xs);
`

const IntroActions = styled.div.withConfig({
	displayName: 'InboxesIntroActions',
})`
	display: flex;
	gap: var(--space-xs);
	flex-wrap: wrap;
	justify-self: start;

	@media (min-width: 768px) {
		justify-self: end;
	}
`

const BackLink = styled.div.withConfig({ displayName: 'InboxesBackLink' })`
	> a {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2xs);
		font-family: var(--font-display);
		font-size: var(--typescale-label-small-size);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-on-surface-variant);
		text-decoration: none;
	}

	> a:hover {
		color: var(--color-primary);
	}
`

const Title = styled.h2.withConfig({ displayName: 'InboxesTitle' })`
	${stenciledTitle}
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
	margin: 0;
`

const Subtitle = styled.p.withConfig({ displayName: 'InboxesSubtitle' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const InboxesTable = styled.div.withConfig({ displayName: 'InboxesTable' })`
	display: flex;
	flex-direction: column;
	border: 1px solid var(--color-ledger-line);
	border-radius: var(--shape-2xs);
	overflow: hidden;
	background: var(--color-paper-aged);
`

const gridTemplate = css`
	display: grid;
	grid-template-columns:
		minmax(0, 2fr)
		8rem
		6rem
		4rem
		4rem
		minmax(0, 1fr)
		8rem;
	align-items: center;
	gap: var(--space-sm);
	padding: var(--space-sm) var(--space-md);

	@media (max-width: 767px) {
		grid-template-columns: 1fr auto;
		gap: var(--space-2xs);
	}
`

const TableHead = styled.div.withConfig({ displayName: 'InboxesTableHead' })`
	${gridTemplate}
	background: linear-gradient(
		145deg,
		var(--color-metal-light) 0%,
		var(--color-metal) 55%,
		var(--color-metal-dark) 100%
	);
	color: var(--color-on-surface);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	text-shadow: var(--text-shadow-emboss);
	border-bottom: 1px solid rgba(0, 0, 0, 0.25);

	@media (max-width: 767px) {
		display: none;
	}
`

const HeadCell = styled.div.withConfig({ displayName: 'InboxesHeadCell' })``

const TableRow = styled.div.withConfig({
	displayName: 'InboxesTableRow',
	shouldForwardProp: prop => prop !== '$inactive',
})<{ $inactive: boolean }>`
	${gridTemplate}
	${agedPaperRow}
	border-bottom: 1px solid var(--color-ledger-line);
	opacity: ${p => (p.$inactive ? 0.6 : 1)};

	&:last-child {
		border-bottom: none;
	}
`

const CellEmail = styled.div.withConfig({ displayName: 'InboxesCellEmail' })`
	display: flex;
	flex-direction: column;
	min-width: 0;
`

const EmailAddress = styled.span.withConfig({ displayName: 'InboxesEmail' })`
	font-family: var(--font-body);
	font-weight: var(--font-weight-medium);
	color: var(--color-on-surface);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const DisplayName = styled.span.withConfig({
	displayName: 'InboxesDisplayName',
})`
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const CellPurpose = styled.div.withConfig({
	displayName: 'InboxesCellPurpose',
})``

const CellStatus = styled.div.withConfig({ displayName: 'InboxesCellStatus' })``

const EmailMeta = styled.div.withConfig({ displayName: 'InboxesEmailMeta' })`
	display: flex;
	align-items: center;
	gap: var(--space-2xs);
	flex-wrap: wrap;
	min-width: 0;
`

const HostName = styled.span.withConfig({ displayName: 'InboxesHostName' })`
	font-family: var(--font-mono, monospace);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const PrivacyTag = styled.span.withConfig({ displayName: 'InboxesPrivacyTag' })`
	display: inline-flex;
	padding: 1px var(--space-2xs);
	border-radius: var(--shape-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	background: color-mix(in oklab, #6366f1 10%, transparent);
	color: color-mix(in oklab, #4338ca 80%, black);
	border: 1px solid color-mix(in oklab, #6366f1 35%, transparent);
`

const StatusBadge = styled.span.withConfig({
	displayName: 'InboxesStatusBadge',
	shouldForwardProp: prop => prop !== '$status',
})<{ $status: GrantStatus }>`
	display: inline-flex;
	align-items: center;
	padding: 2px var(--space-2xs);
	border-radius: var(--shape-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	cursor: ${p => (p.$status !== 'connected' ? 'help' : 'default')};
	${p =>
		p.$status === 'connected'
			? css`
					background: color-mix(in oklab, #16a34a 14%, transparent);
					color: color-mix(in oklab, #166534 80%, black);
					border: 1px solid color-mix(in oklab, #16a34a 40%, transparent);
				`
			: p.$status === 'auth_failed'
				? css`
						background: color-mix(in oklab, var(--color-error) 14%, transparent);
						color: color-mix(in oklab, var(--color-error) 80%, black);
						border: 1px solid
							color-mix(in oklab, var(--color-error) 45%, transparent);
					`
				: p.$status === 'connect_failed'
					? css`
							background: color-mix(in oklab, #f59e0b 18%, transparent);
							color: color-mix(in oklab, #b45309 80%, black);
							border: 1px solid color-mix(in oklab, #f59e0b 45%, transparent);
						`
					: css`
							background: transparent;
							color: var(--color-on-surface-variant);
							border: 1px dashed var(--color-outline);
						`}
`

const PrimaryBanner = styled.div.withConfig({
	displayName: 'InboxesPrimaryBanner',
})`
	${agedPaperRow}
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-md);
	padding: var(--space-sm) var(--space-md);
	border: 1px solid var(--color-ledger-line);
	border-left: 3px solid var(--color-primary);
	border-radius: var(--shape-2xs);

	@media (max-width: 767px) {
		flex-direction: column;
		align-items: flex-start;
	}
`

const PrimaryBannerText = styled.p.withConfig({
	displayName: 'InboxesPrimaryBannerText',
})`
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);

	strong {
		font-family: var(--font-display);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-size: var(--typescale-label-small-size);
		margin-right: var(--space-2xs);
	}
`

const PrimaryBannerActions = styled.div.withConfig({
	displayName: 'InboxesPrimaryBannerActions',
})`
	display: flex;
	gap: var(--space-xs);
`

const TransportGrid = styled.div.withConfig({
	displayName: 'InboxFormTransportGrid',
})`
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: var(--space-sm);

	@media (max-width: 640px) {
		grid-template-columns: 1fr;
	}
`

const Hint = styled.p.withConfig({ displayName: 'InboxFormHint' })`
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
	font-style: italic;
`

const PresetLink = styled.a.withConfig({ displayName: 'InboxFormPresetLink' })`
	color: var(--color-primary);
	font-style: normal;
	text-decoration: underline;
`

const Warning = styled.p.withConfig({ displayName: 'InboxFormWarning' })`
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	color: var(--color-error);
`

const AuthHint = styled.p.withConfig({ displayName: 'InboxesAuthHint' })`
	margin: var(--space-2xs) 0 0;
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
`

const CellDefault = styled.div.withConfig({
	displayName: 'InboxesCellDefault',
})``
const CellActive = styled.div.withConfig({ displayName: 'InboxesCellActive' })``
const CellDate = styled.div.withConfig({ displayName: 'InboxesCellDate' })`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);

	@media (max-width: 767px) {
		display: none;
	}
`
const CellActions = styled.div.withConfig({
	displayName: 'InboxesCellActions',
})`
	display: flex;
	justify-content: flex-end;
	gap: var(--space-3xs);
`

const PurposeBadge = styled.span.withConfig({
	displayName: 'InboxesPurposeBadge',
	shouldForwardProp: prop => prop !== '$purpose',
})<{ $purpose: InboxPurpose }>`
	display: inline-flex;
	align-items: center;
	padding: 2px var(--space-2xs);
	border-radius: var(--shape-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	${p =>
		p.$purpose === 'human'
			? css`
					background: color-mix(in oklab, var(--color-primary) 16%, transparent);
					color: color-mix(in oklab, var(--color-primary) 80%, black);
					border: 1px solid
						color-mix(in oklab, var(--color-primary) 45%, transparent);
				`
			: p.$purpose === 'agent'
				? css`
						background: color-mix(in oklab, #6366f1 16%, transparent);
						color: color-mix(in oklab, #4338ca 80%, black);
						border: 1px solid color-mix(in oklab, #6366f1 45%, transparent);
					`
				: css`
						background: transparent;
						color: var(--color-on-surface-variant);
						border: 1px dashed var(--color-outline);
					`}
`

const IconToggle = styled.button.withConfig({
	displayName: 'InboxesIconToggle',
	shouldForwardProp: prop => prop !== '$active',
})<{ $active: boolean }>`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.75rem;
	height: 1.75rem;
	padding: 0;
	background: transparent;
	border: 1px ${p => (p.$active ? 'solid' : 'dashed')}
		${p => (p.$active ? 'var(--color-primary)' : 'var(--color-outline)')};
	border-radius: var(--shape-2xs);
	color: ${p =>
		p.$active ? 'var(--color-primary)' : 'var(--color-on-surface-variant)'};
	cursor: pointer;
	transition:
		color 160ms ease,
		border-color 160ms ease,
		background 160ms ease;

	&:hover:not(:disabled) {
		color: var(--color-primary);
		border-color: var(--color-primary);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const IconAction = styled.button.withConfig({
	displayName: 'InboxesIconAction',
})`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.75rem;
	height: 1.75rem;
	padding: 0;
	background: transparent;
	border: 1px dashed var(--color-outline);
	border-radius: var(--shape-2xs);
	color: var(--color-on-surface-variant);
	cursor: pointer;

	&:hover:not(:disabled) {
		color: var(--color-primary);
		border-color: var(--color-primary);
		border-style: solid;
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const Muted = styled.span.withConfig({ displayName: 'InboxesMuted' })`
	color: var(--color-on-surface-variant);
	font-style: italic;
	opacity: 0.7;
`

const DialogHeader = styled.div.withConfig({
	displayName: 'InboxFormHeader',
})`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	margin-bottom: var(--space-md);
`

const CloseButton = styled.button.withConfig({
	displayName: 'InboxFormClose',
})`
	${brushedMetalPlate}
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2rem;
	height: 2rem;
	padding: 0;
	color: var(--color-on-surface);
	cursor: pointer;

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const Form = styled.form.withConfig({ displayName: 'InboxForm' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
`

const Field = styled.div.withConfig({ displayName: 'InboxFormField' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const Label = styled.label.withConfig({ displayName: 'InboxFormLabel' })`
	${stenciledTitle}
	font-size: var(--typescale-label-small-size);
`

const CheckboxRow = styled.div.withConfig({
	displayName: 'InboxFormCheckboxRow',
})`
	display: flex;
	align-items: center;
	gap: var(--space-xs);
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
`

const ErrorText = styled.p.withConfig({ displayName: 'InboxFormError' })`
	margin: 0;
	padding: var(--space-2xs) var(--space-sm);
	border-left: 3px solid var(--color-error);
	background: color-mix(in srgb, var(--color-error) 6%, transparent);
	color: var(--color-error);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
`

const Footer = styled.div.withConfig({ displayName: 'InboxFormFooter' })`
	${rulerUnderRule}
	display: flex;
	justify-content: flex-end;
	gap: var(--space-sm);
	padding-top: var(--space-sm);
	background-position: left top;
`

// ── Footer dialog styles ────────────────────────────────────────

const FooterListView = styled.div.withConfig({
	displayName: 'FooterListView',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
`

const FooterTable = styled.div.withConfig({ displayName: 'FooterTable' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const FooterItem = styled.div.withConfig({ displayName: 'FooterItem' })`
	${agedPaperRow}
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	padding: var(--space-sm) var(--space-md);
	border: 1px solid var(--color-ledger-line);
	border-radius: var(--shape-2xs);
`

const FooterName = styled.div.withConfig({ displayName: 'FooterName' })`
	display: flex;
	align-items: center;
	gap: var(--space-xs);
	font-family: var(--font-body);
	font-weight: var(--font-weight-medium);
	min-width: 0;
`

const DefaultTag = styled.span.withConfig({ displayName: 'FooterDefault' })`
	display: inline-flex;
	padding: 1px var(--space-2xs);
	border-radius: var(--shape-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	background: color-mix(in oklab, var(--color-primary) 16%, transparent);
	color: color-mix(in oklab, var(--color-primary) 80%, black);
	border: 1px solid
		color-mix(in oklab, var(--color-primary) 45%, transparent);
`

const FooterActions = styled.div.withConfig({
	displayName: 'FooterActions',
})`
	display: flex;
	gap: var(--space-3xs);
	flex: 0 0 auto;
`

const FooterDialogFooter = styled.div.withConfig({
	displayName: 'FooterDialogFooter',
})`
	display: flex;
	justify-content: flex-start;
`

const FooterEditorWrap = styled.div.withConfig({
	displayName: 'FooterEditorWrap',
})`
	min-height: 120px;
	border: 1px solid var(--color-ledger-line);
	border-radius: var(--shape-2xs);
	padding: var(--space-2xs);
`
