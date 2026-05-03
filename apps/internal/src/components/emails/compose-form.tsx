import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { useLingui } from '@lingui/react/macro'
import { AsyncResult } from 'effect/unstable/reactivity'
import { AlertTriangle, Plus, Send, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

import { EmailEditor } from '@batuda/email/editor'
import type { EmailBlocks } from '@batuda/email/schema'
import { PriButton, PriInput, PriSelect } from '@batuda/ui/pri'

import { contactsAtomFor } from '#/atoms/company-atoms'
import {
	createDraftAtom,
	deleteDraftAtom,
	emailsSearchAtom,
	inboxesListAtom,
	sendDraftAtom,
	threadAtomFor,
	updateDraftAtom,
} from '#/atoms/emails-atoms'
import { AttachmentPicker } from '#/components/emails/attachment-picker'
import { type Draft, useComposeEmail } from '#/context/compose-email-context'
import type { StagedAttachment } from '#/lib/email-attachments'

type InboxOption = {
	readonly id: string
	readonly email: string
	readonly displayName: string | null
	readonly purpose: 'human' | 'agent' | 'shared'
	readonly isDefault: boolean
	readonly active: boolean
}

type DraftForm = {
	inboxId: string | null
	to: string
	cc: string
	bcc: string
	subject: string
	bodyJson: EmailBlocks
	bodyText: string
	attachments: ReadonlyArray<StagedAttachment>
}

type SendState = 'idle' | 'sending' | 'error'

type SuppressedAddress = {
	readonly email: string
	readonly name: string
	readonly reason: 'bounced' | 'complained'
}

const SAVE_DEBOUNCE_MS = 300

export function ComposeForm({ draft }: { readonly draft: Draft }) {
	const { t } = useLingui()
	const { close, updateMeta } = useComposeEmail()
	const inboxesResult = useAtomValue(inboxesListAtom)

	const createDraft = useAtomSet(createDraftAtom, { mode: 'promiseExit' })
	const updateDraft = useAtomSet(updateDraftAtom, { mode: 'promiseExit' })
	const deleteDraft = useAtomSet(deleteDraftAtom, { mode: 'promiseExit' })
	const sendDraft = useAtomSet(sendDraftAtom, { mode: 'promiseExit' })
	const refreshList = useAtomRefresh(emailsSearchAtom({}))
	const refreshThread = useAtomRefresh(
		threadAtomFor(draft.threadId ?? '__unused__'),
	)

	const inboxes = useMemo<ReadonlyArray<InboxOption>>(
		() =>
			AsyncResult.isSuccess(inboxesResult)
				? narrowInboxes(inboxesResult.value)
				: [],
		[inboxesResult],
	)

	const defaultInboxId = useMemo(
		() =>
			(
				inboxes.find(i => i.purpose === 'human' && i.isDefault && i.active) ??
				inboxes.find(i => i.purpose === 'human' && i.active)
			)?.id ?? null,
		[inboxes],
	)

	const [form, setForm] = useState<DraftForm>(() => ({
		inboxId: draft.inboxId || null,
		to: draft.to,
		cc: '',
		bcc: '',
		subject: draft.subject,
		bodyJson: draft.bodyJson ?? [],
		bodyText: '',
		attachments: [],
	}))

	const effectiveInboxId = form.inboxId ?? defaultInboxId

	// `serverId` is mirrored from the ref into state so `canSend`'s
	// useMemo re-runs when createDraft resolves -- refs aren't dep-
	// tracked. The ref stays as the synchronous source of truth for
	// debouncedSave + handleSend, which run inside callbacks that
	// don't need React to re-render to read it.
	const [serverId, setServerId] = useState<string | null>(draft.serverId)
	const serverIdRef = useRef<string | null>(draft.serverId)
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const mountedRef = useRef(true)
	// Sentinel against StrictMode's double useEffect invocation. The
	// createDraftAtom is module-scoped (one mutation atom shared by
	// every ComposeForm), so a second call before the first resolves
	// fires a parallel POST whose Promise<Exit> can race with the
	// first -- both .then handlers subscribe to the same atom-state
	// transition via AtomRegistry.getResult. Server logs corroborate
	// with paired 200 + 499 (InterruptError) entries. Setting this
	// flag inside the effect body ensures only one POST goes out.
	const draftCreationStartedRef = useRef(false)
	// Reset on every effect run + tear down on cleanup. The previous
	// "() => () => false" shape only flipped to false in cleanup and
	// never re-asserted true on the StrictMode re-run, leaving the
	// createDraft `.then` handler convinced the form had unmounted
	// and skipping the setServerId call.
	useEffect(() => {
		mountedRef.current = true
		return () => {
			mountedRef.current = false
		}
	}, [])

	// Create server draft on mount if none exists
	useEffect(() => {
		if (draftCreationStartedRef.current) return
		if (serverIdRef.current !== null) return
		const inboxId = effectiveInboxId
		if (inboxId === null) return

		draftCreationStartedRef.current = true
		updateMeta(draft.id, { saving: true })

		const params: Record<string, unknown> = { inboxId }
		if (draft.to) params['to'] = draft.to
		if (draft.subject) params['subject'] = draft.subject
		if (draft.companyId) params['companyId'] = draft.companyId
		if (draft.contactId) params['contactId'] = draft.contactId
		if (draft.mode === 'reply') params['mode'] = 'reply'
		if (draft.threadId) params['threadLinkId'] = draft.threadId

		void createDraft({ payload: params } as never).then(exit => {
			if (!mountedRef.current) return
			if (exit._tag === 'Success') {
				const result = exit.value as Record<string, unknown> | null
				const id =
					typeof result?.['draftId'] === 'string' ? result['draftId'] : null
				serverIdRef.current = id
				setServerId(id)
				updateMeta(draft.id, { serverId: id, saving: false })
			} else {
				// Reset the sentinel so a later inboxId change can retry.
				draftCreationStartedRef.current = false
				updateMeta(draft.id, { saving: false })
			}
		})
	}, [
		effectiveInboxId,
		draft.id,
		draft.to,
		draft.subject,
		draft.companyId,
		draft.contactId,
		draft.mode,
		draft.threadId,
		createDraft,
		updateMeta,
	])

	const debouncedSave = useCallback(
		(patch: Partial<DraftForm>) => {
			if (saveTimerRef.current !== null) {
				clearTimeout(saveTimerRef.current)
			}
			saveTimerRef.current = setTimeout(() => {
				const serverId = serverIdRef.current
				const inboxId = effectiveInboxId
				if (serverId === null || inboxId === null) return

				updateMeta(draft.id, { saving: true })
				const payload: Record<string, unknown> = { inboxId }
				if (patch.to !== undefined) payload['to'] = patch.to
				if (patch.cc !== undefined) {
					const list = splitAddresses(patch.cc)
					if (list.length > 0) payload['cc'] = list
				}
				if (patch.bcc !== undefined) {
					const list = splitAddresses(patch.bcc)
					if (list.length > 0) payload['bcc'] = list
				}
				if (patch.subject !== undefined) payload['subject'] = patch.subject
				if (patch.bodyJson !== undefined) payload['bodyJson'] = patch.bodyJson

				void updateDraft({
					params: { draftId: serverId },
					payload,
				} as never).then(() => {
					if (mountedRef.current) {
						updateMeta(draft.id, { saving: false })
					}
				})
			}, SAVE_DEBOUNCE_MS)
		},
		[effectiveInboxId, draft.id, updateDraft, updateMeta],
	)

	useEffect(
		() => () => {
			if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
		},
		[],
	)

	const patchForm = useCallback(
		(patch: Partial<DraftForm>) => {
			setForm(prev => ({ ...prev, ...patch }))
			if (patch.subject !== undefined)
				updateMeta(draft.id, { subject: patch.subject })
			if (patch.to !== undefined) updateMeta(draft.id, { to: patch.to })
			debouncedSave(patch)
		},
		[draft.id, debouncedSave, updateMeta],
	)

	// Stable callback for the body editor. Inline `onChange={...}` would
	// give EmailEditor a fresh reference every render -- and the editor
	// keys its 300ms onChange debounce on the callback identity, so the
	// timer would clear and reset on every parent render and never
	// actually fire `onChange`. The compose form's `bodyText` then stays
	// pinned at '' and `canSend` blocks Send forever.
	const handleBodyChange = useCallback(
		(payload: { json: EmailBlocks; text: string }) => {
			patchForm({ bodyJson: payload.json, bodyText: payload.text })
		},
		[patchForm],
	)

	const [ccBccOpen, setCcBccOpen] = useState(false)
	const [sendState, setSendState] = useState<SendState>('idle')
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const [suppressed, setSuppressed] = useState<
		ReadonlyArray<SuppressedAddress>
	>([])

	const canSend = useMemo(() => {
		if (sendState === 'sending') return false
		if (form.bodyText.trim() === '') return false
		if (suppressed.length > 0) return false
		if (serverId === null) return false
		if (draft.mode === 'reply') {
			return draft.threadId !== undefined
		}
		if (effectiveInboxId === null) return false
		if (form.to.trim() === '') return false
		return true
	}, [
		sendState,
		form.bodyText,
		form.to,
		suppressed,
		effectiveInboxId,
		draft,
		serverId,
	])

	const handleSend = useCallback(async () => {
		const serverId = serverIdRef.current
		if (serverId === null || effectiveInboxId === null) return

		if (saveTimerRef.current !== null) {
			clearTimeout(saveTimerRef.current)
			saveTimerRef.current = null
		}

		setSendState('sending')
		setErrorMessage(null)
		try {
			const exit = await sendDraft({
				params: { draftId: serverId },
				payload: { inboxId: effectiveInboxId },
			})
			if (exit._tag !== 'Success') {
				throw new Error('Send failed')
			}
			refreshList()
			if (draft.threadId) refreshThread()
			close(draft.id)
		} catch (error) {
			setSendState('error')
			setErrorMessage(
				error instanceof Error ? error.message : 'Failed to send email',
			)
		}
	}, [
		effectiveInboxId,
		sendDraft,
		refreshList,
		refreshThread,
		close,
		draft.id,
		draft.threadId,
	])

	const handleDiscard = useCallback(async () => {
		const serverId = serverIdRef.current
		if (serverId !== null && effectiveInboxId !== null) {
			await deleteDraft({
				params: { draftId: serverId },
				query: { inboxId: effectiveInboxId },
			} as never)
		}
		close(draft.id)
	}, [effectiveInboxId, deleteDraft, close, draft.id])

	const isReply = draft.mode === 'reply'

	return (
		<Form
			data-testid='compose-form'
			onSubmit={event => {
				event.preventDefault()
				if (canSend) void handleSend()
			}}
		>
			{!isReply ? (
				<Field>
					<FieldLabel htmlFor={`inbox-${draft.id}`}>{t`Inbox`}</FieldLabel>
					<PriSelect.Root
						value={effectiveInboxId ?? ''}
						onValueChange={value => {
							patchForm({ inboxId: value === '' ? null : value })
						}}
					>
						<PriSelect.Trigger id={`inbox-${draft.id}`}>
							<PriSelect.Value placeholder={t`Select inbox…`} />
							<PriSelect.Icon />
						</PriSelect.Trigger>
						<PriSelect.Portal>
							<PriSelect.Positioner>
								<PriSelect.Popup>
									{inboxes
										.filter(i => i.active && i.purpose !== 'agent')
										.map(inbox => (
											<PriSelect.Item key={inbox.id} value={inbox.id}>
												<PriSelect.ItemText>
													{inbox.displayName ?? inbox.email}
												</PriSelect.ItemText>
											</PriSelect.Item>
										))}
								</PriSelect.Popup>
							</PriSelect.Positioner>
						</PriSelect.Portal>
					</PriSelect.Root>
				</Field>
			) : null}

			{!isReply ? (
				<Field>
					<FieldLabel htmlFor={`to-${draft.id}`}>{t`To`}</FieldLabel>
					<PriInput
						id={`to-${draft.id}`}
						data-testid='compose-to'
						type='text'
						value={form.to}
						placeholder={t`name@example.com, another@example.com`}
						onChange={event => {
							patchForm({ to: event.target.value })
						}}
					/>
				</Field>
			) : null}

			{!ccBccOpen ? (
				<CcBccToggle
					type='button'
					onClick={() => {
						setCcBccOpen(true)
					}}
				>
					<Plus size={12} aria-hidden />
					<span>{t`Add Cc / Bcc`}</span>
				</CcBccToggle>
			) : (
				<>
					<Field>
						<FieldLabel htmlFor={`cc-${draft.id}`}>{t`Cc`}</FieldLabel>
						<PriInput
							id={`cc-${draft.id}`}
							type='text'
							value={form.cc}
							placeholder={t`Comma-separated`}
							onChange={event => {
								patchForm({ cc: event.target.value })
							}}
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor={`bcc-${draft.id}`}>{t`Bcc`}</FieldLabel>
						<PriInput
							id={`bcc-${draft.id}`}
							type='text'
							value={form.bcc}
							placeholder={t`Comma-separated`}
							onChange={event => {
								patchForm({ bcc: event.target.value })
							}}
						/>
					</Field>
				</>
			)}

			{!isReply ? (
				<Field>
					<FieldLabel htmlFor={`subject-${draft.id}`}>{t`Subject`}</FieldLabel>
					<PriInput
						id={`subject-${draft.id}`}
						data-testid='compose-subject'
						type='text'
						value={form.subject}
						placeholder={t`What is this about?`}
						onChange={event => {
							patchForm({ subject: event.target.value })
						}}
					/>
				</Field>
			) : null}

			<BodyField>
				<BodyLabel>{t`Message`}</BodyLabel>
				<EmailEditor
					mode='compose'
					inboxId={effectiveInboxId ?? ''}
					initialJson={form.bodyJson}
					onChange={handleBodyChange}
					placeholder={t`Write your message…`}
				/>
			</BodyField>

			{draft.companyId !== undefined ? (
				<SuppressionGuard
					companyId={draft.companyId}
					to={form.to}
					cc={form.cc}
					bcc={form.bcc}
					onChange={setSuppressed}
				/>
			) : null}

			{suppressed.length > 0 ? (
				<SuppressionBanner role='alert'>
					<AlertTriangle size={14} aria-hidden />
					<SuppressionList>
						<SuppressionTitle>
							{t`Send blocked: these recipients cannot receive email`}
						</SuppressionTitle>
						{suppressed.map(s => (
							<li key={s.email}>
								<strong>{s.email}</strong>
								{' — '}
								{s.reason === 'bounced' ? t`bounced` : t`complained`}
							</li>
						))}
					</SuppressionList>
				</SuppressionBanner>
			) : null}

			{errorMessage !== null ? (
				<ErrorBanner role='alert'>
					<AlertTriangle size={14} aria-hidden />
					<span>{errorMessage}</span>
				</ErrorBanner>
			) : null}

			<AttachmentPicker
				value={form.attachments}
				onChange={next => {
					patchForm({ attachments: next })
				}}
				inboxId={effectiveInboxId}
				{...(serverIdRef.current !== null && { draftId: serverIdRef.current })}
			/>

			<Footer>
				<PriButton
					type='submit'
					$variant='filled'
					data-testid='compose-send'
					disabled={!canSend}
				>
					<Send size={14} aria-hidden />
					<span>{sendState === 'sending' ? t`Sending…` : t`Send`}</span>
				</PriButton>
				<PriButton
					type='button'
					$variant='text'
					data-testid='compose-discard'
					onClick={() => {
						void handleDiscard()
					}}
				>
					<X size={14} aria-hidden />
					<span>{t`Discard`}</span>
				</PriButton>
				{draft.saving ? <SavingIndicator>{t`Saving…`}</SavingIndicator> : null}
			</Footer>
		</Form>
	)
}

function SuppressionGuard({
	companyId,
	to,
	cc,
	bcc,
	onChange,
}: {
	readonly companyId: string
	readonly to: string
	readonly cc: string
	readonly bcc: string
	readonly onChange: (next: ReadonlyArray<SuppressedAddress>) => void
}) {
	const contactsResult = useAtomValue(contactsAtomFor(companyId))
	const contacts = useMemo(
		() =>
			AsyncResult.isSuccess(contactsResult) ? contactsResult.value : undefined,
		[contactsResult],
	)

	useEffect(() => {
		if (contacts === undefined) {
			onChange([])
			return
		}
		const suppressedMap = new Map<string, SuppressedAddress>()
		for (const raw of contacts) {
			if (raw === null || typeof raw !== 'object') continue
			const r = raw as Record<string, unknown>
			const email = typeof r['email'] === 'string' ? r['email'] : null
			const status = r['emailStatus']
			if (email === null) continue
			if (status !== 'bounced' && status !== 'complained') continue
			const name = typeof r['name'] === 'string' ? r['name'] : email
			suppressedMap.set(email.toLowerCase(), { email, name, reason: status })
		}
		const seen = new Set<string>()
		const out: SuppressedAddress[] = []
		for (const raw of [
			...splitAddresses(to),
			...splitAddresses(cc),
			...splitAddresses(bcc),
		]) {
			const key = raw.toLowerCase()
			if (seen.has(key)) continue
			seen.add(key)
			const match = suppressedMap.get(key)
			if (match !== undefined) out.push(match)
		}
		onChange(out)
	}, [contacts, to, cc, bcc, onChange])

	return null
}

function splitAddresses(raw: string): ReadonlyArray<string> {
	if (raw.trim() === '') return []
	return raw
		.split(/[,;\s]+/)
		.map(s => s.trim())
		.filter(s => s.length > 0)
}

function narrowInboxes(raw: unknown): ReadonlyArray<InboxOption> {
	if (!Array.isArray(raw)) return []
	const out: InboxOption[] = []
	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') continue
		const r = entry as Record<string, unknown>
		if (typeof r['id'] !== 'string' || typeof r['email'] !== 'string') continue
		const purpose =
			r['purpose'] === 'human' ||
			r['purpose'] === 'agent' ||
			r['purpose'] === 'shared'
				? r['purpose']
				: 'human'
		out.push({
			id: r['id'],
			email: r['email'],
			displayName:
				typeof r['displayName'] === 'string' ? r['displayName'] : null,
			purpose,
			isDefault: r['isDefault'] === true,
			active: r['active'] !== false,
		})
	}
	return out
}

