import { useAtomRefresh, useAtomSet, useAtomValue } from '@effect/atom-react'
import { useLingui } from '@lingui/react/macro'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AsyncResult } from 'effect/unstable/reactivity'
import {
	AlertTriangle,
	Archive,
	ArchiveRestore,
	ArrowDownLeft,
	ArrowUpRight,
	CheckCheck,
	ChevronDown,
	ChevronLeft,
	ChevronUp,
	EyeOff,
	Mail,
	Paperclip,
	Reply,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import styled, { css } from 'styled-components'

import { PriButton } from '@batuda/ui/pri'

import {
	emailsSearchAtom,
	markThreadReadAtom,
	markThreadUnreadAtom,
	threadAtomFor,
	updateThreadStatusAtom,
} from '#/atoms/emails-atoms'
import { companiesListAtom } from '#/atoms/pipeline-atoms'
import { parentToQuoteBlock } from '#/components/emails/parent-to-quote-block'
import { EmptyState } from '#/components/shared/empty-state'
import { RelativeDate } from '#/components/shared/relative-date'
import { SkeletonRows } from '#/components/shared/skeleton-row'
import { useComposeEmail } from '#/context/compose-email-context'
import { dehydrateAtom } from '#/lib/atom-hydration'
import { downloadUrlFor } from '#/lib/email-attachments'
import { sanitizeEmailHtml } from '#/lib/sanitize-email'
import { getServerCookieHeader } from '#/lib/server-cookie'
import {
	agedPaperSurface,
	brushedMetalBezel,
	brushedMetalPlate,
	rulerUnderRule,
	stenciledTitle,
} from '#/lib/workshop-mixins'

type ThreadStatus = 'open' | 'closed' | 'archived'
type Direction = 'inbound' | 'outbound'
type InboundClassification = 'normal' | 'spam' | 'blocked'
type DeliverabilityStatus =
	| 'delivered'
	| 'bounced'
	| 'complained'
	| 'failed'
	| 'sent'
	| 'queued'
	| 'opened'
	| 'clicked'

type ThreadInbox = {
	readonly email: string
	readonly displayName: string | null
	readonly purpose: 'human' | 'agent' | 'shared'
}

type AttachmentMeta = {
	readonly attachmentId: string
	readonly filename: string | null
	readonly size: number
	readonly contentType: string | null
}

type Deliverability = {
	readonly status: DeliverabilityStatus | string
	readonly statusReason: string | null
	readonly bounceType: string | null
	readonly bounceSubType: string | null
	readonly statusUpdatedAt: string | null
}

type ThreadMessage = {
	readonly messageId: string
	readonly direction: Direction
	readonly from: string
	readonly to: ReadonlyArray<string>
	readonly cc: ReadonlyArray<string>
	readonly subject: string | null
	readonly preview: string | null
	readonly timestamp: string
	readonly text: string | null
	readonly html: string | null
	readonly attachments: ReadonlyArray<AttachmentMeta>
	readonly inboundClassification: InboundClassification | null
	readonly deliverability: Deliverability | null
}

type ThreadDetail = {
	readonly id: string
	readonly providerThreadId: string
	readonly subject: string | null
	readonly status: ThreadStatus
	readonly companyId: string | null
	readonly contactId: string | null
	readonly inbox: ThreadInbox | null
	readonly createdAt: string
	readonly updatedAt: string
	readonly messages: ReadonlyArray<ThreadMessage>
}

type CompanyLookup = {
	readonly slug: string
	readonly name: string
}

async function loadThreadOnServer(threadId: string): Promise<unknown> {
	const [{ Effect }, { makeBatudaApiServer }, cookie] = await Promise.all([
		import('effect'),
		import('#/lib/batuda-api-server'),
		getServerCookieHeader(),
	])
	const program = Effect.gen(function* () {
		const client = yield* makeBatudaApiServer(cookie ?? undefined)
		return yield* client.email.getThread({ params: { threadId } })
	})
	return Effect.runPromise(program)
}

export const Route = createFileRoute('/emails/$threadId')({
	loader: async ({ params: { threadId } }) => {
		if (!import.meta.env.SSR) {
			return { dehydrated: [] as const, threadId }
		}
		try {
			const raw = await loadThreadOnServer(threadId)
			return {
				dehydrated: [
					dehydrateAtom(threadAtomFor(threadId), AsyncResult.success(raw)),
				] as const,
				threadId,
			}
		} catch (error) {
			console.warn('[ThreadDetailLoader] falling back to client fetch:', error)
			return { dehydrated: [] as const, threadId }
		}
	},
	component: ThreadDetailPage,
})

function ThreadDetailPage() {
	const { t, i18n } = useLingui()
	const { threadId } = Route.useParams()
	const atom = useMemo(() => threadAtomFor(threadId), [threadId])
	const result = useAtomValue(atom)
	const refreshThread = useAtomRefresh(atom)
	const refreshList = useAtomRefresh(emailsSearchAtom({}))

	const updateStatus = useAtomSet(updateThreadStatusAtom, {
		mode: 'promiseExit',
	})
	const markRead = useAtomSet(markThreadReadAtom, { mode: 'promiseExit' })
	const markUnread = useAtomSet(markThreadUnreadAtom, { mode: 'promiseExit' })

	const companiesResult = useAtomValue(companiesListAtom)
	const companiesById = useMemo<Map<string, CompanyLookup>>(() => {
		if (!AsyncResult.isSuccess(companiesResult)) return new Map()
		const map = new Map<string, CompanyLookup>()
		for (const row of companiesResult.value as ReadonlyArray<unknown>) {
			if (!row || typeof row !== 'object') continue
			const r = row as Record<string, unknown>
			if (
				typeof r['id'] === 'string' &&
				typeof r['slug'] === 'string' &&
				typeof r['name'] === 'string'
			) {
				map.set(r['id'], { slug: r['slug'], name: r['name'] })
			}
		}
		return map
	}, [companiesResult])

	const detail = useMemo<ThreadDetail | null>(
		() => (AsyncResult.isSuccess(result) ? narrowDetail(result.value) : null),
		[result],
	)

	// Mark the thread read on mount. Kept idempotent — server stamps
	// last_read_at = now() unconditionally, so a second mount during a
	// session is a no-op from the user's perspective.
	const hasMarkedRead = useMarkReadOnce(threadId, detail !== null, markRead)
	useEffect(() => {
		if (hasMarkedRead) refreshList()
	}, [hasMarkedRead, refreshList])

	const handleStatusChange = useCallback(
		async (next: ThreadStatus) => {
			await updateStatus({
				params: { threadId },
				payload: { status: next },
			})
			refreshThread()
			refreshList()
		},
		[threadId, updateStatus, refreshThread, refreshList],
	)

	const handleMarkUnread = useCallback(async () => {
		await markUnread({ params: { threadId } })
		refreshList()
	}, [threadId, markUnread, refreshList])

	const { openCompose } = useComposeEmail()
	const handleReply = useCallback(
		(replyAll: boolean) => {
			if (detail === null) return
			const lastInbound = findLastInbound(detail.messages)
			const last = detail.messages[detail.messages.length - 1] ?? null
			const seed = lastInbound ?? last
			const selfEmail = detail.inbox?.email.toLowerCase() ?? null
			const toList =
				seed !== null
					? seed.direction === 'inbound'
						? [seed.from]
						: seed.to
					: []
			const ccList =
				replyAll && seed !== null
					? [
							...(seed.direction === 'inbound' ? seed.to : []),
							...seed.cc,
						].filter(addr => addr.toLowerCase() !== selfEmail)
					: []
			const subject = prefixSubject(detail.subject ?? '', 'Re: ')
			const quoteSeed = seed
			const attribution = {
				withDate: t`On {date}, {who} wrote:`,
				withoutDate: t`{who} wrote:`,
				fallbackSender: t`someone`,
			}
			const bodyJson = quoteSeed
				? parentToQuoteBlock({
						...(quoteSeed.html !== null && { html: quoteSeed.html }),
						...(quoteSeed.text !== null && { text: quoteSeed.text }),
						fromEmail: quoteSeed.from,
						receivedAt: new Date(quoteSeed.timestamp),
						locale: i18n.locale,
						attribution,
					})
				: undefined
			openCompose({
				mode: 'reply',
				threadId,
				...(detail.companyId !== null && { companyId: detail.companyId }),
				...(detail.contactId !== null && { contactId: detail.contactId }),
				to: toList.join(', '),
				...(ccList.length > 0 && { cc: ccList.join(', ') }),
				subject,
				...(bodyJson !== undefined && { bodyJson }),
			})
		},
		[detail, threadId, openCompose, i18n.locale, t],
	)

	if (AsyncResult.isInitial(result) && detail === null) {
		return (
			<Page>
				<SkeletonRows count={6} height='5rem' />
			</Page>
		)
	}
	if (AsyncResult.isFailure(result) && detail === null) {
		return (
			<Page>
				<EmptyState
					icon={Mail}
					title={t`Thread not found`}
					description={t`The thread may have been archived upstream or the link is stale.`}
					action={
						<BackLink to='/emails'>
							<ChevronLeft size={14} aria-hidden />
							<span>{t`Back to inbox`}</span>
						</BackLink>
					}
				/>
			</Page>
		)
	}
	if (detail === null) {
		return (
			<Page>
				<SkeletonRows count={6} height='5rem' />
			</Page>
		)
	}

	const company =
		detail.companyId !== null ? companiesById.get(detail.companyId) : undefined
	const status = detail.status

	return (
		<Page>
			<HeaderPlate>
				<BackRow>
					<BackLink to='/emails'>
						<ChevronLeft size={14} aria-hidden />
						<span>{t`Back to inbox`}</span>
					</BackLink>
					<StatusChip $status={status}>
						{status === 'open'
							? t`Open`
							: status === 'closed'
								? t`Closed`
								: t`Archived`}
					</StatusChip>
				</BackRow>
				<Title>
					{detail.subject && detail.subject.trim() !== ''
						? detail.subject
						: t`(no subject)`}
				</Title>
				<Actions role='toolbar' aria-label={t`Thread actions`}>
					{status === 'open' ? (
						<PriButton
							type='button'
							$variant='outlined'
							onClick={() => {
								void handleStatusChange('closed')
							}}
						>
							<CheckCheck size={14} aria-hidden />
							<span>{t`Close`}</span>
						</PriButton>
					) : (
						<PriButton
							type='button'
							$variant='outlined'
							onClick={() => {
								void handleStatusChange('open')
							}}
						>
							<ArchiveRestore size={14} aria-hidden />
							<span>{t`Reopen`}</span>
						</PriButton>
					)}
					{status !== 'archived' ? (
						<PriButton
							type='button'
							$variant='outlined'
							onClick={() => {
								void handleStatusChange('archived')
							}}
						>
							<Archive size={14} aria-hidden />
							<span>{t`Archive`}</span>
						</PriButton>
					) : null}
					<PriButton
						type='button'
						$variant='text'
						onClick={() => {
							void handleMarkUnread()
						}}
					>
						<EyeOff size={14} aria-hidden />
						<span>{t`Mark unread`}</span>
					</PriButton>
					{/* See routes/emails/index.tsx for the form-action rationale —
					 * Reply triggers compose, which the route's onClick path
					 * could miss while the subtree is still hydrating. */}
					<form
						action={() => {
							handleReply(false)
						}}
					>
						<PriButton
							type='submit'
							$variant='filled'
							data-testid='thread-reply'
						>
							<Reply size={14} aria-hidden />
							<span>{t`Reply`}</span>
						</PriButton>
					</form>
					<form
						action={() => {
							handleReply(true)
						}}
					>
						<PriButton
							type='submit'
							$variant='outlined'
							data-testid='thread-reply-all'
						>
							<Reply size={14} aria-hidden />
							<span>{t`Reply all`}</span>
						</PriButton>
					</form>
				</Actions>
			</HeaderPlate>

			<Layout>
				<Main>
					<MetaStripMobile>
						<MetaItem>
							<MetaLabel>{t`Company`}</MetaLabel>
							{company !== undefined ? (
								<CompanyLinkWrap>
									<Link to='/companies/$slug' params={{ slug: company.slug }}>
										{company.name}
									</Link>
								</CompanyLinkWrap>
							) : (
								<MetaValueMuted>{t`—`}</MetaValueMuted>
							)}
						</MetaItem>
						<MetaItem>
							<MetaLabel>{t`Inbox`}</MetaLabel>
							{detail.inbox !== null ? (
								<InboxBadge $purpose={detail.inbox.purpose}>
									{detail.inbox.email}
								</InboxBadge>
							) : (
								<MetaValueMuted>{t`—`}</MetaValueMuted>
							)}
						</MetaItem>
					</MetaStripMobile>

					<Timeline>
						{detail.messages.length === 0 ? (
							<EmptyState
								icon={Mail}
								title={t`No messages in this thread`}
								description={t`The thread exists but the provider returned no messages.`}
							/>
						) : (
							detail.messages.map(msg => (
								<MessageItem key={msg.messageId} msg={msg} />
							))
						)}
					</Timeline>
				</Main>

				<SideRail aria-label={t`Thread metadata`}>
					<SideSection>
						<SideLabel>{t`Company`}</SideLabel>
						{company !== undefined ? (
							<CompanyLinkWrap>
								<Link to='/companies/$slug' params={{ slug: company.slug }}>
									{company.name}
								</Link>
							</CompanyLinkWrap>
						) : (
							<SideValueMuted>{t`Unlinked`}</SideValueMuted>
						)}
					</SideSection>
					<SideSection>
						<SideLabel>{t`Inbox`}</SideLabel>
						{detail.inbox !== null ? (
							<div>
								<InboxBadge $purpose={detail.inbox.purpose}>
									{detail.inbox.email}
								</InboxBadge>
								{detail.inbox.displayName ? (
									<SideValueMuted>{detail.inbox.displayName}</SideValueMuted>
								) : null}
							</div>
						) : (
							<SideValueMuted>{t`—`}</SideValueMuted>
						)}
					</SideSection>
					<SideSection>
						<SideLabel>{t`Messages`}</SideLabel>
						<SideValue>{detail.messages.length}</SideValue>
					</SideSection>
					<SideSection>
						<SideLabel>{t`Created`}</SideLabel>
						<SideValue>
							<RelativeDate value={detail.createdAt} />
						</SideValue>
					</SideSection>
					<SideSection>
						<SideLabel>{t`Last activity`}</SideLabel>
						<SideValue>
							<RelativeDate value={detail.updatedAt} />
						</SideValue>
					</SideSection>
				</SideRail>
			</Layout>
		</Page>
	)
}

/**
 * Mark the thread as read on first paint once the detail has arrived.
 * Returns `true` on the render after the mutation fires, so the caller
 * can invalidate the list atom exactly once.
 */
function useMarkReadOnce(
	threadId: string,
	ready: boolean,
	markRead: (req: {
		readonly params: { readonly threadId: string }
	}) => unknown,
): boolean {
	const [fired, setFired] = useState(false)
	useEffect(() => {
		if (!ready || fired) return
		setFired(true)
		void markRead({ params: { threadId } })
	}, [ready, fired, threadId, markRead])
	return fired
}

function MessageItem({ msg }: { readonly msg: ThreadMessage }) {
	const { t } = useLingui()
	const [ccOpen, setCcOpen] = useState(false)
	const suspicious =
		msg.inboundClassification === 'spam' ||
		msg.inboundClassification === 'blocked'

	const body = pickBody(msg)

	return (
		<MessageCard
			$direction={msg.direction}
			$muted={suspicious}
			data-testid='thread-message-card'
			data-direction={msg.direction}
			aria-label={
				msg.direction === 'inbound'
					? t`Inbound message from ${msg.from}`
					: t`Outbound message to ${msg.to.join(', ')}`
			}
		>
			<MessageHeader>
				<DirectionBadge $direction={msg.direction} aria-hidden>
					{msg.direction === 'inbound' ? (
						<ArrowDownLeft size={12} />
					) : (
						<ArrowUpRight size={12} />
					)}
				</DirectionBadge>
				<MessageAddresses>
					<AddressLine>
						<AddressRole>{t`From`}</AddressRole>
						<AddressValue>{msg.from}</AddressValue>
					</AddressLine>
					<AddressLine>
						<AddressRole>{t`To`}</AddressRole>
						<AddressValue>{msg.to.join(', ') || '—'}</AddressValue>
					</AddressLine>
					{msg.cc.length > 0 ? (
						<>
							<CcToggle
								type='button'
								data-testid='thread-cc-toggle'
								onClick={() => {
									setCcOpen(v => !v)
								}}
								aria-expanded={ccOpen}
							>
								{ccOpen ? (
									<ChevronUp size={12} aria-hidden />
								) : (
									<ChevronDown size={12} aria-hidden />
								)}
								<span>
									{ccOpen ? t`Hide Cc` : t`Show Cc (${msg.cc.length})`}
								</span>
							</CcToggle>
							{ccOpen ? (
								<AddressLine>
									<AddressRole>{t`Cc`}</AddressRole>
									<AddressValue>{msg.cc.join(', ')}</AddressValue>
								</AddressLine>
							) : null}
						</>
					) : null}
				</MessageAddresses>
				<MessageMeta>
					<MessageTime>
						<RelativeDate value={msg.timestamp} />
					</MessageTime>
					{msg.deliverability !== null ? (
						<DeliverabilityBadge delivery={msg.deliverability} />
					) : null}
				</MessageMeta>
			</MessageHeader>

			{suspicious ? (
				<SuspiciousBanner role='note'>
					<AlertTriangle size={14} aria-hidden />
					<span>
						{msg.inboundClassification === 'spam'
							? t`Flagged as spam by the provider. The body is shown for review only.`
							: t`Blocked by the provider. The body is shown for review only.`}
					</span>
				</SuspiciousBanner>
			) : null}

			{body.kind === 'html' ? (
				<MessageBody
					$rich
					// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized via DOMPurify in sanitizeEmailHtml
					dangerouslySetInnerHTML={{ __html: body.value }}
				/>
			) : (
				<MessageBody>{body.value}</MessageBody>
			)}

			{msg.attachments.length > 0 ? (
				<AttachmentList>
					{msg.attachments.map(att => (
						<AttachmentChip
							key={att.attachmentId}
							data-testid='attachment-chip'
							data-attachment-id={att.attachmentId}
							href={downloadUrlFor(msg.messageId, att.attachmentId)}
							target='_blank'
							rel='noreferrer'
							download={att.filename ?? undefined}
							title={att.filename ?? t`attachment`}
						>
							<Paperclip size={12} aria-hidden />
							<AttachmentName>{att.filename ?? t`attachment`}</AttachmentName>
							<AttachmentSize>{formatBytes(att.size)}</AttachmentSize>
						</AttachmentChip>
					))}
				</AttachmentList>
			) : null}
		</MessageCard>
	)
}

function DeliverabilityBadge({
	delivery,
}: {
	readonly delivery: Deliverability
}) {
	const { t } = useLingui()
	const { status } = delivery
	const tone: 'ok' | 'warn' | 'error' =
		status === 'delivered' ||
		status === 'sent' ||
		status === 'opened' ||
		status === 'clicked'
			? 'ok'
			: status === 'queued'
				? 'warn'
				: 'error'
	const label =
		status === 'delivered'
			? t`Delivered`
			: status === 'bounced'
				? t`Bounced`
				: status === 'complained'
					? t`Complained`
					: status === 'failed'
						? t`Failed`
						: status === 'sent'
							? t`Sent`
							: status === 'queued'
								? t`Queued`
								: status === 'opened'
									? t`Opened`
									: status === 'clicked'
										? t`Clicked`
										: String(status)
	const title =
		delivery.bounceType && delivery.bounceSubType
			? `${delivery.bounceType}/${delivery.bounceSubType}`
			: (delivery.statusReason ?? undefined)
	return (
		<DeliveryTag $tone={tone} title={title}>
			{label}
		</DeliveryTag>
	)
}

// ── Narrowing ─────────────────────────────────────────────────────

function narrowDetail(raw: unknown): ThreadDetail | null {
	if (!raw || typeof raw !== 'object') return null
	const r = raw as Record<string, unknown>
	if (typeof r['id'] !== 'string') return null
	const inbox = narrowInbox(r['inbox'])
	const messages = narrowMessages(r['messages'])
	return {
		id: r['id'],
		providerThreadId:
			typeof r['providerThreadId'] === 'string' ? r['providerThreadId'] : '',
		subject: typeof r['subject'] === 'string' ? r['subject'] : null,
		status:
			r['status'] === 'open' ||
			r['status'] === 'closed' ||
			r['status'] === 'archived'
				? r['status']
				: 'open',
		companyId: typeof r['companyId'] === 'string' ? r['companyId'] : null,
		contactId: typeof r['contactId'] === 'string' ? r['contactId'] : null,
		inbox,
		createdAt: toDateString(r['createdAt']),
		updatedAt: toDateString(r['updatedAt']),
		messages,
	}
}

function narrowInbox(raw: unknown): ThreadInbox | null {
	if (!raw || typeof raw !== 'object') return null
	const r = raw as Record<string, unknown>
	if (typeof r['email'] !== 'string') return null
	const purpose =
		r['purpose'] === 'human' ||
		r['purpose'] === 'agent' ||
		r['purpose'] === 'shared'
			? r['purpose']
			: 'human'
	return {
		email: r['email'],
		displayName: typeof r['displayName'] === 'string' ? r['displayName'] : null,
		purpose,
	}
}

function narrowMessages(raw: unknown): ReadonlyArray<ThreadMessage> {
	if (!Array.isArray(raw)) return []
	const out: ThreadMessage[] = []
	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') continue
		const r = entry as Record<string, unknown>
		const messageId = typeof r['messageId'] === 'string' ? r['messageId'] : null
		if (messageId === null) continue
		const to = Array.isArray(r['to'])
			? (r['to'].filter(x => typeof x === 'string') as string[])
			: []
		const cc = Array.isArray(r['cc'])
			? (r['cc'].filter(x => typeof x === 'string') as string[])
			: []
		const direction =
			r['direction'] === 'outbound' || r['direction'] === 'inbound'
				? (r['direction'] as Direction)
				: guessDirection(r)
		const classification =
			r['inboundClassification'] === 'spam' ||
			r['inboundClassification'] === 'blocked' ||
			r['inboundClassification'] === 'normal'
				? r['inboundClassification']
				: null
		out.push({
			messageId,
			direction,
			from: typeof r['from'] === 'string' ? r['from'] : '',
			to,
			cc,
			subject: typeof r['subject'] === 'string' ? r['subject'] : null,
			preview: typeof r['preview'] === 'string' ? r['preview'] : null,
			timestamp: toDateString(r['timestamp']),
			text: typeof r['text'] === 'string' ? r['text'] : null,
			html: typeof r['html'] === 'string' ? r['html'] : null,
			attachments: narrowAttachments(r['attachments']),
			inboundClassification: classification,
			deliverability: narrowDeliverability(r['deliverability']),
		})
	}
	return out
}

