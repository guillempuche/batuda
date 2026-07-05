import { NodeRuntime } from '@effect/platform-node'
import { DateTime, Effect, type Fiber, Layer, Ref, Schedule } from 'effect'

import { ParticipantMatcher } from '@batuda/communications'
import { makeOtlpObservability } from '@batuda/observability'

import { type ClaimedMailbox, claimAvailableMailboxes } from './claim.js'
import { installCrashGuards } from './crash-guards.js'
import { PgLive } from './db.js'
import { CredentialDecryptor } from './decrypt.js'
import { WorkerEnvVars } from './env.js'
import { ConfigFileLive } from './lib/config-provider.js'
import { runMailboxSession } from './mailbox-session.js'
import { RawMessageStorage } from './storage.js'

// Top-level program: scan for unclaimed mailboxes on a tick, fork a
// session fiber per newly-claimed mailbox, and let session fibers retry
// internally on transient failure. A fiber exits only when the mailbox
// is permanently disabled (auth_failed beyond retry) — at which point
// the advisory lock releases (next scan won't re-claim it because
// grant_status != 'connected'), and the mailbox sits dormant until a
// user re-enters credentials and re-uploads to the server.
//
// Today the scan is purely time-based (5s tick); a future revision
// will add LISTEN mailbox_changed so server-side createMailbox /
// updateMailbox / deleteMailbox NOTIFYs wake the scan within ~1s instead
// of waiting up to a tick.
const program = Effect.gen(function* () {
	yield* Effect.logInfo('mail-worker: starting')
	const env = yield* WorkerEnvVars
	yield* Effect.logInfo(
		`mail-worker: env loaded (NODE_ENV=${env.NODE_ENV}, max_conn=${env.EMAIL_WORKER_MAX_CONNECTIONS})`,
	)

	// Track which mailboxes already have a running session fiber so we
	// don't double-claim within the same process. Across processes the
	// pg_advisory_lock is the source of truth.
	const running = yield* Ref.make<Map<string, Fiber.Fiber<unknown, unknown>>>(
		new Map(),
	)

	// Liveness signal. A dead/crash-looping worker exports no telemetry, so a
	// Honeycomb absence trigger watches for a gap in this event. The scan tick
	// fires every 5s; throttle the heartbeat to ~1/min so it stays a cheap
	// "still alive" pulse rather than per-tick noise. Starts at 0 so the first
	// tick emits immediately (a boot heartbeat).
	const HEARTBEAT_INTERVAL_MS = 60_000
	const lastHeartbeatAt = yield* Ref.make(0)
	const emitHeartbeat = Effect.gen(function* () {
		const now = DateTime.toEpochMillis(DateTime.nowUnsafe())
		if (now - (yield* Ref.get(lastHeartbeatAt)) < HEARTBEAT_INTERVAL_MS) return
		yield* Ref.set(lastHeartbeatAt, now)
		yield* Effect.logInfo('mail-worker heartbeat').pipe(
			Effect.annotateLogs({ event: 'mail_worker.heartbeat' }),
		)
	})

	const reapFinished = Effect.gen(function* () {
		const current = yield* Ref.get(running)
		const next = new Map(current)
		for (const [id, fiber] of current) {
			// pollUnsafe returns undefined while the fiber is still running,
			// or the Exit when it has finished. Either way we never block.
			if (fiber.pollUnsafe() !== undefined) {
				next.delete(id)
			}
		}
		yield* Ref.set(running, next)
	})

	const tick: Effect.Effect<void, never, never> = Effect.gen(function* () {
		yield* emitHeartbeat
		yield* reapFinished
		const claimed: readonly ClaimedMailbox[] =
			yield* claimAvailableMailboxes.pipe(
				Effect.catchCause(cause =>
					Effect.logError(cause).pipe(
						Effect.andThen(Effect.succeed([] as readonly ClaimedMailbox[])),
					),
				),
			)
		if (claimed.length === 0) return
		const current = yield* Ref.get(running)
		const newlyForked = new Map(current)
		for (const mailbox of claimed) {
			if (current.has(mailbox.id)) continue
			yield* Effect.logInfo(
				`mail-worker: claimed mailbox=${mailbox.id} org=${mailbox.organizationId}`,
			)
			const fiber = yield* Effect.forkChild(runMailboxSession(mailbox))
			newlyForked.set(
				mailbox.id,
				fiber as unknown as Fiber.Fiber<unknown, unknown>,
			)
		}
		yield* Ref.set(running, newlyForked)
	}) as unknown as Effect.Effect<void, never, never>

	yield* tick.pipe(
		Effect.repeat(Schedule.spaced('5 seconds')),
		Effect.forkScoped,
	)

	// Park the main fiber. Session fibers run in the background; the
	// process stays alive until SIGTERM/SIGINT lands NodeRuntime's
	// shutdown sequence, which interrupts everything cleanly.
	yield* Effect.never
})

const Live = Layer.mergeAll(
	CredentialDecryptor.layer,
	RawMessageStorage.layer,
	ParticipantMatcher.layer,
).pipe(
	// ParticipantMatcher reads contacts/companies via SqlClient, so PgLive must
	// be PROVIDED to the merged layers — `mergeAll` alongside it leaves that
	// requirement unsatisfied. provideMerge also re-exposes SqlClient for the
	// mailbox claim/session queries run by `program`.
	Layer.provideMerge(PgLive),
	Layer.provideMerge(WorkerEnvVars.layer),
	// Export traces, logs, and metrics to the batuda-mail-worker Honeycomb
	// dataset when OTEL_EXPORTER_OTLP_ENDPOINT is set. Without this the worker's
	// IMAP disconnects, credential failures, and session-fiber deaths die in the
	// console ring-buffer. Sits above ConfigFileLive so it can read NODE_ENV +
	// the OTEL_* settings; merges with the default console logger, not replacing it.
	Layer.provide(makeOtlpObservability({ serviceName: 'batuda-mail-worker' })),
	// Install the baked-file config values before the readers above resolve, so
	// the env-var layer and the database client can read non-secret settings
	// that no longer travel on the boot command line.
	Layer.provide(ConfigFileLive),
)

// Turn on the crash safety net before the worker starts: a rare low-level error
// (e.g. a dropped email connection) must be logged and the worker auto-restarted,
// not left silently dead — which would stop it watching every mailbox.
installCrashGuards()

NodeRuntime.runMain(Effect.scoped(program).pipe(Effect.provide(Live)))
