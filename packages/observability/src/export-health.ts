import { Clock, Duration, Effect } from 'effect'
import { HttpClient, HttpClientError } from 'effect/unstable/http'

/**
 * The three kinds of telemetry, each posted to its own path under the base URL.
 * They fail independently — a backend can take our logs and refuse our traces —
 * so each is tracked on its own rather than behind one "is export working" flag.
 */
export type ExportSignal = 'traces' | 'logs' | 'metrics'

export const exportSignals: ReadonlyArray<ExportSignal> = [
	'traces',
	'logs',
	'metrics',
]

/**
 * Why a batch did not land, in the few kinds worth telling apart when deciding
 * what to do about it.
 *
 * A closed set on purpose: keeping whatever the backend said would hand back
 * text derived from our own request, and that request carries the API key in a
 * header. A fixed set is safe to write anywhere without reading it first.
 */
export type ExportFailure =
	| 'unauthorized'
	| 'rate_limited'
	| 'rejected'
	| 'unreachable'

export interface SignalHealth {
	readonly lastAttemptAt: number | undefined
	readonly lastSuccessAt: number | undefined
	/**
	 * When the current run of failures started, cleared by any success. Present
	 * means the last attempt failed — a different question from "how long since
	 * something arrived".
	 */
	readonly failingSince: number | undefined
	readonly consecutiveFailures: number
	readonly failure: ExportFailure | undefined
	readonly status: number | undefined
}

export type ExportSnapshot = Readonly<Record<ExportSignal, SignalHealth>>

export interface ExportHealth {
	readonly recordSuccess: (signal: ExportSignal, at: number) => void
	readonly recordFailure: (
		signal: ExportSignal,
		failure: ExportFailure,
		status: number | undefined,
		at: number,
	) => void
	/**
	 * Whether this process is set up to export at all. Not something the attempts
	 * can answer: a process with export switched off and one that simply has
	 * nothing to send both make no attempts.
	 */
	readonly setExporting: (exporting: boolean) => void
	readonly snapshot: () => ExportSnapshot
	readonly exporting: () => boolean
	/**
	 * How far this process's clock sits from the backend's, in milliseconds,
	 * positive when we are ahead. `undefined` until a reply has been read.
	 */
	readonly recordClockOffset: (offsetMs: number) => void
	readonly clockOffset: () => number | undefined
}

const untried: SignalHealth = {
	lastAttemptAt: undefined,
	lastSuccessAt: undefined,
	failingSince: undefined,
	consecutiveFailures: 0,
	failure: undefined,
	status: undefined,
}

/**
 * A running tally of how the last export attempt on each signal went.
 *
 * Deliberately plain and mutable: it is written from inside the export path,
 * where anything that allocates or suspends is paid for on every batch.
 */
export const makeExportHealth = (): ExportHealth => {
	const state: Record<ExportSignal, SignalHealth> = {
		traces: untried,
		logs: untried,
		metrics: untried,
	}
	let exporting = false
	let clockOffset: number | undefined

	return {
		setExporting: next => {
			exporting = next
		},
		exporting: () => exporting,
		recordClockOffset: offsetMs => {
			clockOffset = offsetMs
		},
		clockOffset: () => clockOffset,
		recordSuccess: (signal, at) => {
			state[signal] = {
				lastAttemptAt: at,
				lastSuccessAt: at,
				failingSince: undefined,
				consecutiveFailures: 0,
				failure: undefined,
				status: undefined,
			}
		},
		recordFailure: (signal, failure, status, at) => {
			const previous = state[signal]
			state[signal] = {
				lastAttemptAt: at,
				lastSuccessAt: previous.lastSuccessAt,
				// Kept from the previous failure so the run is measured from where it
				// began, not from the most recent attempt in it.
				failingSince: previous.failingSince ?? at,
				consecutiveFailures: previous.consecutiveFailures + 1,
				failure,
				status,
			}
		},
		snapshot: () => ({ ...state }),
	}
}

/**
 * The record for this process, shared by everything that reports on it. A
 * single value rather than a service, like `buildMeta` beside it: both are
 * facts about the running process that outlive any one layer, and a service
 * would have to exist even in the processes that export nothing.
 */
