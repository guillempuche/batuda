import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { useLingui } from '@lingui/react/macro'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import {
	Check,
	ChevronLeft,
	FileText,
	Inbox as InboxIcon,
	Pencil,
	Plus,
	Star,
	Trash2,
	X,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
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
	footersAtomFor,
	inboxesListAtom,
	updateFooterAtom,
	updateInboxAtom,
} from '#/atoms/emails-atoms'
import { EmptyState } from '#/components/shared/empty-state'
import { RelativeDate } from '#/components/shared/relative-date'
import { SkeletonRows } from '#/components/shared/skeleton-row'
import { dehydrateAtom } from '#/lib/atom-hydration'
import { getServerCookieHeader } from '#/lib/server-cookie'
import {
	agedPaperRow,
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

type InboxPurpose = 'human' | 'agent' | 'shared'

type InboxRow = {
	readonly id: string
	readonly providerInboxId: string
	readonly email: string
	readonly displayName: string | null
	readonly purpose: InboxPurpose
	readonly ownerUserId: string | null
	readonly isDefault: boolean
	readonly active: boolean
	readonly createdAt: string | null
	readonly updatedAt: string | null
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

export const Route = createFileRoute('/emails/inboxes')({
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
	component: InboxesPage,
})

type DialogMode =
	| { readonly kind: 'closed' }
	| { readonly kind: 'create' }
	| { readonly kind: 'edit'; readonly row: InboxRow }
	| { readonly kind: 'footers'; readonly row: InboxRow }

function InboxesPage() {
	const { t } = useLingui()
	const toastManager = usePriToast()
	const inboxesResult = useAtomValue(inboxesListAtom)
	const refreshInboxes = useAtomRefresh(inboxesListAtom)

	const createInbox = useAtomSet(createInboxAtom, { mode: 'promiseExit' })
	const updateInbox = useAtomSet(updateInboxAtom, { mode: 'promiseExit' })

	const [dialog, setDialog] = useState<DialogMode>({ kind: 'closed' })

	const rows = useMemo<ReadonlyArray<InboxRow>>(
		() =>
			AsyncResult.isSuccess(inboxesResult)
				? narrowInboxRows(inboxesResult.value)
				: [],
		[inboxesResult],
	)
	const isLoading = AsyncResult.isInitial(inboxesResult)
	const isFailure = AsyncResult.isFailure(inboxesResult)

	const openCreate = useCallback(() => {
		setDialog({ kind: 'create' })
	}, [])
	const openEdit = useCallback((row: InboxRow) => {
		setDialog({ kind: 'edit', row })
	}, [])
	const openFooters = useCallback((row: InboxRow) => {
		setDialog({ kind: 'footers', row })
	}, [])
	const closeDialog = useCallback(() => {
		setDialog({ kind: 'closed' })
	}, [])

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
		},
		[updateInbox, refreshInboxes, toastManager, t],
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
					<Subtitle>{t`Map provider mailboxes to purpose, owner, and defaults.`}</Subtitle>
				</IntroText>
				<IntroActions>
					<PriButton type='button' $variant='filled' onClick={openCreate}>
						<Plus size={14} aria-hidden />
						<span>{t`Create inbox`}</span>
					</PriButton>
				</IntroActions>
			</Intro>

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
						<PriButton type='button' $variant='filled' onClick={openCreate}>
							<Plus size={14} aria-hidden />
							<span>{t`Create inbox`}</span>
						</PriButton>
					}
				/>
			) : (
				<InboxesTable role='table' aria-label={t`Local inboxes`}>
					<TableHead role='row'>
						<HeadCell role='columnheader'>{t`Email`}</HeadCell>
						<HeadCell role='columnheader'>{t`Purpose`}</HeadCell>
						<HeadCell role='columnheader'>{t`Owner`}</HeadCell>
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
								{row.displayName !== null && row.displayName !== '' && (
									<DisplayName>{row.displayName}</DisplayName>
								)}
							</CellEmail>
							<CellPurpose role='cell'>
								<PurposeBadge $purpose={row.purpose}>
									{row.purpose === 'human'
										? t`Human`
										: row.purpose === 'agent'
											? t`Agent`
											: t`Shared`}
								</PurposeBadge>
							</CellPurpose>
							<CellOwner role='cell'>
								{row.ownerUserId !== null && row.ownerUserId !== '' ? (
									<OwnerId title={row.ownerUserId}>
										{row.ownerUserId.slice(0, 8)}…
									</OwnerId>
								) : (
									<Muted>—</Muted>
								)}
							</CellOwner>
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
							</CellActions>
						</TableRow>
					))}
				</InboxesTable>
			)}

			{(dialog.kind === 'create' || dialog.kind === 'edit') && (
				<InboxFormDialog
					mode={dialog}
					onClose={closeDialog}
					onCreate={async input => {
						const exit = await createInbox({ payload: input } as never)
						if (exit._tag !== 'Success') {
							return {
								ok: false,
								error: t`Could not create the inbox.`,
							}
						}
						refreshInboxes()
						toastManager.add({
							title: t`Inbox created`,
							description: t`The new inbox is ready.`,
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
						toastManager.add({
							title: t`Inbox updated`,
							type: 'success',
						})
						return { ok: true }
					}}
				/>
			)}

			{dialog.kind === 'footers' && (
				<FooterManageDialog row={dialog.row} onClose={closeDialog} />
			)}
		</Page>
	)
}