function guessDirection(r: Record<string, unknown>): Direction {
	// Provider responses may omit the direction field. Heuristic: treat
	// anything with a deliverability row as outbound (we only stamp
	// status for messages we sent); fall back to inbound.
	return r['deliverability'] ? 'outbound' : 'inbound'
}

function narrowAttachments(raw: unknown): ReadonlyArray<AttachmentMeta> {
	if (!Array.isArray(raw)) return []
	const out: AttachmentMeta[] = []
	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') continue
		const r = entry as Record<string, unknown>
		if (typeof r['attachmentId'] !== 'string') continue
		out.push({
			attachmentId: r['attachmentId'],
			filename: typeof r['filename'] === 'string' ? r['filename'] : null,
			size: typeof r['size'] === 'number' ? r['size'] : 0,
			contentType:
				typeof r['contentType'] === 'string' ? r['contentType'] : null,
		})
	}
	return out
}

function narrowDeliverability(raw: unknown): Deliverability | null {
	if (!raw || typeof raw !== 'object') return null
	const r = raw as Record<string, unknown>
	if (typeof r['status'] !== 'string') return null
	return {
		status: r['status'],
		statusReason:
			typeof r['statusReason'] === 'string' ? r['statusReason'] : null,
		bounceType: typeof r['bounceType'] === 'string' ? r['bounceType'] : null,
		bounceSubType:
			typeof r['bounceSubType'] === 'string' ? r['bounceSubType'] : null,
		statusUpdatedAt: toDateStringOrNull(r['statusUpdatedAt']),
	}
}

