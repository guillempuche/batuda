import { Config, Effect, Redacted } from 'effect'
import { HttpServerResponse } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Webhook } from 'svix'

import { BatudaApi } from '@batuda/controllers'

import { EmailService } from '../services/email'

type MessageReceivedPayload = {
	event_type:
		| 'message.received'
		| 'message.received.spam'
		| 'message.received.blocked'
	message: {
		inbox_id: string
		thread_id: string
		message_id: string
		from: string
		subject?: string
	}
}

type DeliveryPayload = {
	event_type: 'message.delivered'
	delivery: {
		inbox_id: string
		thread_id: string
		message_id: string
		timestamp: string
		recipients: string[]
	}
}

type BouncePayload = {
	event_type: 'message.bounced'
	bounce: {
		inbox_id: string
		thread_id: string
		message_id: string
		timestamp: string
		type: string
		sub_type: string
		recipients: Array<{ address: string; status: string }>
	}
}

type ComplaintPayload = {
	event_type: 'message.complained'
	complaint: {
		inbox_id: string
		thread_id: string
		message_id: string
		timestamp: string
		type: string
		sub_type: string
		recipients: string[]
	}
}

type RejectPayload = {
	event_type: 'message.rejected'
	reject: {
		inbox_id: string
		thread_id: string
		message_id: string
		timestamp: string
		reason: string
	}
}

type WebhookPayload =
	| MessageReceivedPayload
	| DeliveryPayload
	| BouncePayload
	| ComplaintPayload
	| RejectPayload
	| { event_type: string }

export const AgentMailWebhookLive = HttpApiBuilder.group(
	BatudaApi,
	'agentmailWebhook',
	handlers =>
		Effect.gen(function* () {
			const svc = yield* EmailService
			// Required, no default: webhook integrity depends on it. Treating
			// an unset or empty secret as "skip verification" is a silent
			// security regression — boot fails instead.
			const secret = Redacted.value(
				yield* Config.redacted('EMAIL_WEBHOOK_SECRET'),
			)
			const wh = new Webhook(secret)

			return handlers.handleRaw(
				'inbound',
				Effect.fnUntraced(function* ({ request }) {
					const rawBody = yield* Effect.orDie(request.text)
					const headers = request.headers

					try {
						wh.verify(rawBody, {
							'svix-id': headers['svix-id'] ?? '',
							'svix-timestamp': headers['svix-timestamp'] ?? '',
							'svix-signature': headers['svix-signature'] ?? '',
						})
					} catch {
						return HttpServerResponse.jsonUnsafe(
							{ error: 'Invalid webhook signature' },
							{ status: 400 },
						)
					}

					const payload = JSON.parse(rawBody) as WebhookPayload

					switch (payload.event_type) {
						case 'message.received':
						case 'message.received.spam':
						case 'message.received.blocked': {
							const p = payload as MessageReceivedPayload
							const classification =
								p.event_type === 'message.received.spam'
									? 'spam'
									: p.event_type === 'message.received.blocked'
										? 'blocked'
										: 'normal'
							yield* svc
								.handleInboundWebhook({
									provider: 'agentmail',
									providerInboxId: p.message.inbox_id,
									providerThreadId: p.message.thread_id,
									providerMessageId: p.message.message_id,
									from: p.message.from ?? '',
									classification,
									...(p.message.subject !== undefined && {
										subject: p.message.subject,
									}),
								})
								.pipe(Effect.orDie)
							break
						}

						case 'message.delivered': {
							const p = payload as DeliveryPayload
							yield* svc
								.markDelivered(
									p.delivery.message_id,
									new Date(p.delivery.timestamp),
								)
								.pipe(Effect.orDie)
							break
						}

						case 'message.bounced': {
							const p = payload as BouncePayload
							const rawType = p.bounce.type ?? null
							const rawSubType = p.bounce.sub_type ?? null
							const isHard = (rawType ?? '').toLowerCase() === 'permanent'
							yield* svc
								.markBounced(
									p.bounce.message_id,
									isHard,
									rawType,
									rawSubType,
									new Date(p.bounce.timestamp),
								)
								.pipe(Effect.orDie)
							break
						}

						case 'message.complained': {
							const p = payload as ComplaintPayload
							yield* svc
								.markComplained(
									p.complaint.message_id,
									new Date(p.complaint.timestamp),
								)
								.pipe(Effect.orDie)
							break
						}

						case 'message.rejected': {
							const p = payload as RejectPayload
							yield* svc
								.markRejected(
									p.reject.message_id,
									p.reject.reason ?? null,
									new Date(p.reject.timestamp),
								)
								.pipe(Effect.orDie)
							break
						}

						default: {
							yield* Effect.logInfo('Unhandled webhook event').pipe(
								Effect.annotateLogs({
									event: 'agentmail.webhook.ignored',
									eventType: payload.event_type,
								}),
							)
						}
					}

					return HttpServerResponse.jsonUnsafe({ ok: true })
				}),
			)
		}),
)
