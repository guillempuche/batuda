import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Context, Effect, Layer, Redacted } from 'effect'

import { WorkerEnvVars } from './env.js'

// A message's number is only its own within one folder, and two folders on the
// same server can be handed the same starting point — so the folder has to be
// part of what names a message here. Without it, message 7 of the sent folder
// is stored over message 7 of the inbox, and one of them is gone for good.
// Folder names travel over the wire and can hold anything, so they are reduced
// to what is safe in a key before use.
//
// Reducing them is many-to-one, though, which puts the same hazard back one step
// along: "Archive/2024" and "Archive 2024" both come out "Archive_2024", and the
// two folders' message 7 land on one name again. So a name that had anything taken
// out of it carries a short fingerprint of how it arrived, which makes the segment
// its own again. A name that needed nothing taken out keeps exactly the segment it
// always had, which is every folder tracked today.
const folderSegment = (folder: string): string => {
	const safe = folder.replace(/[^a-zA-Z0-9._-]/g, '_')
	if (safe === folder) return safe
	return `${safe}-${createHash('sha256').update(folder).digest('hex').slice(0, 8)}`
}

// S3-compatible object store (R2 in prod, MinIO in dev). The worker
// uploads raw RFC822 bytes under a stable key derived from inbox + folder +
// uidvalidity + uid so a re-fetch of the same UID overwrites in place
// (the bytes are identical) without spawning a duplicate object.
export const rawMessageKey = (args: {
	readonly organizationId: string
	readonly inboxId: string
	readonly folder: string
	readonly uidValidity: number
	readonly uid: number
}): string =>
	`messages/${args.organizationId}/${args.inboxId}/${folderSegment(args.folder)}/${args.uidValidity}/${args.uid}.eml`

// Per-attachment object key. Sibling of the raw RFC822 under the same
// message prefix, so a download is one GET (the read path never reaches
// for the parser). Index is the parsed-multipart position; the .bin
// suffix is opaque on the wire — the response Content-Type comes from
// the attachments JSONB metadata.
export const attachmentKey = (args: {
	readonly organizationId: string
	readonly inboxId: string
	readonly folder: string
	readonly uidValidity: number
	readonly uid: number
	readonly index: number
}): string =>
	`messages/${args.organizationId}/${args.inboxId}/${folderSegment(args.folder)}/${args.uidValidity}/${args.uid}/attachment-${args.index}.bin`

export class RawMessageStorage extends Context.Service<RawMessageStorage>()(
	'RawMessageStorage',
	{
		make: Effect.gen(function* () {
			const env = yield* WorkerEnvVars
			const client = new S3Client({
				endpoint: env.STORAGE_ENDPOINT,
				region: env.STORAGE_REGION,
				credentials: {
					accessKeyId: env.STORAGE_ACCESS_KEY_ID,
					secretAccessKey: Redacted.value(env.STORAGE_SECRET_ACCESS_KEY),
				},
				forcePathStyle: true,
			})
			const bucket = env.STORAGE_BUCKET

			return {
				putRaw: (key: string, body: Uint8Array) =>
					Effect.tryPromise({
						try: () =>
							client.send(
								new PutObjectCommand({
									Bucket: bucket,
									Key: key,
									Body: Buffer.from(body),
									ContentType: 'message/rfc822',
								}),
							),
						catch: err =>
							new Error(
								`storage.putRaw failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
							),
					}),
				putAttachment: (key: string, body: Uint8Array, contentType: string) =>
					Effect.tryPromise({
						try: () =>
							client.send(
								new PutObjectCommand({
									Bucket: bucket,
									Key: key,
									Body: Buffer.from(body),
									ContentType: contentType,
								}),
							),
						catch: err =>
							new Error(
								`storage.putAttachment failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
							),
					}),
			} as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