function toDateString(raw: unknown): string {
	if (raw instanceof Date) return raw.toISOString()
	if (typeof raw === 'string') return raw
	if (typeof raw === 'number') return new Date(raw).toISOString()
	return new Date().toISOString()
}

function toDateStringOrNull(raw: unknown): string | null {
	if (raw instanceof Date) return raw.toISOString()
	if (typeof raw === 'string' && raw !== '') return raw
	return null
}

type RenderableBody =
	| { readonly kind: 'html'; readonly value: string }
	| { readonly kind: 'text'; readonly value: string }

/**
 * Prefer HTML when the provider gives us rich content — it survives
 * headings, lists, blockquotes, links, and inline formatting. Fall
 * back to plain text (or the preview line) when HTML is absent or
 * sanitization leaves nothing renderable.
 */
function pickBody(msg: ThreadMessage): RenderableBody {
	if (msg.html && msg.html.trim() !== '') {
		const clean = sanitizeEmailHtml(msg.html).trim()
		if (clean !== '') return { kind: 'html', value: clean }
	}
	if (msg.text && msg.text.trim() !== '') {
		return { kind: 'text', value: msg.text }
	}
	if (msg.preview && msg.preview.trim() !== '') {
		return { kind: 'text', value: msg.preview }
	}
	return { kind: 'text', value: '' }
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function findLastInbound(
	messages: ReadonlyArray<ThreadMessage>,
): ThreadMessage | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]
		if (m !== undefined && m.direction === 'inbound') return m
	}
	return null
}