export const exportHealth: ExportHealth = makeExportHealth()

/**
 * Whether a signal has been failing long enough to be worth saying out loud.
 *
 * Reads "the last attempt failed and has kept failing", never "nothing has
 * arrived lately": the exporter skips an empty batch, so a quiet process sends
 * no logs or traces at all and a staleness test would call it broken. Metrics
 * posts every interval regardless, so a genuinely dead channel still shows.
 */
export const isFailing = (
	state: SignalHealth,
	now: number,
	after: Duration.Duration,
): boolean =>
	state.failingSince !== undefined &&
	now - state.failingSince >= Duration.toMillis(after)

/** Which signals in a snapshot have been failing for longer than `after`. */
export const failingSignals = (
	snapshot: ExportSnapshot,
	now: number,
	after: Duration.Duration,
): ReadonlyArray<ExportSignal> =>
	exportSignals.filter(signal => isFailing(snapshot[signal], now, after))

/**
 * How long a run of failures has to last before it counts: long enough that one
 * refused batch during a blip is not news, short enough to hear about it while
 * it still matters. Keep it comfortably above the slowest signal's export
 * interval, so a channel has had more than one chance to prove it is down.
 */
export const defaultFailingAfter: Duration.Duration = Duration.minutes(2)

/**
 * How far our clock may sit from the backend's before it is worth saying so.
 *
 * Generous on purpose. The reply's clock has one-second resolution and the
 * round trip adds more, so a healthy process is always off by a little. What
 * this is looking for is not drift but a clock that stopped: a machine paused
 * and resumed keeps the time it went to sleep with, and comes back hours out.
 */
export const defaultClockTolerance: Duration.Duration = Duration.minutes(2)

/**
 * Whether this process and the backend disagree about the time by more than
 * they should.
 *
 * Worth its own check because a wrong clock is invisible to everything else
 * here: the batches are accepted, so nothing fails and nothing is retried. What
 * breaks is the reading — every span arrives stamped at the wrong moment, so
 * any question about a recent window comes back empty and the process looks
 * idle rather than misconfigured. That is what happened on 2026-08-31.
 */
export const isClockSkewed = (
	offsetMs: number | undefined,
	tolerance: Duration.Duration,
): boolean =>
	offsetMs !== undefined && Math.abs(offsetMs) > Duration.toMillis(tolerance)

export interface SignalReport {
	readonly failing: boolean
	readonly failure?: ExportFailure
	readonly lastSuccessAt?: number
}

export interface ExportReport {
	readonly exporting: boolean
	/** Seconds this process's clock sits ahead of the backend's; negative behind. */
	readonly clockOffsetSeconds?: number
	readonly signals: Readonly<Record<ExportSignal, SignalReport>>
}

/**
 * What this process would say about its own telemetry if asked from outside.
 *
 * Carries the reason but not the backend's own words, the host, or the status
 * line: this is read without authentication, and the closed set of reasons is
 * enough to tell a rejected key from a quota from a dead route.
 */
const reportOf = (state: SignalHealth, now: number): SignalReport => ({
	failing: isFailing(state, now, defaultFailingAfter),
	...(state.failure === undefined ? {} : { failure: state.failure }),
	...(state.lastSuccessAt === undefined
		? {}
		: { lastSuccessAt: state.lastSuccessAt }),
})

export const exportReport = (
	health: ExportHealth,
	now: number,
): ExportReport => {
	const snapshot = health.snapshot()
	const offsetMs = health.clockOffset()

	// Written out rather than built from the list of signals: building it needs a
	// cast to claim all three keys are there, and a cast would let a dropped
	// signal go out missing from the report with nothing complaining.
	return {
		exporting: health.exporting(),
		// Rounded to seconds: the reply's clock has no finer resolution, and a
		// millisecond figure would read as precision that is not there.
		...(offsetMs === undefined
			? {}
			: { clockOffsetSeconds: Math.round(offsetMs / 1000) }),
		signals: {
			traces: reportOf(snapshot.traces, now),
			logs: reportOf(snapshot.logs, now),
			metrics: reportOf(snapshot.metrics, now),
		},
	}
}

