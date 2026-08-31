// This record decides whether the process says telemetry is broken, so the
// cases that matter most are the ones where it must stay quiet: a quiet service
// exports nothing on two of its three signals, and anything reading "no export
// lately" as "export is broken" would cry wolf every night.

import { createServer, type Server } from 'node:http'

import { Duration, Effect } from 'effect'
import {
	FetchHttpClient,
	HttpClient,
	HttpClientRequest,
} from 'effect/unstable/http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
	type ExportHealth,
	exportReport,
	failingSignals,
	isFailing,
	makeExportHealth,
	observingHttpClient,
} from './export-health'

// A backend under the test's control: `status` picks what it answers with, and
// a `hang` request is accepted and then left open, which is the failure the
// exporter cannot see on its own.
let status = 200
let server: Server
let origin: string
const hungSockets: Array<import('node:net').Socket> = []

const startSink = () =>
	new Promise<Server>(resolve => {
		const created = createServer((request, response) => {
			request.resume()
			request.on('end', () => {
				if (request.url?.includes('hang') === true) {
					hungSockets.push(request.socket)
					return
				}
				response.writeHead(status)
				response.end('{}')
			})
		})
		created.listen(0, '127.0.0.1', () => resolve(created))
	})

/** Posts once through the wrapped client and records however it turned out. */
const post = (url: string, health: ExportHealth, timeout: Duration.Duration) =>
	Effect.gen(function* () {
		const inner = yield* HttpClient.HttpClient
		const client = observingHttpClient(inner, health, timeout)
		yield* client.execute(HttpClientRequest.post(url))
	}).pipe(
		Effect.catchCause(() => Effect.void),
		Effect.provide(FetchHttpClient.layer),
		Effect.runPromise,
	)

const second = Duration.seconds(1)