function prefixSubject(subject: string, prefix: string): string {
	const trimmed = subject.trim()
	if (trimmed === '') return prefix.trim()
	if (trimmed.toLowerCase().startsWith(prefix.trim().toLowerCase())) {
		return trimmed
	}
	return `${prefix}${trimmed}`
}

// ── Styled components ─────────────────────────────────────────────

const Page = styled.div.withConfig({ displayName: 'EmailsThreadDetailPage' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-lg);
`

const HeaderPlate = styled.header.withConfig({
	displayName: 'ThreadHeaderPlate',
})`
	${brushedMetalPlate}
	${rulerUnderRule}
	display: flex;
	flex-direction: column;
	gap: var(--space-xs);
	padding: var(--space-md);
`

const BackRow = styled.div.withConfig({ displayName: 'ThreadHeaderBackRow' })`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
`

const BackLink = styled(Link).withConfig({ displayName: 'ThreadBackLink' })`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-sm);
	border: 1px dashed var(--color-outline);
	border-radius: var(--shape-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-medium-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-on-surface);
	text-decoration: none;

	&:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}
`

const Title = styled.h2.withConfig({ displayName: 'ThreadTitle' })`
	${stenciledTitle}
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
	margin: 0;
	word-break: break-word;
`

const Actions = styled.div.withConfig({ displayName: 'ThreadActions' })`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-2xs);
	align-items: center;