// ── Dialog ───────────────────────────────────────────────────────

type MutationResult =
	| { readonly ok: true }
	| { readonly ok: false; readonly error: string }

function InboxFormDialog({
	mode,
	onClose,
	onCreate,
	onUpdate,
}: {
	readonly mode: DialogMode
	readonly onClose: () => void
	readonly onCreate: (input: {
		readonly username?: string
		readonly domain?: string
		readonly displayName?: string
		readonly purpose: InboxPurpose
		readonly ownerUserId?: string
		readonly isDefault?: boolean
	}) => Promise<MutationResult>
	readonly onUpdate: (
		id: string,
		patch: {
			readonly displayName?: string | null
			readonly purpose?: InboxPurpose
			readonly ownerUserId?: string | null
			readonly isDefault?: boolean
			readonly active?: boolean
		},
	) => Promise<MutationResult>
}) {
	const { t } = useLingui()
	const editing = mode.kind === 'edit' ? mode.row : null

	const [username, setUsername] = useState('')
	const [domain, setDomain] = useState('')
	const [displayName, setDisplayName] = useState(editing?.displayName ?? '')
	const [purpose, setPurpose] = useState<InboxPurpose>(
		editing?.purpose ?? 'human',
	)
	const [ownerUserId, setOwnerUserId] = useState(editing?.ownerUserId ?? '')
	const [isDefault, setIsDefault] = useState(editing?.isDefault ?? false)
	const [submitting, setSubmitting] = useState(false)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)

	const previewEmail =
		username !== '' && domain !== ''
			? `${username}@${domain}`
			: username !== ''
				? `${username}@…`
				: t`(provider assigns)`

	const canSubmit = !submitting && (editing !== null || purpose !== undefined)

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!canSubmit) return
		setSubmitting(true)
		setErrorMessage(null)

		const result =
			editing !== null
				? await onUpdate(editing.id, {
						displayName: displayName === '' ? null : displayName,
						purpose,
						ownerUserId:
							purpose === 'human' && ownerUserId !== '' ? ownerUserId : null,
						isDefault,
					})
				: await onCreate({
						...(username !== '' && { username }),
						...(domain !== '' && { domain }),
						...(displayName !== '' && { displayName }),
						purpose,
						...(purpose === 'human' && ownerUserId !== '' && { ownerUserId }),
						...(isDefault && { isDefault: true }),
					})

		if (result.ok) {
			onClose()
			return
		}
		setErrorMessage(result.error)
		setSubmitting(false)
	}

	return (
		<PriDialog.Root
			open={mode.kind !== 'closed'}
			onOpenChange={(next: boolean) => {
				if (!next) onClose()
			}}
		>
			<PriDialog.Portal>
				<PriDialog.Backdrop />
				<PriDialog.Popup>
					<DialogHeader>
						<PriDialog.Title>
							{editing !== null ? t`Edit inbox` : t`Create inbox`}
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
						{editing === null && (
							<>
								<Field>
									<Label htmlFor='ix-username'>{t`Username`}</Label>
									<PriInput
										id='ix-username'
										type='text'
										value={username}
										onChange={e => setUsername(e.target.value)}
										placeholder={t`e.g. hola`}
									/>
								</Field>
								<Field>
									<Label htmlFor='ix-domain'>{t`Domain`}</Label>
									<PriInput
										id='ix-domain'
										type='text'
										value={domain}
										onChange={e => setDomain(e.target.value)}
										placeholder={t`e.g. taller.cat`}
									/>
								</Field>
								<PreviewLine aria-live='polite'>
									{t`Address:`} <strong>{previewEmail}</strong>
								</PreviewLine>
							</>
						)}

						<Field>
							<Label htmlFor='ix-display'>{t`Display name`}</Label>
							<PriInput
								id='ix-display'
								type='text'
								value={displayName}
								onChange={e => setDisplayName(e.target.value)}
								placeholder={t`e.g. Hola — Taller`}
							/>
						</Field>

						<Field>
							<Label>{t`Purpose`}</Label>
							<PriSelect.Root
								value={purpose}
								onValueChange={value => {
									if (
										value === 'human' ||
										value === 'agent' ||
										value === 'shared'
									) {
										setPurpose(value)
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

						{purpose === 'human' && (
							<Field>
								<Label htmlFor='ix-owner'>{t`Owner user ID`}</Label>
								<PriInput
									id='ix-owner'
									type='text'
									value={ownerUserId}
									onChange={e => setOwnerUserId(e.target.value)}
									placeholder={t`UUID (optional)`}
								/>
							</Field>
						)}

						<CheckboxRow>
							<input
								id='ix-default'
								type='checkbox'
								checked={isDefault}
								onChange={e => setIsDefault(e.target.checked)}
							/>
							<label htmlFor='ix-default'>{t`Use as default for this purpose`}</label>
						</CheckboxRow>

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
							<PriButton type='submit' $variant='filled' disabled={!canSubmit}>
								{submitting
									? t`Saving…`
									: editing !== null
										? t`Save`
										: t`Create`}
							</PriButton>
						</Footer>
					</Form>
				</PriDialog.Popup>
			</PriDialog.Portal>
		</PriDialog.Root>
	)
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
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const r = row as Record<string, unknown>
		if (typeof r['id'] !== 'string') continue
		if (typeof r['providerInboxId'] !== 'string') continue
		if (typeof r['email'] !== 'string') continue
		const purpose = r['purpose']
		if (purpose !== 'human' && purpose !== 'agent' && purpose !== 'shared') {
			continue
		}
		out.push({
			id: r['id'],
			providerInboxId: r['providerInboxId'],
			email: r['email'],
			displayName:
				typeof r['displayName'] === 'string' ? r['displayName'] : null,
			purpose,
			ownerUserId:
				typeof r['ownerUserId'] === 'string' ? r['ownerUserId'] : null,
			isDefault: r['isDefault'] === true,
			active: r['active'] !== false,
			createdAt: typeof r['createdAt'] === 'string' ? r['createdAt'] : null,
			updatedAt: typeof r['updatedAt'] === 'string' ? r['updatedAt'] : null,
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
		6rem
		8rem
		4rem
		4rem
		minmax(0, 1fr)
		5rem;
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

const CellOwner = styled.div.withConfig({ displayName: 'InboxesCellOwner' })`
	min-width: 0;
`

const OwnerId = styled.span.withConfig({ displayName: 'InboxesOwnerId' })`
	font-family: var(--font-mono, monospace);
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

const PreviewLine = styled.p.withConfig({
	displayName: 'InboxFormPreview',
})`
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-label-medium-size);
	color: var(--color-on-surface-variant);

	strong {
		font-family: var(--font-mono, monospace);
		color: var(--color-on-surface);
	}
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
