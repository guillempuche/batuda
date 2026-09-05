import {
	useAtom,
	useAtomRefresh,
	useAtomSet,
	useAtomValue,
} from '@effect/atom-react'
import { useLingui } from '@lingui/react/macro'
import { createFileRoute, Link, useLocation } from '@tanstack/react-router'
import { DateTime, Option, Schema } from 'effect'
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
import { css, styled } from 'next-yak'
import type { ComponentType } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { EmailBlocks } from '@batuda/email/schema'
import {
	PriButton,
	PriDialog,
	PriInput,
	PriMenu,
	PriSelect,
	PriTooltip,
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
import { EmailEditor } from '#/components/emails/email-editor'
import { EmptyState } from '#/components/shared/empty-state'
import { ErrorState } from '#/components/shared/error-state'
import { RelativeDate } from '#/components/shared/relative-date'
import { SkeletonRows } from '#/components/shared/skeleton-row'
import { SrOnly } from '#/components/shared/sr-only'
import { dehydrateAtom } from '#/lib/atom-hydration'
import { authClient } from '#/lib/auth-client'
import { dlgNoId, dlgWithId } from '#/lib/dlg-search'
import { validateSearchWith } from '#/lib/search-schema'
import { getServerCookieHeader } from '#/lib/server-cookie'
import {
	agedPaperRow,
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

type TransportSecurity = 'tls' | 'starttls' | 'plain'
type GrantStatus = 'connected' | 'auth_failed' | 'connect_failed' | 'disabled'
// What the status pill shows: how signing in to the mailbox last went.
type StatusTone = GrantStatus

type InboxRow = {
	readonly id: string
	readonly email: string
	readonly displayName: string | null
	readonly description: string | null
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

// Return type is inferred from the typed API client so the dehydrated atom
// value matches the listInboxes atom's success schema; `narrowInboxRows`
// still treats it as unknown.
async function loadInboxesOnServer() {
	const [{ Effect }, { makeBatudaApiServer }, cookie] = await Promise.all([
		import('effect'),
		import('#/lib/batuda-api-server'),
		getServerCookieHeader(),
	])
	const program = Effect.gen(function* () {
		const client = yield* makeBatudaApiServer(cookie ?? undefined)
		return yield* client.email.listInboxes({ query: { active: 'true' } })
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

	const meUserId = useMeUserId()
	const canManageOthers = useCanManageOthers()
	const identityPending = useIdentityPending()
	// Read out when the address somebody sends from changes, since the row
	// simply redraws in place.
	const [primaryAnnouncement, setPrimaryAnnouncement] = useState('')
	// Their own mailbox, as opposed to a colleague's or the team's.
	const isMine = useCallback(
		(row: InboxRow) => meUserId !== undefined && row.ownerUserId === meUserId,
		[meUserId],
	)
	// Everyone looks after their own; whoever runs the organization looks
	// after everyone's, the team's included.
	const canLookAfter = useCallback(
		(row: InboxRow) => canManageOthers || isMine(row),
		[canManageOthers, isMine],
	)

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
	// Waiting on who is asking counts as still loading: the rows are unusable
	// until then, since every control on them turns on whose mailbox it is.
	const isLoading = AsyncResult.isInitial(inboxesResult) || identityPending
	const isFailure = AsyncResult.isFailure(inboxesResult)
	// Both the list and who is asking. The list arrives already filled from
	// the server, so without the second half a link to a mailbox's settings
	// would judge it unreachable and shut itself.
	const listSettled =
		(AsyncResult.isSuccess(inboxesResult) ||
			AsyncResult.isFailure(inboxesResult)) &&
		!identityPending

	// Edit/footers dialogs carry only the row id in the URL; resolve the row
	// from the loaded list. A deep link closes itself when the row is gone, or
	// is not this person's to change — the address bar is a way in too.
	const targetRow = useMemo(() => {
		if (dlg === undefined || dlg.kind === 'create') return null
		const row = rows.find(row => row.id === dlg.id) ?? null
		return row !== null && canLookAfter(row) ? row : null
	}, [dlg, rows, canLookAfter])
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

	// Only the viewer's own mailboxes can be offered: choosing what somebody
	// sends from is theirs alone.
	const primarySuggestions = useMemo(
		() => rows.filter(row => row.active && isMine(row)),
		[rows, isMine],
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

	// Goes through the same call as the banner, which is the one that checks
	// the mailbox is yours — so the star cannot move a colleague's.
	const setDefault = useCallback(
		async (row: InboxRow) => {
			if (row.isDefault) return
			const exit = await setPrimaryInbox({ params: { id: row.id } })
			if (exit._tag !== 'Success') {
				toastManager.add({
					title: t`Could not set the default inbox`,
					type: 'error',
				})
				return
			}
			refreshInboxes()
			refreshInboxStatus()
			// Said out loud as well as drawn: the row redraws in place, which is
			// a change somebody not looking at it would otherwise miss.
			setPrimaryAnnouncement(t`${row.email} is now the address you send from`)
			toastManager.add({ title: t`Primary inbox set`, type: 'success' })
		},
		[setPrimaryInbox, refreshInboxes, refreshInboxStatus, toastManager, t],
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
			{/* Mounted from the start and filled later: a region that appears
			    together with its words is often not read out at all. */}
			<SrOnly role='status' aria-live='polite'>
				{primaryAnnouncement}
			</SrOnly>
			<Intro>
				<IntroText>
					<BackLink>
						<Link to='/emails'>
							<ChevronLeft size={14} aria-hidden />
							<span>{t`Back to emails`}</span>
						</Link>
					</BackLink>
					<Title>{t`Your email connections`}</Title>
					<Subtitle>{t`Connect the email address you use with customers, so you can send and receive right here.`}</Subtitle>
				</IntroText>
				<IntroActions>
					<PriButton
						type='button'
						$variant='filled'
						data-testid='inboxes-connect'
						onClick={openCreate}
					>
						<Plus size={14} aria-hidden />
						<span>{t`Connect an email`}</span>
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
							<PriMenu.Root>
								<PriMenu.Trigger
									render={props => (
										<PriButton
											type='button'
											$variant='outlined'
											aria-label={t`Choose primary inbox`}
											{...props}
										>
											<span>{t`Choose primary inbox`}</span>
											<ChevronLeft
												size={14}
												aria-hidden
												style={{ transform: 'rotate(-90deg)' }}
											/>
										</PriButton>
									)}
								/>
								<PriMenu.Portal>
									<PriMenu.Positioner sideOffset={6}>
										<PriMenu.Popup>
											{primarySuggestions.map(row => (
												<PriMenu.Item
													key={row.id}
													onClick={() => {
														void handleSetPrimary(row.id)
													}}
												>
													{row.email}
												</PriMenu.Item>
											))}
										</PriMenu.Popup>
									</PriMenu.Positioner>
								</PriMenu.Portal>
							</PriMenu.Root>
						)}
					</PrimaryBannerActions>
				</PrimaryBanner>
			)}

			{isLoading ? (
				<SkeletonRows count={5} height='3rem' />
			) : isFailure ? (
				<ErrorState
					data-testid='inboxes-error'
					title={t`Could not load inboxes`}
					description={t`The inboxes could not be fetched. Check that the session is valid, then try again.`}
					onRetry={refreshInboxes}
				/>
			) : rows.length === 0 ? (
				<EmptyState
					icon={InboxIcon}
					title={t`Connect your email to get started`}
					description={
						<EmptyHelp>
							<p>{t`Once it's connected, I can send and receive email for you right here — no switching tabs.`}</p>
							<ol>
								<li>{t`Pick your email provider`}</li>
								<li>{t`Paste an app password — I'll show you where to get one`}</li>
								<li>{t`Start sending and receiving`}</li>
							</ol>
						</EmptyHelp>
					}
					action={
						<PriButton
							type='button'
							$variant='filled'
							data-testid='inboxes-empty-connect'
							onClick={openCreate}
						>
							<Plus size={14} aria-hidden />
							<span>{t`Connect an email`}</span>
						</PriButton>
					}
				/>
			) : (
				<InboxesTable role='table' aria-label={t`Your email connections`}>
					<TableHead role='row'>
						<HeadCell role='columnheader'>{t`Email`}</HeadCell>
						<HeadCell role='columnheader'>{t`Status`}</HeadCell>
						<HeadCell role='columnheader'>{t`What it's for`}</HeadCell>
						<HeadCell role='columnheader'>{t`Primary`}</HeadCell>
						<HeadCell role='columnheader'>{t`Added`}</HeadCell>
						<HeadCell role='columnheader' aria-label={t`Actions`}>
							{' '}
						</HeadCell>
					</TableHead>
					{rows.map(row => {
						const providerName = providerNameFor(presets, row.imapHost)
						const appPwUrl = authPasswordUrlFor(presets, row.imapHost)
						// Only mailboxes still in use are listed, so what shows here
						// is how the last sign-in went and nothing else.
						const statusTone: StatusTone = row.grantStatus
						const statusLabel =
							row.grantStatus === 'connected'
								? t`Connected`
								: row.grantStatus === 'auth_failed'
									? t`Couldn't sign in`
									: row.grantStatus === 'connect_failed'
										? t`Couldn't connect`
										: t`Not syncing`
						return (
							<TableRow key={row.id} role='row' $inactive={!row.active}>
								<CellEmail role='cell'>
									<EmailAddress>{row.email}</EmailAddress>
									<EmailMeta>
										{row.displayName !== null && row.displayName !== '' ? (
											<DisplayName>{row.displayName}</DisplayName>
										) : null}
										{providerName !== '' && (
											<ProviderName
												title={`IMAP ${row.imapHost}:${row.imapPort}`}
											>
												{providerName}
											</ProviderName>
										)}
										{row.isPrivate && (
											<PrivacyTag aria-label={t`Private inbox`}>
												{t`Private`}
											</PrivacyTag>
										)}
									</EmailMeta>
								</CellEmail>
								<CellStatus role='cell'>
									<MobileCaption>{t`Status`}</MobileCaption>
									<StatusBadge $status={statusTone}>{statusLabel}</StatusBadge>
									{row.active && row.grantStatus === 'auth_failed' && (
										<AuthHint>
											{row.imapHost === 'mail.infomaniak.com'
												? t`Infomaniak needs a Mail app password created in your Mail service — not an account application password.`
												: t`Use your email provider's app-specific password — not your normal login password.`}
											{appPwUrl !== '' && (
												<>
													{' '}
													<PresetLink
														href={appPwUrl}
														aria-label={t`Create an app password for ${row.email}, opens in a new tab`}
														target='_blank'
														rel='noreferrer noopener'
													>
														{t`Create an app password →`}
													</PresetLink>
												</>
											)}
										</AuthHint>
									)}
									{row.grantLastError !== null && row.grantLastError !== '' && (
										<TechDetails>
											<summary>{t`Technical details`}</summary>
											<code>{row.grantLastError}</code>
										</TechDetails>
									)}
								</CellStatus>
								<CellPurpose role='cell'>
									<MobileCaption>{t`What it's for`}</MobileCaption>
									{row.ownerUserId === null ? (
										<TeamTag>{t`Shared with the team`}</TeamTag>
									) : !isMine(row) ? (
										// A colleague's mailbox otherwise looks like your own
										// here, told apart only by a control the row leaves out.
										<SrOnly>{t`Belongs to another member`}</SrOnly>
									) : null}
									{row.description !== null && row.description !== '' ? (
										<DescriptionText>{row.description}</DescriptionText>
									) : row.ownerUserId !== null ? (
										<Muted>
											<SrOnly>{t`No description`}</SrOnly>
											<span aria-hidden>—</span>
										</Muted>
									) : null}
								</CellPurpose>
								<CellDefault role='cell'>
									<MobileCaption>{t`Primary`}</MobileCaption>
									{/* One button either way for the caller's own mailboxes,
									    marked pressed once chosen. Swapping it for plain text
									    on success would unmount the button under the finger
									    that just pressed it, dropping focus to the top of the
									    page, and the change would go unannounced. */}
									{isMine(row) ? (
										<PrimaryToggle
											type='button'
											$active={row.isDefault}
											aria-pressed={row.isDefault}
											onClick={() => {
												void setDefault(row)
											}}
											aria-label={
												row.isDefault
													? t`${row.email} is the address you send from`
													: t`Make ${row.email} the address you send from`
											}
										>
											<Star
												size={row.isDefault ? 12 : 14}
												aria-hidden
												fill={row.isDefault ? 'currentColor' : 'none'}
											/>
											{row.isDefault ? <span>{t`Primary`}</span> : null}
										</PrimaryToggle>
									) : row.isDefault ? (
										<PrimaryLabel>
											<Star size={12} aria-hidden fill='currentColor' />
											{t`Primary`}
										</PrimaryLabel>
									) : (
										// Nothing to offer on anyone else's. The dash alone is
										// punctuation a screen reader may pass over.
										<Muted>
											<SrOnly>{t`Not yours to set`}</SrOnly>
											<span aria-hidden>—</span>
										</Muted>
									)}
								</CellDefault>
								<CellDate role='cell'>
									<MobileCaption>{t`Added`}</MobileCaption>
									{row.createdAt !== null ? (
										<RelativeDate value={row.createdAt} />
									) : (
										<Muted>
											<SrOnly>{t`Not recorded`}</SrOnly>
											<span aria-hidden>—</span>
										</Muted>
									)}
								</CellDate>
								<CellActions role='cell'>
									{/* Nothing to offer on a mailbox this person cannot
									    change — the server would turn every one of these
									    down anyway. */}
									{canLookAfter(row) ? (
										<PriTooltip.Provider delay={300}>
											<ActionButton
												icon={RefreshCw}
												label={t`Test connection`}
												onClick={() => {
													void handleTest(row)
												}}
											/>
											<ActionButton
												icon={FileText}
												label={t`Email signature`}
												onClick={() => openFooters(row)}
											/>
											<ActionButton
												icon={Pencil}
												label={t`Edit settings`}
												onClick={() => openEdit(row)}
											/>
											<ActionButton
												icon={Trash2}
												label={t`Remove`}
												onClick={() => {
													void handleDelete(row)
												}}
											/>
										</PriTooltip.Provider>
									) : null}
								</CellActions>
							</TableRow>
						)
					})}
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

// Whoever runs the organization looks after everyone's mailboxes; everyone
// else only their own.
function useCanManageOthers(): boolean {
	const role = authClient.useActiveMember().data?.role ?? null
	return role === 'owner' || role === 'admin'
}

// The signed-in member, so the list can tell their own mailboxes from the
// team's and from colleagues'.
function useMeUserId(): string | undefined {
	return authClient.useSession().data?.user?.id
}

// Until we know who is asking every mailbox looks like somebody else's, so
// the rows would fill in after paint — moving what a person can tab to.
function useIdentityPending(): boolean {
	const member = authClient.useActiveMember()
	const session = authClient.useSession()
	return member.isPending === true || session.isPending === true
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
	readonly description?: string
	readonly shared?: boolean
	readonly ownerUserId?: string
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
	readonly description?: string | null
	readonly ownerUserId?: string | null
	readonly isPrivate?: boolean
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
		description: row.description ?? '',
		shared: row.ownerUserId === null,
		ownerUserId: row.ownerUserId ?? '',
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
	// Setting a mailbox up for the team, or in somebody else's name, is for
	// whoever runs the organization — so nobody else is shown the controls.
	const canManageOthers = useCanManageOthers()

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

	// IMAP/SMTP host/port hide inside a collapsible "Advanced settings" section
	// so the common path is just provider + email + password. A chosen preset
	// with no host (Generic / Other) forces it open, since the user must type
	// the servers; before any provider is picked it stays collapsed.
	const [showAdvanced, setShowAdvanced] = useState(editing !== null)
	const needsManualHosts =
		selectedPreset !== null &&
		(draft.imapHost.trim() === '' || draft.smtpHost.trim() === '')
	const advancedOpen = showAdvanced || needsManualHosts

	// On a new mailbox, an empty login name means the address itself: that is
	// what nearly every provider signs in with.
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
						description: draft.description === '' ? null : draft.description,
						// Blank means "leave it as it is", never "give it to the team":
						// handing a mailbox over is always typed on purpose.
						...(draft.shared
							? { ownerUserId: null }
							: draft.ownerUserId !== '' && { ownerUserId: draft.ownerUserId }),
						// A mailbox belonging to everyone cannot be hidden from them.
						// Decided here rather than by clearing the box, so somebody who
						// ticks "shared" and changes their mind still finds their
						// privacy answer where they left it.
						isPrivate: draft.shared ? false : draft.isPrivate,
						imapHost: draft.imapHost,
						imapPort: draft.imapPort,
						imapSecurity: draft.imapSecurity,
						smtpHost: draft.smtpHost,
						smtpPort: draft.smtpPort,
						smtpSecurity: draft.smtpSecurity,
						// On an edit, an empty login name means nothing to change, so a
						// mailbox that signs in under a different address keeps the one
						// it has.
						...(draft.username !== '' && { username: draft.username }),
						...(changeCredentials && password !== '' && { password }),
					})
				: await onCreate({
						email: draft.email,
						...(draft.displayName !== '' && { displayName: draft.displayName }),
						...(draft.description !== '' && {
							description: draft.description,
						}),
						...(draft.shared && { shared: true }),
						...(!draft.shared &&
							draft.ownerUserId !== '' && { ownerUserId: draft.ownerUserId }),
						...(!draft.shared && draft.isPrivate && { isPrivate: true }),
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
								<Label>{t`Who's your email provider?`}</Label>
								<PriSelect.Root
									value={presetName}
									onValueChange={value => {
										if (value !== null) applyPreset(value)
									}}
								>
									<PriSelect.Trigger
										aria-label={t`Who's your email provider?`}
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
								<Hint>{t`I'll fill in the technical settings for you — you just add your email and password.`}</Hint>
								{selectedPreset !== null &&
									(providerUnsupported ? (
										<Warning role='alert' id='ix-provider-warning'>
											{t`${selectedPreset.name} no longer allows password sign-in for mail apps, so it can't be connected here yet — it needs an OAuth sign-in. Pick another provider or use Generic IMAP.`}
										</Warning>
									) : (
										<Hint id='ix-provider-2fa-hint'>
											{selectedPreset.imapHost === 'mail.infomaniak.com'
												? t`Infomaniak needs a Mail app password created in your Mail service — not an account application password, and not your normal login password.`
												: t`If your account has two-factor authentication, use an app-specific password — not your normal login password.`}
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

						{needsManualHosts ? (
							<Hint>{t`Enter your mail server settings below.`}</Hint>
						) : (
							<AdvancedToggle
								type='button'
								onClick={() => setShowAdvanced(v => !v)}
								aria-expanded={advancedOpen}
							>
								{advancedOpen
									? t`Hide advanced settings`
									: t`Advanced settings (IMAP / SMTP)`}
							</AdvancedToggle>
						)}
						{advancedOpen && (
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
											patchDraft({
												imapPort: parseInt(e.target.value, 10) || 0,
											})
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
											patchDraft({
												smtpPort: parseInt(e.target.value, 10) || 0,
											})
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
						)}

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
							<Label htmlFor='ix-description'>{t`What's this mailbox for?`}</Label>
							<PriInput
								id='ix-description'
								type='text'
								value={draft.description}
								maxLength={200}
								aria-describedby='ix-description-hint'
								onChange={e => patchDraft({ description: e.target.value })}
								placeholder={t`e.g. Customer enquiries`}
							/>
							{/* The limit is spelled out because the field itself just
							    stops taking more, without saying why. */}
							<Hint id='ix-description-hint'>{t`Just a note to yourself — it changes nothing about how the mailbox works. Up to 200 characters.`}</Hint>
						</Field>

						{canManageOthers && (
							<CheckboxRow>
								<input
									id='ix-shared'
									type='checkbox'
									checked={draft.shared}
									aria-controls='ix-ownership-options'
									aria-expanded={!draft.shared}
									onChange={e => patchDraft({ shared: e.target.checked })}
								/>
								<label htmlFor='ix-shared'>
									{t`Shared with the whole team — no single owner`}
								</label>
							</CheckboxRow>
						)}

						{/* Ticking the box takes two questions off the form, which is a
						    change somebody not looking at it would otherwise miss. Both
						    answers are kept as typed, so changing one's mind puts them
						    back; only the submit decides what a team mailbox sends. */}
						<div id='ix-ownership-options'>
							{canManageOthers && !draft.shared && (
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

							{!draft.shared && (
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
						</div>
						<SrOnly role='status' aria-live='polite'>
							{draft.shared
								? t`Owner and privacy hidden — a team mailbox has no owner and cannot be private`
								: ''}
						</SrOnly>

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

// Friendly provider name ("Infomaniak") for an inbox's IMAP host so the list
// shows a recognisable label instead of a raw server hostname. Falls back to
// the host itself for mailboxes that don't match a known preset.
function providerNameFor(
	presets: ReadonlyArray<ProviderPreset>,
	imapHost: string,
): string {
	if (imapHost === '') return ''
	const preset = presets.find(p => p.imapHost === imapHost)
	return preset?.name ?? imapHost
}

// One row action: an icon button that shows its label as a tooltip on
// pointer/keyboard, and as inline text on small screens where tooltips never
// open on tap. The caller passes an already-translated label.
function ActionButton({
	icon: Icon,
	label,
	onClick,
}: {
	icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>
	label: string
	onClick: () => void
}) {
	return (
		<PriTooltip.Root>
			<PriTooltip.Trigger
				render={
					<IconAction type='button' onClick={onClick} aria-label={label}>
						<Icon size={14} aria-hidden />
						<ActionLabel>{label}</ActionLabel>
					</IconAction>
				}
			/>
			<PriTooltip.Portal>
				<PriTooltip.Positioner side='top' sideOffset={6}>
					<PriTooltip.Popup>{label}</PriTooltip.Popup>
				</PriTooltip.Positioner>
			</PriTooltip.Portal>
		</PriTooltip.Root>
	)
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
		typeof v === 'string'
			? v
			: v instanceof Date
				? v.toISOString()
				: DateTime.isDateTime(v)
					? DateTime.formatIso(v)
					: null
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		if (typeof r['email'] !== 'string') continue
		out.push({
			id: r['id'],
			email: r['email'],
			displayName:
				typeof r['displayName'] === 'string' ? r['displayName'] : null,
			description:
				typeof r['description'] === 'string' ? r['description'] : null,
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

const Page = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`

const Intro = styled.div`
	display: grid;
	gap: var(--space-md);
	align-items: end;

	@media (min-width: 768px) {
		grid-template-columns: 1fr auto;
	}
`

const IntroText = styled.div`
	${rulerUnderRule}
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	padding-bottom: var(--space-xs);
`

const IntroActions = styled.div`
	display: flex;
	gap: var(--space-xs);
	flex-wrap: wrap;
	justify-self: start;

	@media (min-width: 768px) {
		justify-self: end;
	}
`

const BackLink = styled.div`
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

const Title = styled.h2`
	${stenciledTitle}
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
	margin: 0;
`

const Subtitle = styled.p`
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	font-style: italic;
	color: var(--color-on-surface-variant);
	margin: 0;
`

const InboxesTable = styled.div`
	display: flex;
	flex-direction: column;
	border: 1px solid var(--color-ledger-line);
	border-radius: var(--shape-2xs);
	overflow: hidden;
	background: var(--color-paper-aged);
`

// Columns: email · status · what-it's-for · primary · added · actions.
// The description column flexes rather than sitting at a fixed width, since
// what someone writes there runs to a line rather than a single word.
const gridTemplate = css`
	display: grid;
	grid-template-columns:
		minmax(0, 2fr)
		minmax(8rem, 0.9fr)
		minmax(7rem, 1.2fr)
		6rem
		minmax(0, 0.8fr)
		auto;
	align-items: center;
	gap: var(--space-sm);
	padding: var(--space-sm) var(--space-md);
`

// On small screens the header row is hidden, so each value cell carries its
// own column name as a caption above the value. Real text (not CSS generated
// content) so a screen reader reads it as part of the cell.
const MobileCaption = styled.span`
	display: none;

	@media (max-width: 767px) {
		display: block;
		margin-bottom: var(--space-3xs);
		font-family: var(--font-display);
		font-size: var(--typescale-label-small-size);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-on-surface-variant);
	}
`

const TableHead = styled.div`
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
	border-bottom: 1px solid var(--color-metal-edge);

	@media (max-width: 767px) {
		display: none;
	}
`

const HeadCell = styled.div``

const TableRow = styled.div<{ $inactive: boolean }>`
	${gridTemplate}
	${agedPaperRow}
	border-bottom: 1px solid var(--color-ledger-line);
	opacity: ${p => (p.$inactive ? 0.6 : 1)};

	&:last-child {
		border-bottom: none;
	}

	@media (max-width: 767px) {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-sm);
	}
`

const CellEmail = styled.div`
	display: flex;
	flex-direction: column;
	min-width: 0;
`

const EmailAddress = styled.span`
	font-family: var(--font-body);
	font-weight: var(--font-weight-medium);
	color: var(--color-on-surface);
	overflow-wrap: anywhere;
`

const DisplayName = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const CellPurpose = styled.div`
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--space-3xs);
	min-width: 0;
`

const CellStatus = styled.div`
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--space-3xs);
`

const EmailMeta = styled.div`
	display: flex;
	align-items: center;
	gap: var(--space-2xs);
	flex-wrap: wrap;
	min-width: 0;
`

const ProviderName = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const PrivacyTag = styled.span`
	display: inline-flex;
	padding: 1px var(--space-2xs);
	border-radius: var(--shape-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	background: color-mix(in oklab, var(--color-on-surface-variant) 10%, transparent);
	color: var(--color-on-surface);
	border: 1px solid color-mix(in oklab, var(--color-on-surface-variant) 35%, transparent);
`

const StatusBadge = styled.span<{ $status: StatusTone }>`
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
		p.$status === 'connected'
			? css`
					background: color-mix(in oklab, var(--color-secondary) 14%, transparent);
					color: var(--color-on-secondary-container);
					border: 1px solid color-mix(in oklab, var(--color-secondary) 40%, transparent);
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
							background: color-mix(in oklab, var(--color-warning) 18%, transparent);
							color: color-mix(in oklab, var(--color-warning-strong) 80%, black);
							border: 1px solid color-mix(in oklab, var(--color-warning) 45%, transparent);
						`
					: css`
							background: transparent;
							color: var(--color-on-surface-variant);
							border: 1px dashed var(--color-outline);
						`}
`

const PrimaryBanner = styled.div`
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

const PrimaryBannerText = styled.p`
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

const PrimaryBannerActions = styled.div`
	display: flex;
	gap: var(--space-xs);
`

const TransportGrid = styled.div`
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: var(--space-sm);

	@media (max-width: 640px) {
		grid-template-columns: 1fr;
	}
`

const Hint = styled.p`
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
	font-style: italic;
`

const PresetLink = styled.a`
	color: var(--color-primary);
	font-style: normal;
	text-decoration: underline;
`

const Warning = styled.p`
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	color: var(--color-error);
`

const AdvancedToggle = styled.button`
	align-self: flex-start;
	background: none;
	border: none;
	padding: 0;
	cursor: pointer;
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-primary);
	text-decoration: underline;

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const AuthHint = styled.p`
	margin: var(--space-2xs) 0 0;
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
`

const CellDefault = styled.div``
const CellDate = styled.div`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
`
const CellActions = styled.div`
	display: flex;
	justify-content: flex-end;
	gap: var(--space-3xs);

	@media (max-width: 767px) {
		flex-direction: column;
		align-items: stretch;
		justify-content: flex-start;
		gap: var(--space-2xs);
	}
`

const PrimaryLabel = styled.span`
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
	color: var(--color-primary);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
`

const TechDetails = styled.details`
	margin-top: var(--space-3xs);

	> summary {
		cursor: pointer;
		font-family: var(--font-body);
		font-size: var(--typescale-label-small-size);
		color: var(--color-on-surface-variant);
	}

	> code {
		display: block;
		margin-top: var(--space-3xs);
		font-family: var(--font-mono, monospace);
		font-size: var(--typescale-label-small-size);
		color: var(--color-on-surface-variant);
		overflow-wrap: anywhere;
	}
`

// Marks the mailboxes that belong to everyone rather than to one person —
// the one thing about a mailbox still worth saying at a glance.
const TeamTag = styled.span`
	display: inline-flex;
	align-items: center;
	padding: 2px var(--space-2xs);
	border-radius: var(--shape-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	background: transparent;
	color: var(--color-on-surface-variant);
	border: 1px dashed var(--color-outline);
`

const DescriptionText = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
	/* Free text somebody types, so a single long word (a pasted address)
	   must wrap rather than widen the column past its share. */
	overflow-wrap: anywhere;
`

const IconToggle = styled.button<{ $active: boolean }>`
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

// The same control before and after choosing, so pressing it never pulls the
// focused element out from under the person who pressed it. Widens to carry
// the word once chosen, matching the plain label shown on other people's rows.
const PrimaryToggle = styled(IconToggle)`
	gap: var(--space-3xs);
	width: auto;
	min-width: 1.75rem;
	padding: 0 ${p => (p.$active ? 'var(--space-2xs)' : '0')};
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
`

const IconAction = styled.button`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.75rem;
	height: 1.75rem;
	padding: 0;
	background: transparent;
	border: 1px solid var(--color-outline);
	border-radius: var(--shape-2xs);
	color: var(--color-on-surface-variant);
	cursor: pointer;
	transition:
		color 160ms ease,
		border-color 160ms ease;

	&:hover:not(:disabled) {
		color: var(--color-primary);
		border-color: var(--color-primary);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}

	/* On small screens the button carries a visible text label, so it grows
	   to fit and left-aligns instead of staying an icon-only square. */
	@media (max-width: 767px) {
		width: auto;
		height: auto;
		justify-content: flex-start;
		gap: var(--space-2xs);
		padding: var(--space-2xs) var(--space-sm);
	}
`

const ActionLabel = styled.span`
	display: none;

	@media (max-width: 767px) {
		display: inline;
		font-family: var(--font-body);
		font-size: var(--typescale-label-medium-size);
	}
`

// Italic and the variant tone already read as de-emphasised. Fading it further
// dropped the text under the contrast floor on paper, where most people read
// it, so the tone carries it alone.
const Muted = styled.span`
	color: var(--color-on-surface-variant);
	font-style: italic;
`

const EmptyHelp = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	align-items: flex-start;
	text-align: left;

	> p {
		margin: 0;
	}

	> ol {
		margin: 0;
		padding-left: var(--space-md);
		display: flex;
		flex-direction: column;
		gap: var(--space-2xs);
	}

	> ol > li {
		font-style: normal;
	}
`

const DialogHeader = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	margin-bottom: var(--space-md);
`

const CloseButton = styled.button`
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

const Form = styled.form`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
`

const Field = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const Label = styled.label`
	${stenciledTitle}
	font-size: var(--typescale-label-small-size);
`

const CheckboxRow = styled.div`
	display: flex;
	align-items: center;
	gap: var(--space-xs);
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
`

const ErrorText = styled.p`
	margin: 0;
	padding: var(--space-2xs) var(--space-sm);
	border-left: 3px solid var(--color-error);
	background: color-mix(in srgb, var(--color-error) 6%, transparent);
	color: var(--color-error);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	font-style: italic;
`

const Footer = styled.div`
	${rulerUnderRule}
	display: flex;
	justify-content: flex-end;
	gap: var(--space-sm);
	padding-top: var(--space-sm);
	background-position: left top;
`

// ── Footer dialog styles ────────────────────────────────────────

const FooterListView = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
`

const FooterTable = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
`

const FooterItem = styled.div`
	${agedPaperRow}
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	padding: var(--space-sm) var(--space-md);
	border: 1px solid var(--color-ledger-line);
	border-radius: var(--shape-2xs);
`

const FooterName = styled.div`
	display: flex;
	align-items: center;
	gap: var(--space-xs);
	font-family: var(--font-body);
	font-weight: var(--font-weight-medium);
	min-width: 0;
`

const DefaultTag = styled.span`
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

const FooterActions = styled.div`
	display: flex;
	gap: var(--space-3xs);
	flex: 0 0 auto;
`

const FooterDialogFooter = styled.div`
	display: flex;
	justify-content: flex-start;
`

const FooterEditorWrap = styled.div`
	min-height: 120px;
	border: 1px solid var(--color-ledger-line);
	border-radius: var(--shape-2xs);
	padding: var(--space-2xs);
`
