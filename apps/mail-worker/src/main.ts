import { NodeRuntime } from '@effect/platform-node'
import { Effect, type Fiber, Layer, Ref, Schedule } from 'effect'

import { type ClaimedInbox, claimAvailableInboxes } from './claim.js'
import { PgLive } from './db.js'
import { CredentialDecryptor } from './decrypt.js'
import { WorkerEnvVars } from './env.js'
import { runInboxSession } from './inbox-session.js'
import { RawMessageStorage } from './storage.js'

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
		yield* reapFinished
		const claimed: readonly ClaimedInbox[] = yield* claimAvailableInboxes.pipe(
			Effect.catchCause(cause =>
				Effect.logError(cause).pipe(
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

const Live = Layer.mergeAll(
	CredentialDecryptor.layer,
	RawMessageStorage.layer,
	PgLive,
).pipe(Layer.provideMerge(WorkerEnvVars.layer))

NodeRuntime.runMain(
	Effect.scoped(program).pipe(Effect.provide(Live)) as unknown as Effect.Effect<
		void,
		unknown,
		never
	>,
)