// ── Styled components ─────────────────────────────────────────────

const Form = styled.form.withConfig({ displayName: 'ComposeForm' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md);
	flex: 1 1 auto;
	min-height: 0;
	overflow-y: auto;
`

const Field = styled.div.withConfig({ displayName: 'ComposeField' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	min-width: 0;
`

const FieldLabel = styled.label.withConfig({
	displayName: 'ComposeFieldLabel',
})`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const CcBccToggle = styled.button.withConfig({
	displayName: 'ComposeCcBccToggle',
})`
	align-self: flex-start;
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	background: none;
	border: none;
	padding: 0;
	color: var(--color-on-surface-variant);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	cursor: pointer;

	&:hover {
		color: var(--color-primary);
	}
`

const BodyField = styled.div.withConfig({ displayName: 'ComposeBodyField' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	flex: 1 1 auto;
	min-height: 160px;
`

const BodyLabel = styled.div.withConfig({ displayName: 'ComposeBodyLabel' })`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const Footer = styled.div.withConfig({ displayName: 'ComposeFooter' })`
	display: flex;
	align-items: center;
	gap: var(--space-xs);
	padding-top: var(--space-xs);
	border-top: 1px dashed var(--color-outline);
`

const SavingIndicator = styled.span.withConfig({
	displayName: 'ComposeSaving',
})`
	margin-left: auto;
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
	opacity: 0.7;
`

const SuppressionBanner = styled.div.withConfig({
	displayName: 'ComposeSuppressionBanner',
})`
	display: flex;
	align-items: flex-start;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-sm);
	border: 1px solid
		color-mix(in oklab, var(--color-error, #c6664b) 40%, transparent);
	background: color-mix(in oklab, var(--color-error, #c6664b) 8%, transparent);
	color: var(--color-error, #c6664b);
	border-radius: var(--shape-xs);
	font-size: var(--typescale-body-small-size);

	> svg {
		margin-top: 2px;
		flex: 0 0 auto;
	}
`

const SuppressionList = styled.ul.withConfig({
	displayName: 'ComposeSuppressionList',
})`
	margin: 0;
	padding: 0;
	list-style: none;
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const SuppressionTitle = styled.div.withConfig({
	displayName: 'ComposeSuppressionTitle',
})`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	margin-bottom: var(--space-3xs);
`

const ErrorBanner = styled.div.withConfig({
	displayName: 'ComposeErrorBanner',
})`
	display: flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-sm);
	border: 1px solid
		color-mix(in oklab, var(--color-error, #c6664b) 40%, transparent);
	background: color-mix(in oklab, var(--color-error, #c6664b) 8%, transparent);
	color: var(--color-error, #c6664b);
	border-radius: var(--shape-xs);
	font-size: var(--typescale-body-small-size);
`