describe('the export health record', () => {
	beforeAll(async () => {
		server = await startSink()
		const address = server.address()
		if (address === null || typeof address === 'string')
			throw new Error('expected a TCP address for the sink')
		origin = `http://127.0.0.1:${address.port}`
	}, 30_000)

	afterAll(async () => {
		for (const socket of hungSockets) socket.destroy()
		server.closeAllConnections()
		await new Promise(resolve => server.close(resolve))
	})

	describe('when the backend accepts a batch', () => {
		it('should record the success and clear the failing streak', async () => {
			// GIVEN a signal that has already failed twice
			const health = makeExportHealth()
			health.recordFailure('traces', 'rejected', 500, 1_000)
			health.recordFailure('traces', 'rejected', 500, 2_000)

			// WHEN the next attempt is accepted
			status = 200
			await post(`${origin}/v1/traces`, health, second)

			// THEN the streak is gone and the success is dated
			const traces = health.snapshot().traces
			expect(traces.failingSince).toBeUndefined()
			expect(traces.consecutiveFailures).toBe(0)
			expect(traces.failure).toBeUndefined()
			expect(traces.lastSuccessAt).toBeTypeOf('number')
		})
	})

	describe('when the backend refuses a batch', () => {
		it('should call a rejected key unauthorized and keep the status', async () => {
			// GIVEN a backend that answers 401 — a missing or revoked API key
			const health = makeExportHealth()
			status = 401

			// WHEN a batch of traces is posted
			await post(`${origin}/v1/traces`, health, second)

			// THEN the reason names the key, and the status is kept alongside it
			const traces = health.snapshot().traces
			expect(traces.failure).toBe('unauthorized')
			expect(traces.status).toBe(401)
			expect(traces.consecutiveFailures).toBe(1)
			expect(traces.failingSince).toBeTypeOf('number')
		})

		it('should call a forbidden key unauthorized too', async () => {
			// GIVEN a backend that answers 403 — a key that exists but is not
			//       allowed to write here
			const health = makeExportHealth()
			status = 403

			// WHEN a batch of traces is posted
			await post(`${origin}/v1/traces`, health, second)

			// THEN it lands in the same bucket as a rejected key: the fix is the
			//      same either way
			expect(health.snapshot().traces.failure).toBe('unauthorized')
		})

		it('should call a 429 rate limited', async () => {
			// GIVEN a backend that answers 429 — over quota, or too fast
			const health = makeExportHealth()
			status = 429

			// WHEN a batch of logs is posted
			await post(`${origin}/v1/logs`, health, second)

			// THEN the reason says so
			expect(health.snapshot().logs.failure).toBe('rate_limited')
		})

		it('should call anything else it refused rejected', async () => {
			// GIVEN a backend that answers 500
			const health = makeExportHealth()
			status = 500

			// WHEN a batch of metrics is posted
			await post(`${origin}/v1/metrics`, health, second)

			// THEN the reason falls back to a plain refusal, with the status
			const metrics = health.snapshot().metrics
			expect(metrics.failure).toBe('rejected')
			expect(metrics.status).toBe(500)
		})
	})

	describe('when the backend cannot be reached at all', () => {
		it('should record it as unreachable', async () => {
			// GIVEN nothing listening on the port
			const health = makeExportHealth()

			// WHEN a batch is posted to it
			await post('http://127.0.0.1:1/v1/traces', health, second)

			// THEN it is unreachable, with no status to report
			const traces = health.snapshot().traces
			expect(traces.failure).toBe('unreachable')
			expect(traces.status).toBeUndefined()
		})

		it('should give up on a connection that is accepted and never answered', async () => {
			// GIVEN a backend that takes the request and then goes quiet — the case
			//       the exporter waits out for minutes without noticing
			const health = makeExportHealth()

			// WHEN a batch is posted with a deadline
			await post(`${origin}/v1/traces?hang=1`, health, Duration.millis(100))

			// THEN the deadline turns the silence into an ordinary failure
			expect(health.snapshot().traces.failure).toBe('unreachable')
		}, 15_000)
	})

	describe('when the configured endpoint already carries a query string', () => {
		it('should still tell which signal the batch belonged to', async () => {
			// GIVEN the URL the exporter builds in that case: it appends the signal
			//       name to the whole configured value, so the name lands inside the
			//       query rather than at the end of the path
			const health = makeExportHealth()
			status = 401

			// WHEN a batch goes out to it
			await post(`${origin}/otlp?api-key=redacted/v1/traces`, health, second)

			// THEN it is recorded against traces. Reading the parsed path instead
			//      would find no signal here and record nothing at all, leaving a
			//      dead backend looking healthy.
			expect(health.snapshot().traces.failure).toBe('unauthorized')
		})
	})

	describe('when one signal fails while another is accepted', () => {
		it('should report them independently', async () => {
			// GIVEN a backend that refuses everything
			const health = makeExportHealth()
			status = 401
			await post(`${origin}/v1/traces`, health, second)

			// WHEN it starts accepting, and only logs are posted
			status = 200
			await post(`${origin}/v1/logs`, health, second)

			// THEN traces is still failing and logs is not
			const snapshot = health.snapshot()
			expect(snapshot.traces.failure).toBe('unauthorized')
			expect(snapshot.logs.failure).toBeUndefined()
		})
	})

	describe('when failures follow one another', () => {
		it('should date the streak from where it began, not from the last try', () => {
			// GIVEN a signal failing since the first of three attempts
			const health = makeExportHealth()
			health.recordFailure('traces', 'unauthorized', 401, 1_000)
			health.recordFailure('traces', 'unauthorized', 401, 2_000)
			health.recordFailure('traces', 'unauthorized', 401, 3_000)

			// THEN the streak is measured from the first, and counts them all
			const traces = health.snapshot().traces
			expect(traces.failingSince).toBe(1_000)
			expect(traces.consecutiveFailures).toBe(3)
		})
	})
})