/**
 * Reads the backend's own clock off its reply and keeps how far ours sits from
 * it.
 *
 * Every HTTP reply carries a `Date`, so this costs no extra request and no
 * extra dependency — the one thing we already do constantly is talk to a
 * machine that knows the time. Treated as a number and nothing else: it is a
 * value from outside, so an unreadable one is ignored rather than trusted.
 */
const readClock = (
	dateHeader: string | undefined,
	ourTime: number,
	health: ExportHealth,
): void => {
	if (dateHeader === undefined) return
	const theirTime = Date.parse(dateHeader)
	if (Number.isNaN(theirTime)) return
	health.recordClockOffset(ourTime - theirTime)
}

const failureOfStatus = (status: number): ExportFailure => {
	if (status === 401 || status === 403) return 'unauthorized'
	if (status === 429) return 'rate_limited'
	return 'rejected'
}

/**
 * Whether a URL is the one the exporter posts this signal to.
 *
 * Checked against the whole URL as well as against it with any query stripped,
 * because the signal name can land on either side of a `?`. The exporter
 * appends the name to whatever the endpoint is configured as, so a base that
 * already carries a query leaves the name inside that query rather than at the
 * end of the path. Testing only the path would recognise no signal there and
 * record nothing at all — a dead backend reading as a healthy one, which is the
 * outcome this whole file exists to prevent.
 */
const posts = (url: string, signalPath: string): boolean =>
	url.endsWith(signalPath) || (url.split('?')[0] ?? url).endsWith(signalPath)

const signalOfUrl = (url: string): ExportSignal | undefined => {
	if (posts(url, '/v1/traces')) return 'traces'
	if (posts(url, '/v1/logs')) return 'logs'
	if (posts(url, '/v1/metrics')) return 'metrics'
	return undefined
}

/**
 * Wraps the client the OTLP exporter posts through, so every batch leaves a
 * record of how it went — and so a hung connection cannot pass for a healthy
 * one.
 *
 * The exporter reports a refused batch at debug level and nothing else, which a
 * process running at info drops before any logger sees it. It also sets no
 * deadline, so a backend that takes the data and never answers ties the batch
 * up for the HTTP library's five-minute ceiling — minutes in which the exporter
 * believes it is still in flight, never trips its back-off and says nothing.
 * `timeout` turns that silence into an ordinary transport failure.
 *
 * Records only, never logs: this runs on every attempt of every retry of all
 * three signals, so a line written here would arrive several times a second
 * while a backend is down.
 */
export const observingHttpClient = (
	client: HttpClient.HttpClient,
	health: ExportHealth,
	timeout: Duration.Duration,
): HttpClient.HttpClient =>
	HttpClient.transform(client, (effect, request) => {
		const deadlined = effect.pipe(
			Effect.timeout(timeout),
			// Back to a transport failure, the shape the caller already has: a
			// widened error channel here would no longer be an `HttpClient`.
			Effect.catchTag('TimeoutError', () =>
				Effect.fail(
					new HttpClientError.HttpClientError({
						reason: new HttpClientError.TransportError({
							request,
							description: 'timed out waiting for the telemetry backend',
						}),
					}),
				),
			),
		)

		// The deadline is applied above whatever this is, so a post that cannot be
		// tied to a signal still cannot hang; only the recording needs to know
		// which signal it belongs to.
		const signal = signalOfUrl(request.url)
		if (signal === undefined) return deadlined

		return deadlined.pipe(
			Effect.tap(response =>
				Effect.map(Clock.currentTimeMillis, at => {
					// Read below `filterStatusOk`, which the exporter applies on top of
					// this client — so the real status arrives here, refusals included.
					if (response.status >= 200 && response.status < 300) {
						health.recordSuccess(signal, at)
						readClock(response.headers['date'], at, health)
					} else
						health.recordFailure(
							signal,
							failureOfStatus(response.status),
							response.status,
							at,
						)
				}),
			),
			// A post cut short by the process shutting down is not recorded as a
			// failure: an interrupted fiber never runs this handler, so the last
			// thing a process does on its way out cannot leave it looking broken.
			Effect.tapCause(() =>
				Effect.map(Clock.currentTimeMillis, at =>
					health.recordFailure(signal, 'unreachable', undefined, at),
				),
			),
		)
	})
