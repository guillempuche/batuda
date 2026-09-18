import { type Duration, Effect, Layer, Schedule } from 'effect'

/**
 * A pulse that says the process is still alive, once a minute.
 *
 * Requests cannot stand in for it: whole quarter-hours pass overnight with no
 * traffic at all, so a watch on request volume would cry wolf on a quiet night
 * and stay silent on a dead process. This pulse does not depend on anyone
 * calling us. /health cannot stand in for it either — it only answers when
 * someone asks, and between deploys nobody does.
 *
 * Deliberately at `info`: raising MIN_LOG_LEVEL above it removes the only
 * ongoing sign that this process is running.
 */
export const makeHeartbeatDaemon = (interval: Duration.Input) =>
	Layer.effectDiscard(
		Effect.logInfo('server heartbeat').pipe(
			Effect.annotateLogs({ event: 'server.heartbeat' }),
			// Emits once straight away, so a process that dies early still leaves a
			// mark of having started.
			Effect.repeat(Schedule.spaced(interval)),
			Effect.forkScoped,
		),
	)

export const heartbeatDaemonLayer = makeHeartbeatDaemon('60 seconds')