describe('deciding whether a signal is worth complaining about', () => {
	describe('when a signal has been failing for longer than the grace period', () => {
		it('should say so', () => {
			// GIVEN a signal failing since the start
			const health = makeExportHealth()
			health.recordFailure('traces', 'unauthorized', 401, 0)

			// THEN once the grace period has passed it counts as failing
			expect(
				isFailing(health.snapshot().traces, 120_000, Duration.minutes(2)),
			).toBe(true)
		})

		it('should stay quiet until the grace period has actually passed', () => {
			// GIVEN the same signal one millisecond short of the grace period
			const health = makeExportHealth()
			health.recordFailure('traces', 'unauthorized', 401, 0)

			// THEN it is not yet worth a line
			expect(
				isFailing(health.snapshot().traces, 119_999, Duration.minutes(2)),
			).toBe(false)
		})
	})

	describe('when a signal has never been tried', () => {
		it('should not read as failing', () => {
			// GIVEN a process that has exported nothing at all yet
			const health = makeExportHealth()

			// THEN no signal is failing, however long it has been
			expect(
				failingSignals(health.snapshot(), 86_400_000, Duration.minutes(2)),
			).toEqual([])
		})
	})

	describe('when a signal is idle after a success', () => {
		it('should stay healthy however long it has been quiet', () => {
			// GIVEN a signal that exported once and has had nothing to say since —
			//       a quiet service, not a broken one
			const health = makeExportHealth()
			health.recordSuccess('traces', 1_000)

			// THEN a day later it is still not failing
			expect(
				failingSignals(health.snapshot(), 86_400_000, Duration.minutes(2)),
			).toEqual([])
		})
	})

	describe('when a signal recovers', () => {
		it('should stop reading as failing straight away', () => {
			// GIVEN a signal that has been failing well past the grace period
			const health = makeExportHealth()
			health.recordFailure('traces', 'rate_limited', 429, 0)
			expect(
				isFailing(health.snapshot().traces, 300_000, Duration.minutes(2)),
			).toBe(true)

			// WHEN a batch is accepted
			health.recordSuccess('traces', 300_000)

			// THEN it is healthy again without waiting anything out
			expect(
				isFailing(health.snapshot().traces, 300_001, Duration.minutes(2)),
			).toBe(false)
		})
	})

	describe('when asked what to report from outside', () => {
		it('should say a process with export switched off is not exporting', () => {
			// GIVEN a process with no endpoint configured
			const health = makeExportHealth()
			health.setExporting(false)

			// THEN it says so, rather than looking like one with nothing to send
			const report = exportReport(health, 200_000)
			expect(report.exporting).toBe(false)
			expect(report.signals.traces.failing).toBe(false)
		})

		it('should say a process that has sent nothing yet is exporting fine', () => {
			// GIVEN export configured, and a service quiet since it started
			const health = makeExportHealth()
			health.setExporting(true)

			// THEN it is exporting, and nothing is held against any signal
			const report = exportReport(health, 86_400_000)
			expect(report.exporting).toBe(true)
			expect(report.signals.traces.failing).toBe(false)
			expect(report.signals.logs.failing).toBe(false)
			expect(report.signals.metrics.failing).toBe(false)
		})

		it('should name the reason for a signal that has been failing', () => {
			// GIVEN traces refused since boot, past the grace period
			const health = makeExportHealth()
			health.setExporting(true)
			health.recordFailure('traces', 'unauthorized', 401, 0)

			// THEN that signal is failing and says why, and the others are not
			const report = exportReport(health, 200_000)
			expect(report.signals.traces.failing).toBe(true)
			expect(report.signals.traces.failure).toBe('unauthorized')
			expect(report.signals.logs.failing).toBe(false)
		})

		it('should hold back on a signal that has only just started failing', () => {
			// GIVEN a single refused batch a moment ago — a blip, not an outage
			const health = makeExportHealth()
			health.setExporting(true)
			health.recordFailure('traces', 'rejected', 503, 190_000)

			// THEN it is not called failing yet, though the reason is already there
			const report = exportReport(health, 200_000)
			expect(report.signals.traces.failing).toBe(false)
			expect(report.signals.traces.failure).toBe('rejected')
		})

		it('should carry no status line and no backend host', () => {
			// GIVEN a signal refused with a status the backend chose
			const health = makeExportHealth()
			health.setExporting(true)
			health.recordFailure('traces', 'rejected', 503, 0)

			// THEN what goes out names the reason and nothing else about the call
			const report = exportReport(health, 200_000)
			expect(Object.keys(report).sort()).toEqual(['exporting', 'signals'])
			expect(Object.keys(report.signals.traces).sort()).toEqual([
				'failing',
				'failure',
			])
		})
	})

	describe('when several signals are failing', () => {
		it('should name each of them', () => {
			// GIVEN traces and metrics failing while logs is fine
			const health = makeExportHealth()
			health.recordFailure('traces', 'unauthorized', 401, 0)
			health.recordFailure('metrics', 'unreachable', undefined, 0)
			health.recordSuccess('logs', 0)

			// THEN both are named, in a stable order
			expect(
				failingSignals(health.snapshot(), 200_000, Duration.minutes(2)),
			).toEqual(['traces', 'metrics'])
		})
	})
})
