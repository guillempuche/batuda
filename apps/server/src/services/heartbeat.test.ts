import { type Duration, Effect, Layer, Logger, References } from 'effect'
import { describe, expect, it } from 'vitest'

import { heartbeatDaemonLayer, makeHeartbeatDaemon } from './heartbeat.js'

type Line = { readonly event: unknown; readonly level: string }

/** Keeps every line the layer writes, with the `event` it was tagged with. */
const recorder = () => {
	const lines: Array<Line> = []
	const logger = Logger.make<unknown, void>(options => {
		const annotations = options.fiber.getRef(References.CurrentLogAnnotations)
		lines.push({ event: annotations['event'], level: options.logLevel })
	})
	return { lines, layer: Logger.layer([logger]) }
}

const pulses = (lines: ReadonlyArray<Line>) =>
	lines.filter(line => line.event === 'server.heartbeat')

const settle = (ms: number) =>
	new Promise(resolve => {
		setTimeout(resolve, ms)
	})

/**
 * Waits for the forked pulse rather than assuming it beats a fixed sleep, so a
 * loaded machine cannot turn a working heartbeat into a red build.
 */
const waitForFirstPulse = async (lines: ReadonlyArray<Line>) => {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (pulses(lines).length > 0) return
		await settle(10)
	}
}

/** Builds the layer, runs `body` while it is alive, then tears it down. */
const withDaemon = async (
	layerUnderTest: Layer.Layer<never>,
	body: (lines: ReadonlyArray<Line>) => Promise<void>,
) => {
	const { lines, layer } = recorder()
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* Layer.build(layerUnderTest)
			yield* Effect.promise(() => body(lines))
		}).pipe(Effect.scoped, Effect.provide(layer)),
	)
	return lines
}

const runOnce = async (
	layerUnderTest: Layer.Layer<never> = heartbeatDaemonLayer,
) => withDaemon(layerUnderTest, waitForFirstPulse)

const fast: Duration.Input = '30 millis'

describe('makeHeartbeatDaemon', () => {
	describe('when the layer is built', () => {
		it('should pulse straight away', async () => {
			// GIVEN nothing but the layer itself — no traffic, no caller
			// WHEN it is built
			const lines = await runOnce()

			// THEN a pulse is already on the record, so a process that dies early
			// still leaves proof it ran
			expect(pulses(lines)).toHaveLength(1)
		})

		it('should tag the pulse with the event an absence alert watches', async () => {
			// GIVEN the alert matches on `event`, not on the message text
			// WHEN the layer runs
			const lines = await runOnce()

			// THEN the tag is the one the alert filters for
			expect(pulses(lines)[0]?.event).toBe('server.heartbeat')
		})

		it('should write at info, the level the deployed process keeps', async () => {
			// GIVEN production runs at MIN_LOG_LEVEL=Info, so anything below it
			// would never leave the process and the alert would read silence
			// WHEN the layer runs
			const lines = await runOnce()

			// THEN the pulse is at info
			expect(pulses(lines)[0]?.level).toBe('Info')
		})

		it('should keep pulsing on its interval, not just once', async () => {
			// GIVEN an alert counts pulses in a window, so one pulse at boot would
			// read as death a minute later
			// WHEN the daemon runs for several of its intervals
			const lines = await withDaemon(makeHeartbeatDaemon(fast), async () => {
				await settle(150)
			})

			// THEN it has pulsed repeatedly
			expect(pulses(lines).length).toBeGreaterThan(2)
		})
	})

	describe('when the scope that owns it closes', () => {
		it('should stop pulsing', async () => {
			// GIVEN a stopped process must read as gone, not linger as a fiber that
			// outlives it
			// WHEN the scope is closed and several intervals pass
			const lines = await withDaemon(makeHeartbeatDaemon(fast), async () => {
				await settle(60)
			})
			const atClose = pulses(lines).length
			await settle(150)

			// THEN nothing further arrives, though a live daemon would have pulsed
			// about five more times by now
			expect(atClose).toBeGreaterThan(0)
			expect(pulses(lines)).toHaveLength(atClose)
		})
	})
})
