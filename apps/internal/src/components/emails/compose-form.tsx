import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { useLingui } from '@lingui/react/macro'
import { AsyncResult } from 'effect/unstable/reactivity'
import { AlertTriangle, Paperclip, Plus, Send, X } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import styled from 'styled-components'

import { PriButton, PriInput, PriSelect } from '@engranatge/ui/pri'

import {
	emailsSearchAtom,
	inboxesListAtom,
	replyEmailAtom,
	sendEmailAtom,
	threadAtomFor,
} from '#/atoms/emails-atoms'
import { type Draft, useComposeEmail } from '#/context/compose-email-context'

type InboxOption = {
	readonly id: string
	readonly email: string
	readonly displayName: string | null
	readonly purpose: 'human' | 'agent' | 'shared'
	readonly isDefault: boolean
	readonly active: boolean
}

type SendState = 'idle' | 'sending' | 'error'

export function ComposeForm({ draft }: { readonly draft: Draft }) {
	const { t } = useLingui()
	const { updateForm, close, markClean } = useComposeEmail()
	const inboxesResult = useAtomValue(inboxesListAtom)

	const send = useAtomSet(sendEmailAtom, { mode: 'promiseExit' })
	const reply = useAtomSet(replyEmailAtom, { mode: 'promiseExit' })
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

	// Lock the inbox in reply mode — replies must ship from the thread's
	// inbox. For `new` drafts, fall back to the user's default human
	// inbox if the form hasn't been touched.
	const effectiveInboxId = useMemo(() => {
		if (draft.form.inboxId !== null) return draft.form.inboxId
		const fallback =
			inboxes.find(i => i.purpose === 'human' && i.isDefault && i.active) ??
			inboxes.find(i => i.purpose === 'human' && i.active)
		return fallback?.id ?? null
	}, [draft.form.inboxId, inboxes])

	const [ccBccOpen, setCcBccOpen] = useState(
		draft.form.cc.length > 0 || draft.form.bcc.length > 0,
	)
	const [sendState, setSendState] = useState<SendState>('idle')
	const [errorMessage, setErrorMessage] = useState<string | null>(null)

	const canSend = useMemo(() => {
		if (sendState === 'sending') return false
		if (draft.form.body.trim() === '') return false
		if (draft.mode === 'reply') {
			return draft.threadId !== undefined
		}
		if (effectiveInboxId === null) return false
		if (draft.form.to.trim() === '') return false
		return true
	}, [sendState, draft, effectiveInboxId])

	const handleSend = useCallback(async () => {
		setSendState('sending')
		setErrorMessage(null)
		try {
			if (draft.mode === 'reply') {
				if (draft.threadId === undefined) {
					throw new Error('Reply draft missing threadId')
				}
				const cc = splitAddresses(draft.form.cc)
				const bcc = splitAddresses(draft.form.bcc)
				await reply({
					payload: {
						threadId: draft.threadId,
						text: draft.form.body,
						...(cc.length > 0 && { cc }),
						...(bcc.length > 0 && { bcc }),
					},
				})
				refreshThread()
			} else {
				if (effectiveInboxId === null) {
					throw new Error('Compose draft missing inboxId')
				}
				const toList = splitAddresses(draft.form.to)
				if (toList.length === 0) {
					throw new Error('At least one recipient required')
				}
				const firstTo = toList[0]
				if (firstTo === undefined) {
					throw new Error('At least one recipient required')
				}
				const to: string | ReadonlyArray<string> =
					toList.length === 1 ? firstTo : toList
				const cc = splitAddresses(draft.form.cc)
				const bcc = splitAddresses(draft.form.bcc)
				await send({
					payload: {
						inboxId: effectiveInboxId,
						to,
						subject: draft.form.subject,
						text: draft.form.body,
						companyId: draft.companyId ?? '',
						...(draft.contactId !== undefined && {
							contactId: draft.contactId,
						}),
						...(cc.length > 0 && { cc }),
						...(bcc.length > 0 && { bcc }),
					},
				})
			}
			markClean(draft.id)
			refreshList()
			close(draft.id, { force: true })
		} catch (error) {
			setSendState('error')
			setErrorMessage(
				error instanceof Error ? error.message : 'Failed to send email',
			)
			return
		}
		setSendState('idle')
	}, [
		draft,
		effectiveInboxId,
		send,
		reply,
		refreshList,
		refreshThread,
		markClean,
		close,
	])

	const handleDiscard = useCallback(() => {
		close(draft.id)
	}, [close, draft.id])

	const isReply = draft.mode === 'reply'

	return (
		<Form
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
							updateForm(draft.id, { inboxId: value === '' ? null : value })
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
						type='text'
						value={draft.form.to}
						placeholder='name@example.com, another@example.com'
						onChange={event => {
							updateForm(draft.id, { to: event.target.value })
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
							value={draft.form.cc}
							placeholder={t`Comma-separated`}
							onChange={event => {
								updateForm(draft.id, { cc: event.target.value })
							}}
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor={`bcc-${draft.id}`}>{t`Bcc`}</FieldLabel>
						<PriInput
							id={`bcc-${draft.id}`}
							type='text'
							value={draft.form.bcc}
							placeholder={t`Comma-separated`}
							onChange={event => {
								updateForm(draft.id, { bcc: event.target.value })
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
						type='text'
						value={draft.form.subject}
						placeholder={t`What is this about?`}
						onChange={event => {
							updateForm(draft.id, { subject: event.target.value })
						}}
					/>
				</Field>
			) : null}

			<BodyField>
				<BodyLabel htmlFor={`body-${draft.id}`}>{t`Message`}</BodyLabel>
				<BodyTextarea
					id={`body-${draft.id}`}
					value={draft.form.body}
					placeholder={t`Write your message…`}
					onChange={event => {
						updateForm(draft.id, { body: event.target.value })
					}}
				/>
			</BodyField>

			{errorMessage !== null ? (
				<ErrorBanner role='alert'>
					<AlertTriangle size={14} aria-hidden />
					<span>{errorMessage}</span>
				</ErrorBanner>
			) : null}

			<Footer>
				<PriButton type='submit' $variant='filled' disabled={!canSend}>
					<Send size={14} aria-hidden />
					<span>{sendState === 'sending' ? t`Sending…` : t`Send`}</span>
				</PriButton>
				<AttachmentHint
					type='button'
					disabled
					title={t`Attachments ship with the next compose update`}
				>
					<Paperclip size={14} aria-hidden />
					<span>{t`Attach`}</span>
				</AttachmentHint>
				<PriButton type='button' $variant='text' onClick={handleDiscard}>
					<X size={14} aria-hidden />
					<span>{t`Discard`}</span>
				</PriButton>
			</Footer>
		</Form>
	)
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

const BodyLabel = styled.label.withConfig({ displayName: 'ComposeBodyLabel' })`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const BodyTextarea = styled.textarea.withConfig({
	displayName: 'ComposeBodyTextarea',
})`
	flex: 1 1 auto;
	min-height: 160px;
	padding: var(--space-sm);
	border: 1px solid var(--color-outline);
	border-radius: var(--shape-xs);
	background: var(--color-surface);
	color: var(--color-on-surface);
	font-family: inherit;
	font-size: var(--typescale-body-medium-size);
	line-height: 1.55;
	resize: vertical;

	&:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px color-mix(in oklab, var(--color-primary) 30%, transparent);
	}
`

const Footer = styled.div.withConfig({ displayName: 'ComposeFooter' })`
	display: flex;
	align-items: center;
	gap: var(--space-xs);
	padding-top: var(--space-xs);
	border-top: 1px dashed var(--color-outline);
`

const AttachmentHint = styled.button.withConfig({
	displayName: 'ComposeAttachmentHint',
})`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-sm);
	border: 1px dashed var(--color-outline);
	border-radius: var(--shape-2xs);
	background: transparent;
	color: var(--color-on-surface-variant);
	font-family: var(--font-display);
	font-size: var(--typescale-label-medium-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	cursor: not-allowed;
	opacity: 0.7;
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
