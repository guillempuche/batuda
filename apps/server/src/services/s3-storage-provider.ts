import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Config, Effect, Layer, Redacted } from 'effect'

import { StorageError } from '@batuda/controllers'

import {
	type HeadResult,
	type PutParams,
	StorageProvider,
} from './storage-provider.js'

const errorMessage = (e: unknown): string =>
	e instanceof Error ? e.message : String(e)

export const S3StorageProviderLive = Layer.effect(
	StorageProvider,
	Effect.gen(function* () {
		const endpoint = yield* Config.string('STORAGE_ENDPOINT')
		const region = yield* Config.string('STORAGE_REGION')
		const accessKeyId = yield* Config.string('STORAGE_ACCESS_KEY_ID')
		const secretAccessKey = yield* Config.redacted('STORAGE_SECRET_ACCESS_KEY')
		const bucket = yield* Config.string('STORAGE_BUCKET')

		// `forcePathStyle: true` keeps a single code path working for both
		// MinIO (which only speaks path-style: `http://host/bucket/key`) and
		// Cloudflare R2 (which accepts both styles). Without this, dev hits
		// virtual-hosted-style URLs against MinIO and silently 404s.
		const client = new S3Client({
			endpoint,
			region,
			credentials: {
				accessKeyId,
				secretAccessKey: Redacted.value(secretAccessKey),
			},
			forcePathStyle: true,
		})

		const put = (params: PutParams): Effect.Effect<void, StorageError> =>
			Effect.tryPromise({
				try: () =>
					client.send(
						new PutObjectCommand({
							Bucket: bucket,
							Key: params.key,
							Body: params.body,
							ContentType: params.contentType,
							ContentLength: params.body.byteLength,
						}),
					),
				catch: e =>
					new StorageError({
						message: errorMessage(e),
						operation: 'put',
						key: params.key,
					}),
			}).pipe(Effect.asVoid)

		const get = (key: string): Effect.Effect<Uint8Array, StorageError> =>
			Effect.tryPromise({
				try: async () => {
					const response = await client.send(
						new GetObjectCommand({ Bucket: bucket, Key: key }),
					)
					if (!response.Body) {
						throw new Error(`empty body for object ${key}`)
					}
					// transformToByteArray is a Smithy convenience added in v3 — it
					// drains the underlying readable stream into a single Uint8Array.
					return await response.Body.transformToByteArray()
				},
				catch: e =>
					new StorageError({
						message: errorMessage(e),
						operation: 'get',
						key,
					}),
			})

		const del = (key: string): Effect.Effect<void, StorageError> =>
			Effect.tryPromise({
				try: () =>
					client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
				catch: e =>
					new StorageError({
						message: errorMessage(e),
						operation: 'delete',
						key,
					}),
			}).pipe(Effect.asVoid)

		const head = (key: string): Effect.Effect<HeadResult, StorageError> =>
			Effect.tryPromise({
				try: async () => {
					const response = await client.send(
						new HeadObjectCommand({ Bucket: bucket, Key: key }),
					)
					return {
						byteSize: response.ContentLength ?? 0,
						contentType: response.ContentType ?? 'application/octet-stream',
					} satisfies HeadResult
				},
				catch: e =>
					new StorageError({
						message: errorMessage(e),
						operation: 'head',
						key,
					}),
			})

		const signedUrl = (
			key: string,
			expiresInSeconds: number,
		): Effect.Effect<string, StorageError> =>
			Effect.tryPromise({
				try: () =>
					getSignedUrl(
						client,
						new GetObjectCommand({ Bucket: bucket, Key: key }),
						{ expiresIn: expiresInSeconds },
					),
				catch: e =>
					new StorageError({
						message: errorMessage(e),
						operation: 'presign',
						key,
					}),
			})

		return StorageProvider.of({
			put,
			get,
			delete: del,
			head,
			signedUrl,
		})
	}),
)