`

const statusTone = (status: ThreadStatus) => {
	if (status === 'open')
		return css`
			background: color-mix(in oklab, var(--color-primary) 14%, transparent);
			color: var(--color-primary);
			border-color: color-mix(in oklab, var(--color-primary) 40%, transparent);
		`
	if (status === 'closed')
		return css`
			background: transparent;
			color: var(--color-on-surface-variant);
			border-color: var(--color-outline);
		`
	return css`
		background: transparent;
		color: var(--color-on-surface-variant);
		border-style: dashed;
		border-color: var(--color-outline);
	`
}

const StatusChip = styled.span.withConfig({ displayName: 'ThreadStatusChip' })<{
	readonly $status: ThreadStatus
}>`
	display: inline-flex;
	align-items: center;
	padding: var(--space-3xs) var(--space-xs);
	border: 1px solid var(--color-outline);
	border-radius: var(--shape-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	${({ $status }) => statusTone($status)}
`

const Layout = styled.div.withConfig({ displayName: 'ThreadLayout' })`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-lg);

	@media (min-width: 1024px) {
		grid-template-columns: 1fr 280px;
	}
`

const Main = styled.div.withConfig({ displayName: 'ThreadMain' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
	min-width: 0;
`

const MetaStripMobile = styled.div.withConfig({
	displayName: 'ThreadMetaStripMobile',
})`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-sm);
	padding: var(--space-sm);
	border: 1px dashed var(--color-outline);
	border-radius: var(--shape-xs);

	@media (min-width: 1024px) {
		display: none;
	}
`

