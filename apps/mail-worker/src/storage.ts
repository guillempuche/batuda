import { Buffer } from 'node:buffer'

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Effect, Layer, Redacted, ServiceMap } from 'effect'

import { WorkerEnvVars } from './env.js'

// S3-compatible object store (R2 in prod, MinIO in dev). The worker
// uploads raw RFC822 bytes under a stable key derived from inbox +
// uidvalidity + uid so a re-fetch of the same UID overwrites in place
// (the bytes are identical) without spawning a duplicate object.
export const rawMessageKey = (args: {
	readonly organizationId: string
	readonly inboxId: string
	readonly uidValidity: number
	readonly uid: number
}): string =>
	`messages/${args.organizationId}/${args.inboxId}/${args.uidValidity}/${args.uid}.eml`

export class RawMessageStorage extends ServiceMap.Service<RawMessageStorage>()(
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
			} as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
