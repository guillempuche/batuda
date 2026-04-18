/**
 * Adapts the server-side `StorageProvider` (S3/R2/MinIO) to the
 * research-local `BlobStorage` port.
 *
 * Keeps the `@engranatge/research` package free of any server imports —
 * it only depends on its own `BlobStorage` port — while letting the
 * research runtime use the same object store the rest of the app uses
 * (scrape markdown cache, recordings, etc.).
 *
 * Errors from the underlying `StorageProvider` are re-raised as plain
 * defects since `BlobStorage`'s Effect signature is error-free — the
 * caller (`cached-scrape.ts`) maps them to `ProviderError` itself.
 */

import { Effect, Layer } from 'effect'

import { BlobStorage } from '@engranatge/research'

import { StorageProvider } from './storage-provider'

export const ResearchBlobStorageLive = Layer.effect(
	BlobStorage,
	Effect.gen(function* () {
		const storage = yield* StorageProvider
		return BlobStorage.of({
			put: (key, bytes, contentType) =>
				storage.put({ key, body: bytes, contentType }).pipe(Effect.orDie),
			get: key => storage.get(key).pipe(Effect.orDie),
		})
	}),
)
