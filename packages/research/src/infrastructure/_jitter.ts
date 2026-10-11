/**
 * Jitter between 80% and 120% of a schedule's delay, rounded to whole millis.
 * `Schedule.jittered` writes fractional millis, which break `TestClock` (its
 * nanos path throws on a non-integer tick); rounding keeps production behaviour
 * and lets the test clock stay whole.
 */

import { Duration, Effect, Schedule } from 'effect'

export const integerJitter = <O, I, E, R>(
	schedule: Schedule.Schedule<O, I, E, R>,
): Schedule.Schedule<O, I, E, R> =>
	Schedule.modifyDelay(schedule, metadata => {
		const ms = Duration.toMillis(metadata.duration)
		const jittered = ms * 0.8 + ms * 0.4 * Math.random()
		return Effect.succeed(Duration.millis(Math.round(jittered)))
	})
