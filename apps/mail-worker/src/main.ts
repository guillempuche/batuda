import { NodeRuntime } from '@effect/platform-node'
import { DateTime, Effect, type Fiber, Ref, Schedule } from 'effect'

import { boundedCause } from '@batuda/observability'

import { type ClaimedInbox, claimAvailableInboxes } from './claim.js'
import { installCrashGuards } from './crash-guards.js'
import { WorkerEnvVars } from './env.js'
import { runInboxSession } from './inbox-session.js'
import { Live } from './lib/live-layer.js'

// Top-level program: scan for unclaimed inboxes on a tick, fork a
// session fiber per newly-claimed inbox, and let session fibers retry
// internally on transient failure. A fiber exits only when the inbox
// is permanently disabled (auth_failed beyond retry) — at which point
// the advisory lock releases (next scan won't re-claim it because
// grant_status != 'connected'), and the inbox sits dormant until a
// user re-enters credentials and re-uploads to the server.
//
// Today the scan is purely time-based (5s tick); a future revision
// will add LISTEN inbox_changed so server-side createInbox /
// updateInbox / deleteInbox NOTIFYs wake the scan within ~1s instead
// of waiting up to a tick.
const program = Effect.gen(function* () {
	yield* Effect.logInfo('mail-worker: starting')
	const env = yield* WorkerEnvVars
	yield* Effect.logInfo(
		`mail-worker: env loaded (NODE_ENV=${env.NODE_ENV}, max_conn=${env.EMAIL_WORKER_MAX_CONNECTIONS})`,
	)

	// Track which inboxes already have a running session fiber so we
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
		const claimed: readonly ClaimedInbox[] = yield* claimAvailableInboxes.pipe(
			Effect.catchCause(cause =>
				Effect.logError(boundedCause(cause)).pipe(
					Effect.andThen(Effect.succeed([] as readonly ClaimedInbox[])),
				),
			),
		)
		if (claimed.length === 0) return
		const current = yield* Ref.get(running)
		const newlyForked = new Map(current)
		for (const inbox of claimed) {
			if (current.has(inbox.id)) continue
			yield* Effect.logInfo(
				`mail-worker: claimed inbox=${inbox.id} org=${inbox.organizationId}`,
			)
			const fiber = yield* Effect.forkChild(runInboxSession(inbox))
			newlyForked.set(
				inbox.id,
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

// Turn on the crash safety net before the worker starts: a rare low-level error
// (e.g. a dropped email connection) must be logged and the worker auto-restarted,
// not left silently dead — which would stop it watching every mailbox.
installCrashGuards()

NodeRuntime.runMain(Effect.scoped(program).pipe(Effect.provide(Live)))
