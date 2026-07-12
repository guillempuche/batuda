/**
 * Adapts the server-side `StorageProvider` (S3/R2/MinIO) to the
 * research-local `BlobStorage` port.
 *
 * Keeps the `@batuda/research` package free of any server imports —
 * it only depends on its own `BlobStorage` port — while letting the
 * research runtime use the same object store the rest of the app uses
 * (scrape markdown cache, recordings, etc.).
 *
 * A `StorageProvider` failure is mapped to a typed `ProviderError` (provider
 * `cache`) rather than raised as a defect. That classification is what lets the
 * scrape cache (`cached-scrape.ts`) recover from a broken read — degrading to a
 * fresh fetch — instead of failing the whole scrape and denying the model the
 * page. `StorageProvider` still logs and traces the failure before it reaches
 * here, so this only adds a typed error channel; it drops nothing.
 */

import { Effect, Layer } from 'effect'

import { BlobStorage, ProviderError } from '@batuda/research'

import { StorageProvider } from './storage-provider'

export const ResearchBlobStorageLive = Layer.effect(
	BlobStorage,
	Effect.gen(function* () {
		const storage = yield* StorageProvider
		return BlobStorage.of({
			put: (key, bytes, contentType) =>
				storage.put({ key, body: bytes, contentType }).pipe(
					Effect.mapError(
						error =>
							new ProviderError({
								provider: 'cache',
								message: `blob put failed for ${key}: ${error.message}`,
								recoverable: false,
							}),
					),
				),
			get: key =>
				storage.get(key).pipe(
					Effect.mapError(
						error =>
							new ProviderError({
								provider: 'cache',
								message: `blob get failed for ${key}: ${error.message}`,
								recoverable: false,
							}),
					),
				),
		})
	}),
)
