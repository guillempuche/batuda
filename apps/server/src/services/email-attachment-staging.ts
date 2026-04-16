import { randomUUID } from 'node:crypto'

import { Effect, Layer, ServiceMap } from 'effect'

import { BadRequest } from '@engranatge/controllers'

import type { SendAttachmentInput } from './email-provider.js'

// Outbound-attachment staging. The composer uploads files via multipart
// *before* sending, so the user can preview sizes, remove chips, or abandon
// the draft — sending happens as a final JSON call with `{ stagingId }` refs.
// We hold the bytes in a short-lived in-process map so the send handler can
// resolve them to base64 SendAttachmentInput entries and hand them to the
// provider. Entries self-expire so a discarded draft does not leak memory.

const TTL_MS = 10 * 60 * 1000 // 10 minutes
const MAX_BYTES = 25 * 1024 * 1024 // AgentMail per-message ceiling

export interface StagedAttachment {
	readonly stagingId: string
	readonly filename: string
	readonly contentType: string
	readonly size: number
	readonly contentBase64: string
	readonly createdAt: number
}

export interface StagedAttachmentPublic {
	readonly stagingId: string
	readonly filename: string
	readonly contentType: string
	readonly size: number
}

export class EmailAttachmentStaging extends ServiceMap.Service<EmailAttachmentStaging>()(
	'EmailAttachmentStaging',
	{
		make: Effect.sync(() => {
			const store = new Map<string, StagedAttachment>()

			const prune = () => {
				const cutoff = Date.now() - TTL_MS
				for (const [id, entry] of store) {
					if (entry.createdAt < cutoff) store.delete(id)
				}
			}

			const stage = (input: {
				bytes: Uint8Array
				filename: string
				contentType: string
			}): Effect.Effect<StagedAttachmentPublic, BadRequest> =>
				Effect.gen(function* () {
					prune()
					if (input.bytes.byteLength > MAX_BYTES) {
						return yield* new BadRequest({
							message: `Attachment ${input.filename} exceeds 25MB limit`,
						})
					}
					const stagingId = `stg_${randomUUID()}`
					// Buffer.from() accepts Uint8Array directly; avoids an extra copy.
					const contentBase64 = Buffer.from(input.bytes).toString('base64')
					const entry: StagedAttachment = {
						stagingId,
						filename: input.filename,
						contentType: input.contentType,
						size: input.bytes.byteLength,
						contentBase64,
						createdAt: Date.now(),
					}
					store.set(stagingId, entry)
					return {
						stagingId,
						filename: entry.filename,
						contentType: entry.contentType,
						size: entry.size,
					}
				})

			// Pop bytes out of the store — a stagingId is single-use so a
			// resend cannot accidentally re-attach the same payload.
			const resolve = (
				stagingIds: readonly string[],
			): Effect.Effect<readonly SendAttachmentInput[], BadRequest> =>
				Effect.gen(function* () {
					prune()
					const out: SendAttachmentInput[] = []
					for (const id of stagingIds) {
						const entry = store.get(id)
						if (!entry) {
							return yield* new BadRequest({
								message: `Staging id ${id} not found or expired`,
							})
						}
						store.delete(id)
						out.push({
							filename: entry.filename,
							contentType: entry.contentType,
							contentBase64: entry.contentBase64,
						})
					}
					return out
				})

			return { stage, resolve } as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