const MetaItem = styled.div.withConfig({ displayName: 'ThreadMetaItem' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const MetaLabel = styled.span.withConfig({ displayName: 'ThreadMetaLabel' })`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const MetaValueMuted = styled.span.withConfig({
	displayName: 'ThreadMetaValueMuted',
})`
	color: var(--color-on-surface-variant);
	font-size: var(--typescale-body-medium-size);
`

const CompanyLinkWrap = styled.div.withConfig({
	displayName: 'ThreadCompanyLink',
})`
	> a {
		color: var(--color-primary);
		text-decoration: none;
		font-size: var(--typescale-body-medium-size);
	}
	> a:hover {
		text-decoration: underline;
	}
`

const inboxTone = (purpose: 'human' | 'agent' | 'shared') => {
	if (purpose === 'human')
		return css`
			background: color-mix(in oklab, var(--color-primary) 10%, transparent);
			color: var(--color-primary);
		`
	if (purpose === 'agent')
		return css`
			background: color-mix(in oklab, var(--color-secondary) 14%, transparent);
			color: var(--color-secondary);
		`
	return css`
		background: color-mix(in oklab, var(--color-tertiary) 12%, transparent);
		color: var(--color-tertiary);
	`
}

const InboxBadge = styled.span.withConfig({ displayName: 'ThreadInboxBadge' })<{
	readonly $purpose: 'human' | 'agent' | 'shared'
}>`
	display: inline-flex;
	align-items: center;
	padding: var(--space-3xs) var(--space-xs);
	border-radius: var(--shape-2xs);
	font-family: var(--font-mono, ui-monospace, monospace);
	font-size: var(--typescale-label-small-size);
	${({ $purpose }) => inboxTone($purpose)}
`

const SideRail = styled.aside.withConfig({ displayName: 'ThreadSideRail' })`
	${brushedMetalBezel}
	display: none;
	flex-direction: column;
	gap: var(--space-md);
	padding: var(--space-md);
	align-self: start;
	position: sticky;
	top: var(--space-md);

	@media (min-width: 1024px) {
		display: flex;
	}
`

const SideSection = styled.div.withConfig({ displayName: 'ThreadSideSection' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const SideLabel = styled.span.withConfig({ displayName: 'ThreadSideLabel' })`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
`

const SideValue = styled.span.withConfig({ displayName: 'ThreadSideValue' })`
	font-size: var(--typescale-body-medium-size);
	color: var(--color-on-surface);
`

const SideValueMuted = styled.span.withConfig({
	displayName: 'ThreadSideValueMuted',
})`
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const Timeline = styled.div.withConfig({ displayName: 'ThreadTimeline' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
`

const MessageCard = styled.article.withConfig({
	displayName: 'ThreadMessageCard',
})<{
	readonly $direction: Direction
	readonly $muted: boolean
}>`
	${agedPaperSurface}
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md);
	border-left: 3px solid
		${({ $direction }) =>
			$direction === 'inbound'
				? 'var(--color-secondary)'
				: 'var(--color-primary)'};
	${({ $muted }) =>
		$muted
			? css`
					opacity: 0.82;
				`
			: null}
`

const MessageHeader = styled.header.withConfig({
	displayName: 'ThreadMessageHeader',
})`
	display: grid;
	grid-template-columns: auto 1fr auto;
	align-items: start;
	gap: var(--space-sm);
`

const DirectionBadge = styled.span.withConfig({
	displayName: 'ThreadDirectionBadge',
})<{
	readonly $direction: Direction
}>`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 24px;
	height: 24px;
	border-radius: 50%;
	background: ${({ $direction }) =>
		$direction === 'inbound'
			? 'color-mix(in oklab, var(--color-secondary) 18%, transparent)'
			: 'color-mix(in oklab, var(--color-primary) 18%, transparent)'};
	color: ${({ $direction }) =>
		$direction === 'inbound'
			? 'var(--color-secondary)'
			: 'var(--color-primary)'};
`

const MessageAddresses = styled.div.withConfig({
	displayName: 'ThreadMessageAddresses',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	min-width: 0;
`

const AddressLine = styled.div.withConfig({ displayName: 'ThreadAddressLine' })`
	display: flex;
	gap: var(--space-xs);
	font-size: var(--typescale-body-small-size);
	line-height: 1.4;
	min-width: 0;
`

const AddressRole = styled.span.withConfig({
	displayName: 'ThreadAddressRole',
})`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--color-on-surface-variant);
	flex: 0 0 48px;
`

const AddressValue = styled.span.withConfig({
	displayName: 'ThreadAddressValue',
})`
	color: var(--color-on-surface);
	word-break: break-word;
	flex: 1 1 auto;
	min-width: 0;
`

const CcToggle = styled.button.withConfig({ displayName: 'ThreadCcToggle' })`
	align-self: flex-start;
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
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

const MessageMeta = styled.div.withConfig({ displayName: 'ThreadMessageMeta' })`
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: var(--space-3xs);
`

const MessageTime = styled.span.withConfig({
	displayName: 'ThreadMessageTime',
})`
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
	white-space: nowrap;
`

const deliveryTone = (tone: 'ok' | 'warn' | 'error') => {
	if (tone === 'ok')
		return css`
			color: var(--color-primary);
			border-color: color-mix(in oklab, var(--color-primary) 40%, transparent);
			background: color-mix(in oklab, var(--color-primary) 8%, transparent);
		`
	if (tone === 'warn')
		return css`
			color: var(--color-on-surface-variant);
			border-color: var(--color-outline);
			background: transparent;
		`
	return css`
		color: var(--color-error, #c6664b);
		border-color: color-mix(
			in oklab,
			var(--color-error, #c6664b) 40%,
			transparent
		);
		background: color-mix(in oklab, var(--color-error, #c6664b) 8%, transparent);
	`
}

const DeliveryTag = styled.span.withConfig({
	displayName: 'ThreadDeliveryTag',
})<{
	readonly $tone: 'ok' | 'warn' | 'error'
}>`
	display: inline-flex;
	align-items: center;
	padding: 0 var(--space-2xs);
	border: 1px solid transparent;
	border-radius: var(--shape-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	${({ $tone }) => deliveryTone($tone)}
`

const SuspiciousBanner = styled.div.withConfig({
	displayName: 'ThreadSuspiciousBanner',
})`
	display: flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-sm);
	border: 1px solid color-mix(in oklab, #e2a24b 50%, transparent);
	background: color-mix(in oklab, #e2a24b 12%, transparent);
	color: #8a5a1e;
	border-radius: var(--shape-xs);
	font-size: var(--typescale-body-small-size);
`

const MessageBody = styled.div.withConfig({
	displayName: 'ThreadMessageBody',
	shouldForwardProp: prop => prop !== '$rich',
})<{ $rich?: boolean }>`
	white-space: ${p => (p.$rich ? 'normal' : 'pre-wrap')};
	word-break: break-word;
	font-size: var(--typescale-body-medium-size);
	line-height: 1.55;
	color: var(--color-on-surface);

	${p =>
		p.$rich
			? css`
					p {
						margin: 0 0 var(--space-2xs);
					}

					h1,
					h2,
					h3,
					h4,
					h5,
					h6 {
						font-family: var(--font-display);
						line-height: 1.25;
						margin: var(--space-xs) 0 var(--space-2xs);
						color: var(--color-on-surface);
					}

					h1 {
						font-size: var(--typescale-title-large-size, 1.5rem);
					}

					h2 {
						font-size: var(--typescale-title-medium-size, 1.25rem);
					}

					h3,
					h4,
					h5,
					h6 {
						font-size: var(--typescale-title-small-size, 1.1rem);
					}

					ul,
					ol {
						padding-left: var(--space-md);
						margin: 0 0 var(--space-2xs);
					}

					blockquote {
						margin: 0 0 var(--space-2xs);
						padding: var(--space-2xs) var(--space-sm);
						border-left: 3px solid var(--color-outline);
						color: var(--color-on-surface-variant);
						font-style: italic;
					}

					code {
						font-family: var(--font-mono, ui-monospace, monospace);
						font-size: 0.9em;
						padding: 0.1em 0.3em;
						border-radius: var(--shape-2xs);
						background: color-mix(
							in oklab,
							var(--color-on-surface) 8%,
							transparent
						);
					}

					pre {
						font-family: var(--font-mono, ui-monospace, monospace);
						font-size: 0.9em;
						margin: 0 0 var(--space-2xs);
						padding: var(--space-xs) var(--space-sm);
						border-radius: var(--shape-xs);
						background: color-mix(
							in oklab,
							var(--color-on-surface) 6%,
							transparent
						);
						overflow-x: auto;
					}

					pre code {
						background: transparent;
						padding: 0;
						border-radius: 0;
						font-size: inherit;
					}

					hr {
						border: 0;
						border-top: 1px dashed var(--color-outline);
						margin: var(--space-sm) 0;
					}

					a {
						color: var(--color-primary);
						text-decoration: underline;
						text-underline-offset: 2px;
					}

					img {
						max-width: 100%;
						height: auto;
						border-radius: var(--shape-2xs);
					}

					table {
						border-collapse: collapse;
						margin: 0 0 var(--space-2xs);
					}

					th,
					td {
						border: 1px solid var(--color-outline);
						padding: var(--space-3xs) var(--space-2xs);
						text-align: left;
					}
				`
			: ''}
`

const AttachmentList = styled.div.withConfig({
	displayName: 'ThreadAttachmentList',
})`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-2xs);
	padding-top: var(--space-2xs);
	border-top: 1px dashed var(--color-outline);
`

const AttachmentChip = styled.a.withConfig({
	displayName: 'ThreadAttachmentChip',
})`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-sm);
	border: 1px solid var(--color-outline);
	border-radius: var(--shape-2xs);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface);
	background: var(--color-surface);
	text-decoration: none;
	cursor: pointer;

	&:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}
`

const AttachmentName = styled.span.withConfig({
	displayName: 'ThreadAttachmentName',
})`
	font-family: var(--font-mono, ui-monospace, monospace);
	max-width: 220px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const AttachmentSize = styled.span.withConfig({
	displayName: 'ThreadAttachmentSize',
})`
	color: var(--color-on-surface-variant);
`
