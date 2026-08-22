import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { useLingui } from '@lingui/react/macro'
import { AsyncResult } from 'effect/unstable/reactivity'
import { AlertTriangle, Plus, Send, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

import type { EmailBlocks } from '@batuda/email/schema'
import { PriButton, PriInput, PriSelect } from '@batuda/ui/pri'

import {
	checkSuppressedAtom,
	createDraftAtom,
	deleteDraftAtom,
	emailsSearchAtom,
	inboxesListAtom,
	sendDraftAtom,
	threadAtomFor,
	updateDraftAtom,
} from '#/atoms/emails-atoms'
import { AttachmentPicker } from '#/components/emails/attachment-picker'
import { EmailEditor } from '#/components/emails/email-editor'
import { SrOnly } from '#/components/shared/sr-only'
import { type Draft, useComposeEmail } from '#/context/compose-email-context'
import { authClient } from '#/lib/auth-client'
import type { StagedAttachment } from '#/lib/email-attachments'
import {
	badRequestMessage,
	notSendableReason,
	suppressedRecipient,
} from '#/lib/tagged-failure'

type InboxOption = {
	readonly id: string
	readonly email: string
	readonly displayName: string | null
	// Whose mailbox it is: a member's, or null for the whole team's. You can
	// send through your own and the team's, never a colleague's.
	readonly ownerUserId: string | null
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
	readonly reason: 'bounced' | 'complained'
}

const SAVE_DEBOUNCE_MS = 300
// Typing an address should not put a request on the wire per keystroke.
const SUPPRESSION_CHECK_DEBOUNCE_MS = 400

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

	const meUserId = authClient.useSession().data?.user?.id
	const inboxes = useMemo<ReadonlyArray<InboxOption>>(
		() =>
			AsyncResult.isSuccess(inboxesResult)
				? narrowInboxes(inboxesResult.value)
				: [],
		[inboxesResult],
	)

	// Only what this person can actually send through: their own mailboxes and
	// the team's. Offering a colleague's would fail on send anyway.
	const sendableInboxes = useMemo(
		() =>
			inboxes.filter(
				i =>
					i.active &&
					(i.ownerUserId === null ||
						(meUserId !== undefined && i.ownerUserId === meUserId)),
			),
		[inboxes, meUserId],
	)

	// Nothing is chosen until we know who is asking — before that only team
	// mailboxes look sendable, and the draft would bind to one of those.
	const defaultInboxId = useMemo(
		() =>
			meUserId === undefined
				? null
				: ((
						sendableInboxes.find(i => i.ownerUserId !== null && i.isDefault) ??
						sendableInboxes.find(i => i.ownerUserId !== null) ??
						sendableInboxes[0]
					)?.id ?? null),
		[sendableInboxes, meUserId],
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

	// A draft picked up later can name a mailbox since removed, or never this
	// person's; fall back rather than send from an address that is refused.
	const chosenInboxId =
		form.inboxId !== null && sendableInboxes.some(i => i.id === form.inboxId)
			? form.inboxId
			: null
	const effectiveInboxId = chosenInboxId ?? defaultInboxId
	// Sending from an address you did not pick cannot be taken back, so a swap
	// is said out loud and a reply writes down what will go out.
	const substituted =
		form.inboxId !== null && chosenInboxId === null && effectiveInboxId !== null
	const sendingFrom =
		sendableInboxes.find(i => i.id === effectiveInboxId)?.email ?? null

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
	// Set true on every run, not just the first: StrictMode tears the first
	// run down, and without re-asserting it the createDraft reply would look
	// like it arrived after the form closed and its id would be dropped.
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

	// Every field touched since the last save is kept, not only the newest
	// one: each keystroke restarts the timer, so a Send landing before it
	// fires would otherwise save one field and leave the recipient, subject
	// and body behind — and the server refuses a draft with no recipient.
	const pendingPatchRef = useRef<Partial<DraftForm>>({})
	const debouncedSave = useCallback(
		(patch: Partial<DraftForm>) => {
			pendingPatchRef.current = { ...pendingPatchRef.current, ...patch }
			if (saveTimerRef.current !== null) {
				clearTimeout(saveTimerRef.current)
			}
			saveTimerRef.current = setTimeout(() => {
				const serverId = serverIdRef.current
				const inboxId = effectiveInboxId
				if (serverId === null || inboxId === null) return

				const merged = pendingPatchRef.current
				pendingPatchRef.current = {}
				updateMeta(draft.id, { saving: true })
				const payload: Record<string, unknown> = { inboxId }
				if (merged.to !== undefined) payload['to'] = merged.to
				if (merged.cc !== undefined) {
					const list = splitAddresses(merged.cc)
					if (list.length > 0) payload['cc'] = list
				}
				if (merged.bcc !== undefined) {
					const list = splitAddresses(merged.bcc)
					if (list.length > 0) payload['bcc'] = list
				}
				if (merged.subject !== undefined) payload['subject'] = merged.subject
				if (merged.bodyJson !== undefined) payload['bodyJson'] = merged.bodyJson

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
	const [attachmentsUnfinished, setAttachmentsUnfinished] = useState(false)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const [suppressed, setSuppressed] = useState<
		ReadonlyArray<SuppressedAddress>
	>([])
	const [checkFailed, setCheckFailed] = useState(false)

	const canSend = useMemo(() => {
		if (sendState === 'sending') return false
		// A file still on its way up, or stopped on an error nobody has cleared,
		// is not on the message. Sending now would send it without the
		// attachment and say nothing about it.
		if (attachmentsUnfinished) return false
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
		attachmentsUnfinished,
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

		// Cancel any pending debounced save and flush the current form
		// state synchronously. Without this, a click on Send that lands
		// before the SAVE_DEBOUNCE_MS timer fires sends a draft whose
		// toAddresses / subject / cc / bcc / bodyJson on the server are
		// still empty — the server then rejects with EENVELOPE "No
		// recipients defined".
		if (saveTimerRef.current !== null) {
			clearTimeout(saveTimerRef.current)
			saveTimerRef.current = null
		}
		const flushPayload: Record<string, unknown> = {
			inboxId: effectiveInboxId,
			to: form.to,
			subject: form.subject,
			bodyJson: form.bodyJson,
		}
		const ccList = splitAddresses(form.cc)
		if (ccList.length > 0) flushPayload['cc'] = ccList
		const bccList = splitAddresses(form.bcc)
		if (bccList.length > 0) flushPayload['bcc'] = bccList
		await updateDraft({
			params: { draftId: serverId },
			payload: flushPayload,
		} as never)

		setSendState('sending')
		setErrorMessage(null)
		try {
			const exit = await sendDraft({
				params: { draftId: serverId },
				payload: { inboxId: effectiveInboxId },
			})
			if (exit._tag !== 'Success') {
				// With several recipients, only the server knows which one it turned
				// away and why, so say that rather than a bare "Send failed" the
				// reader cannot act on.
				const blocked = suppressedRecipient(exit.cause)
				if (blocked !== null) {
					const why =
						blocked.status === 'bounced'
							? t`Mail to ${blocked.recipient} bounced, so it is blocked.`
							: t`${blocked.recipient} reported a message as spam, so it is blocked.`
					throw new Error(
						blocked.reason === null
							? why
							: `${why} ${t`The receiving server said: ${blocked.reason}`}`,
					)
				}
				// Turned away over the shape of the message rather than who it is
				// going to. The server sends the reason; the sentence is written here
				// so it is in the reader's language.
				const unsendable = notSendableReason(exit.cause)
				if (unsendable !== null) {
					throw new Error(
						unsendable === 'no_subject'
							? t`Without a subject this arrives as "(no subject)" and is likely to be treated as spam.`
							: t`A "Re:" on a message that answers nothing reads as a forged reply. Reply from the conversation, or drop the "Re:".`,
					)
				}
				throw new Error(badRequestMessage(exit.cause) ?? t`Send failed`)
			}
			refreshList()
			if (draft.threadId) refreshThread()
			close(draft.id)
		} catch (error) {
			setSendState('error')
			setErrorMessage(error instanceof Error ? error.message : t`Send failed`)
		}
	}, [
		effectiveInboxId,
		form.to,
		form.cc,
		form.bcc,
		form.subject,
		form.bodyJson,
		sendDraft,
		updateDraft,
		refreshList,
		refreshThread,
		close,
		draft.id,
		draft.threadId,
		t,
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

	// Base UI's Select.Value needs the value→label map to render the chosen
	// inbox as its name rather than its raw id.
	const inboxItems = sendableInboxes.map(i => ({
		value: i.id,
		label: i.displayName ?? i.email,
	}))

	return (
		<Form
			data-testid='compose-form'
			onSubmit={event => {
				event.preventDefault()
				if (canSend) void handleSend()
			}}
		>
			{/* Nothing to send from is a dead end, so it says so rather than
			    offering an empty picker beside a Send that cannot work. Held
			    back until the session lands, since until then the person's own
			    mailboxes are filtered out and an empty list means nothing. */}
			{sendableInboxes.length === 0 && meUserId !== undefined ? (
				<ErrorBanner role='alert'>
					<AlertTriangle size={14} aria-hidden />
					<span>{t`You have no mailbox to send from. Connect one under Emails → your email connections, or ask an admin to set up one shared with the team.`}</span>
				</ErrorBanner>
			) : !isReply ? (
				<Field>
					<FieldLabel htmlFor={`inbox-${draft.id}`}>{t`Inbox`}</FieldLabel>
					<PriSelect.Root
						items={inboxItems}
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
									{inboxItems.map(item => (
										<PriSelect.Item key={item.value} value={item.value}>
											<PriSelect.ItemText>{item.label}</PriSelect.ItemText>
										</PriSelect.Item>
									))}
								</PriSelect.Popup>
							</PriSelect.Positioner>
						</PriSelect.Portal>
					</PriSelect.Root>
				</Field>
			) : null}

			{/* A reply draws no picker, so the address it will go out from is
			    written down rather than left to be assumed. */}
			{isReply && sendingFrom !== null ? (
				<Field>
					<FieldLabel as='span'>{t`From`}</FieldLabel>
					<ReplyFromValue>{sendingFrom}</ReplyFromValue>
				</Field>
			) : null}
			<SrOnly role='status' aria-live='polite'>
				{substituted && sendingFrom !== null
					? t`Sending from ${sendingFrom} instead`
					: ''}
			</SrOnly>

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

			<SuppressionGuard
				to={form.to}
				cc={form.cc}
				bcc={form.bcc}
				onSuppressedChange={setSuppressed}
				onCheckFailedChange={setCheckFailed}
			/>

			{/* Sits by the addresses it names: down by Send it would be off the
			    bottom of the form, leaving a greyed-out button and no reason for
			    it. It waits its turn to be read out, since it lands while an
			    address is still being typed. */}
			{suppressed.length > 0 ? (
				<SuppressionBanner
					role='status'
					aria-live='polite'
					data-testid='compose-suppressed'
				>
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

			{checkFailed && suppressed.length === 0 ? (
				<CheckUnavailable
					role='status'
					aria-live='polite'
					data-testid='compose-check-unavailable'
				>
					{t`Couldn't check whether these addresses can receive email. Sending will still be stopped if one of them can't.`}
				</CheckUnavailable>
			) : null}

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
				onUploadingChange={setAttachmentsUnfinished}
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

// Warns that an address will be refused while the message is still being
// written. Only the server knows every blocked address — a company's own
// mailbox, a contact's second address, one typed by hand — so it is asked
// rather than guessed at from whatever this screen happens to have loaded.
//
// A check that fails raises no warning but says so, since a screen that could
// not ask looks exactly like one that asked and found nothing. The send is
// still the real refusal.
function SuppressionGuard({
	to,
	cc,
	bcc,
	onSuppressedChange,
	onCheckFailedChange,
}: {
	readonly to: string
	readonly cc: string
	readonly bcc: string
	readonly onSuppressedChange: (next: ReadonlyArray<SuppressedAddress>) => void
	readonly onCheckFailedChange: (failed: boolean) => void
}) {
	const check = useAtomSet(checkSuppressedAtom, { mode: 'promiseExit' })

	useEffect(() => {
		// The fields go over as typed, and the server takes the addresses out of
		// them the same way the send does — one place decides what an address is.
		const recipientFields = [to, cc, bcc].filter(field => field.trim() !== '')
		if (recipientFields.length === 0) {
			onSuppressedChange([])
			onCheckFailedChange(false)
			return
		}
		let cancelled = false
		const timer = setTimeout(() => {
			void (async () => {
				const exit = await check({ payload: { recipientFields } })
				if (cancelled) return
				if (exit._tag !== 'Success') {
					onSuppressedChange([])
					onCheckFailedChange(true)
					return
				}
				onCheckFailedChange(false)
				onSuppressedChange(
					exit.value.suppressed.map(row => ({
						email: row.address,
						reason: row.status,
					})),
				)
			})()
		}, SUPPRESSION_CHECK_DEBOUNCE_MS)
		return () => {
			cancelled = true
			clearTimeout(timer)
		}
	}, [to, cc, bcc, check, onSuppressedChange, onCheckFailedChange])

	return null
}

// Shapes the cc and bcc fields into the list a saved draft holds. Not an
// address reader: a recipient written the way a mail client shows it comes
// apart here into pieces that are not addresses.
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
		out.push({
			id: r['id'],
			email: r['email'],
			displayName:
				typeof r['displayName'] === 'string' ? r['displayName'] : null,
			ownerUserId:
				typeof r['ownerUserId'] === 'string' ? r['ownerUserId'] : null,
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
	/* No bottom padding — the pinned Footer owns the bottom edge so nothing
	   peeks below it as the fields scroll. */
	padding: var(--space-md) var(--space-md) 0;
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

const ReplyFromValue = styled.span.withConfig({
	displayName: 'ComposeReplyFromValue',
})`
	font-family: var(--font-mono, ui-monospace, monospace);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface);
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
	/* Pinned to the bottom of the scrolling form so Send/Discard stay reachable
	   even with the on-screen keyboard shrinking the sheet. margin-top pushes it
	   down when the content is short; the opaque paper hides fields scrolling
	   behind it. */
	position: sticky;
	bottom: 0;
	margin-top: auto;
	display: flex;
	align-items: center;
	gap: var(--space-xs);
	padding-top: var(--space-xs);
	padding-bottom: var(--space-md);
	background: var(--color-surface);
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
		color-mix(in oklab, var(--color-error) 40%, transparent);
	background: color-mix(in oklab, var(--color-error) 8%, transparent);
	color: var(--color-error);
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

const CheckUnavailable = styled.p.withConfig({
	displayName: 'ComposeCheckUnavailable',
})`
	margin: 0;
	padding: var(--space-2xs) var(--space-sm);
	border: 1px dashed var(--color-outline-variant);
	border-radius: var(--shape-xs);
	color: var(--color-on-surface-variant);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
`

const ErrorBanner = styled.div.withConfig({
	displayName: 'ComposeErrorBanner',
})`
	display: flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-sm);
	border: 1px solid
		color-mix(in oklab, var(--color-error) 40%, transparent);
	background: color-mix(in oklab, var(--color-error) 8%, transparent);
	color: var(--color-error);
	border-radius: var(--shape-xs);
	font-size: var(--typescale-body-small-size);
`
