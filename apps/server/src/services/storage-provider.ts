import { type Effect, ServiceMap } from 'effect'

import type { StorageError } from '@engranatge/controllers'

// ── Provider-agnostic interfaces ──

export interface PutParams {
	readonly key: string
	readonly body: Uint8Array
	readonly contentType: string
}

export interface HeadResult {
	readonly byteSize: number
	readonly contentType: string
}

// ── Abstract provider tag ──
//
// Concrete adapter today: `S3StorageProviderLive` (works against MinIO in
// dev and Cloudflare R2 in prod via the same path-style S3 API). Keeping
// the abstraction as a Tag means a future GCS/Azure/local-disk variant is
// a one-Layer swap, mirroring the EmailProvider pattern.
export class StorageProvider extends ServiceMap.Service<
	StorageProvider,
	{
		readonly put: (params: PutParams) => Effect.Effect<void, StorageError>
		readonly get: (key: string) => Effect.Effect<Uint8Array, StorageError>
		readonly delete: (key: string) => Effect.Effect<void, StorageError>
		readonly head: (key: string) => Effect.Effect<HeadResult, StorageError>
		// `expiresInSeconds` should be short enough that a leaked URL has a
		// small blast radius (e.g. 600s for a playback URL handed to the UI).
		readonly signedUrl: (
			key: string,
			expiresInSeconds: number,
		) => Effect.Effect<string, StorageError>
	}
>()('StorageProvider') {}
