import { Config, Effect, Layer, ServiceMap } from 'effect'

// Mail-worker process env. Kept separate from apps/server so the worker
// can be deployed independently (different machine pool, longer-lived
// connections, no inbound HTTP). Names are vendor-neutral per the
// project's env-var convention — STORAGE_* / EMAIL_* describe the
// capability, not the provider.
export class WorkerEnvVars extends ServiceMap.Service<WorkerEnvVars>()(
	'WorkerEnvVars',
	{
		make: Effect.gen(function* () {
			const DATABASE_URL = yield* Config.redacted('DATABASE_URL')
			const NODE_ENV = yield* Config.string('NODE_ENV').pipe(
				Config.withDefault('development'),
			)
			const MIN_LOG_LEVEL = yield* Config.string('MIN_LOG_LEVEL').pipe(
				Config.withDefault('Info'),
			)

			// Same R2/MinIO bucket the server writes drafts/attachments to —
			// raw RFC822 lives under `messages/<org>/<inbox>/<uidvalidity>/<uid>.eml`.
			const STORAGE_ENDPOINT = yield* Config.string('STORAGE_ENDPOINT')
			const STORAGE_REGION = yield* Config.string('STORAGE_REGION')
			const STORAGE_ACCESS_KEY_ID = yield* Config.string(
				'STORAGE_ACCESS_KEY_ID',
			)
			const STORAGE_SECRET_ACCESS_KEY = yield* Config.redacted(
				'STORAGE_SECRET_ACCESS_KEY',
			)
			const STORAGE_BUCKET = yield* Config.string('STORAGE_BUCKET')

			// Same master key as the server — credential rows are encrypted at
			// write time by the server (createInbox/updateInbox) and decrypted
			// here at session-establishment time. A mismatch fails decryption.
			const EMAIL_CREDENTIAL_KEY = yield* Config.redacted(
				'EMAIL_CREDENTIAL_KEY',
			)

			// Per-worker IMAP connection cap. One process can hold a few
			// hundred IDLEs comfortably; sharding across replicas happens via
			// pg_advisory_lock so a hard cap keeps each replica honest.
			const EMAIL_WORKER_MAX_CONNECTIONS = yield* Config.int(
				'EMAIL_WORKER_MAX_CONNECTIONS',
			).pipe(Config.withDefault(50))

			// Initial fetch horizon when an inbox is first connected. 30 days
			// is enough for "yesterday's thread" while keeping the first sync
			// bounded; UI users can request a deeper backfill via a manual op.
			const EMAIL_WORKER_BACKFILL_DAYS = yield* Config.int(
				'EMAIL_WORKER_BACKFILL_DAYS',
			).pipe(Config.withDefault(30))

			// Re-issue IDLE before this many seconds elapse. RFC 2177 caps
			// IDLE at 30 minutes; we re-issue at 29 to leave slack for clock
			// skew between us and the server.
			const EMAIL_WORKER_IDLE_TIMEOUT_SEC = yield* Config.int(
				'EMAIL_WORKER_IDLE_TIMEOUT_SEC',
			).pipe(Config.withDefault(1740))

			return {
				DATABASE_URL,
				NODE_ENV,
				MIN_LOG_LEVEL,
				STORAGE_ENDPOINT,
				STORAGE_REGION,
				STORAGE_ACCESS_KEY_ID,
				STORAGE_SECRET_ACCESS_KEY,
				STORAGE_BUCKET,
				EMAIL_CREDENTIAL_KEY,
				EMAIL_WORKER_MAX_CONNECTIONS,
				EMAIL_WORKER_BACKFILL_DAYS,
				EMAIL_WORKER_IDLE_TIMEOUT_SEC,
			} as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
