import { Clock, Config, Duration, Effect, Layer, Tracer } from 'effect'
import { FetchHttpClient, HttpClient } from 'effect/unstable/http'
import { Otlp } from 'effect/unstable/observability'

import { buildMeta } from './build-meta'
import {
	defaultClockTolerance,
	defaultFailingAfter,
	type ExportHealth,
	type ExportSignal,
	type ExportSnapshot,
	exportHealth,
	exportSignals,
	failingSignals,
	isClockSkewed,
	observingHttpClient,
} from './export-health'
import { redactingTracer } from './redact-spans'
import { parseKeepRate, samplingTracer } from './sampling'

/**
 * Parse OTLP headers from the standard comma-separated format.
 * Format: "key=value,key2=value2"
 */
const parseOtlpHeaders = (raw: string): Record<string, string> => {
	const headers: Record<string, string> = {}
	for (const pair of raw.split(',')) {
		const idx = pair.indexOf('=')
		if (idx > 0) {
			headers[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
		}
	}
	return headers
}

/**
 * Timings for watching over export. The defaults suit a process that runs for
 * weeks; a test shortens them so it does not wait out a real interval.
 */
export interface ExportCadence {
	readonly requestTimeout: Duration.Duration
	readonly checkEvery: Duration.Duration
	readonly failingAfter: Duration.Duration
	readonly heartbeatEvery: Duration.Duration
	readonly clockTolerance: Duration.Duration
}

const defaultCadence: ExportCadence = {
	requestTimeout: Duration.seconds(10),
	checkEvery: Duration.seconds(60),
	failingAfter: defaultFailingAfter,
	heartbeatEvery: Duration.minutes(5),
	clockTolerance: defaultClockTolerance,
}

/**
 * Where we export to, in a form safe to write down: the path is kept because a
 * wrong one is the misconfiguration this line exists to catch, and the query
 * string is dropped because that is where a key tends to hide in a URL.
 */
export const endpointOf = (baseUrl: string): string => {
	try {
		const url = new URL(baseUrl)
		return `${url.origin}${url.pathname}`
	} catch {
		// Reported rather than thrown: the exporter fails on it soon enough, and a
		// line naming the problem beats one that hides it. Only the length goes
		// out, in case an unusable value is a key pasted into the wrong setting.
		return `unparseable (${baseUrl.length} chars)`
	}
}

/**
 * What to say about each signal named. Fields with nothing to report are left
 * out rather than written as `undefined`: the console formatter renders them
 * literally, and `undefined` is not something a reader can parse back.
 */
const detailOf = (
	snapshot: ExportSnapshot,
	signals: ReadonlyArray<ExportSignal>,
): Record<string, unknown> =>
	Object.fromEntries(
		signals.map(signal => {
			const state = snapshot[signal]
			return [
				signal,
				{
					consecutiveFailures: state.consecutiveFailures,
					...(state.failure === undefined ? {} : { failure: state.failure }),
					...(state.status === undefined ? {} : { status: state.status }),
					...(state.lastSuccessAt === undefined
						? {}
						: { lastSuccessAt: state.lastSuccessAt }),
				},
			]
		}),
	)

/**
 * Says out loud what the export path is doing, on the one channel that still
 * works when export does not: the process's own console. Not sent to the
 * backend, because a report that export is broken is worth nothing if it goes
 * out the way that is broken.
 *
 * A failure is said once when export breaks and once when it comes back, since
 * a backend that is down produces a failure every interval and repeating it
 * would bury the console it is trying to reach. The heartbeat repeats
 * regardless, because the platform hands back the end of a console log rather
 * than the beginning: a line written only at start-up has scrolled away by the
 * time anyone asks whether this process exports at all.
 */
const watchdog = (options: {
	readonly health: ExportHealth
	readonly annotations: Record<string, unknown>
	readonly cadence: ExportCadence
}) =>
	Effect.gen(function* () {
		const { health, annotations, cadence } = options
		const ticksPerHeartbeat = Math.max(
			1,
			Math.round(
				Duration.toMillis(cadence.heartbeatEvery) /
					Duration.toMillis(cadence.checkEvery),
			),
		)
		let broken = false
		let wasSkewed = false
		let tick = 0

		while (true) {
			yield* Effect.sleep(cadence.checkEvery)
			const now = yield* Clock.currentTimeMillis
			// One reading, used for both the decision and the detail reported with
			// it. Taking a second one would let a signal recover in between and be
			// reported as failing with nothing wrong recorded against it.
			const snapshot = health.snapshot()
			const failing = failingSignals(snapshot, now, cadence.failingAfter)
			tick += 1

			if (failing.length > 0 && !broken) {
				yield* Effect.logError('Telemetry export is failing').pipe(
					Effect.annotateLogs({
						...annotations,
						event: 'otlp.export.failing',
						signals: detailOf(snapshot, failing),
					}),
				)
			} else if (failing.length === 0 && broken) {
				yield* Effect.logInfo('Telemetry export recovered').pipe(
					Effect.annotateLogs({
						...annotations,
						event: 'otlp.export.recovered',
					}),
				)
			}
			broken = failing.length > 0

			const offsetMs = health.clockOffset()
			const skewed = isClockSkewed(offsetMs, cadence.clockTolerance)
			// `skewed` is never true without an offset; the check is repeated so
			// the number itself can be reported below.
			if (skewed && !wasSkewed && offsetMs !== undefined) {
				yield* Effect.logError(
					'This process and the backend disagree about the time',
				).pipe(
					Effect.annotateLogs({
						...annotations,
						event: 'otlp.clock.skewed',
						clockOffsetSeconds: Math.round(offsetMs / 1000),
					}),
				)
			} else if (!skewed && wasSkewed) {
				yield* Effect.logInfo('Clocks agree again').pipe(
					Effect.annotateLogs({ ...annotations, event: 'otlp.clock.agreed' }),
				)
			}
			wasSkewed = skewed

			if (tick % ticksPerHeartbeat === 0) {
				yield* Effect.logInfo('Telemetry export health').pipe(
					Effect.annotateLogs({
						...annotations,
						event: 'otlp.export.health',
						// Same two fields as the line a process with export off writes,
						// so one search answers the question for every process.
						exporting: true,
						failing: failing.length > 0,
						// Left out entirely until a reply has been read: the console
						// formatter writes an absent value as the word `undefined`.
						...(offsetMs === undefined
							? {}
							: { clockOffsetSeconds: Math.round(offsetMs / 1000) }),
						signals: detailOf(snapshot, exportSignals),
					}),
				)
			}
		}
	})

/** Repeats the fact that this process exports nothing, at the same cadence. */
const exportOffHeartbeat = (options: {
	readonly annotations: Record<string, unknown>
	readonly cadence: ExportCadence
}) =>
	Effect.gen(function* () {
		while (true) {
			yield* Effect.sleep(options.cadence.heartbeatEvery)
			yield* Effect.logInfo('Telemetry export health').pipe(
				Effect.annotateLogs({
					...options.annotations,
					event: 'otlp.export.health',
					exporting: false,
					failing: false,
				}),
			)
		}
	})

/**
 * OTLP observability layer for a single process — exports traces, logs, and
 * metrics. `serviceName` distinguishes the emitting process in the backend
 * (e.g. `batuda-server`, `batuda-mail-worker`); the Honeycomb dataset is chosen
 * by the `x-honeycomb-dataset` value inside OTEL_EXPORTER_OTLP_HEADERS, not here.
 *
 * Enabled only when OTEL_EXPORTER_OTLP_ENDPOINT is set. When disabled the
 * process still says so on a repeating line, so "is this exporting?" has an
 * answer either way.
 *
 * Config:
 * - OTEL_EXPORTER_OTLP_ENDPOINT — base URL (e.g. https://api.honeycomb.io)
 * - OTEL_EXPORTER_OTLP_HEADERS — comma-separated key=value pairs
 * - OTEL_TRACES_KEEP_RATE — share of traces to keep, 0..1 (default 1, keep all)
 * - NODE_ENV — deployment environment attribute
 */
export const makeOtlpObservability = (options: {
	readonly serviceName: string
	readonly cadence?: Partial<ExportCadence>
	readonly health?: ExportHealth
}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const cadence = { ...defaultCadence, ...options.cadence }
			const health = options.health ?? exportHealth

			const baseUrl = yield* Config.string('OTEL_EXPORTER_OTLP_ENDPOINT').pipe(
				Config.withDefault(''),
			)
			// Read above the disable guard, unlike the settings below it: whether
			// export being off is ordinary or a fault depends on where this runs.
			const environment = yield* Config.string('NODE_ENV').pipe(
				Config.withDefault('development'),
			)

			health.setExporting(Boolean(baseUrl))

			if (!baseUrl) {
				const annotations = {
					service: options.serviceName,
					version: buildMeta.version,
					commit: buildMeta.commitShort,
					region: buildMeta.region,
					environment,
				}
				return Layer.effectDiscard(
					Effect.gen(function* () {
						// Loud in production, where the endpoint ships inside the image
						// and its absence means a broken build — but never fatal:
						// refusing to start over a monitoring setting would turn not
						// being able to watch production into not being able to run it.
						yield* environment === 'production'
							? Effect.logError(
									'OTLP export is off in production (no OTEL_EXPORTER_OTLP_ENDPOINT)',
								).pipe(Effect.annotateLogs(annotations))
							: Effect.logInfo(
									'OTLP export disabled (no OTEL_EXPORTER_OTLP_ENDPOINT)',
								).pipe(Effect.annotateLogs(annotations))
						yield* Effect.forkScoped(
							exportOffHeartbeat({ annotations, cadence }),
						)
					}),
				)
			}

			// Read below the disable guard so a process with OTLP off (e.g. the
			// mail-worker run locally) never needs these.
			const headersRaw = yield* Config.string(
				'OTEL_EXPORTER_OTLP_HEADERS',
			).pipe(Config.withDefault(''))
			// Read as text and parsed by `parseKeepRate`, which explains why: see
			// there for what an unusable or out-of-range value does.
			const keepRate = yield* Config.string('OTEL_TRACES_KEEP_RATE').pipe(
				Config.withDefault('1'),
				Config.map(parseKeepRate),
			)

			const annotations = {
				service: options.serviceName,
				endpoint: endpointOf(baseUrl),
				version: buildMeta.version,
				commit: buildMeta.commitShort,
				region: buildMeta.region,
				environment,
			}

			yield* Effect.logInfo('OTLP export enabled').pipe(
				Effect.annotateLogs({ ...annotations, tracesKeepRate: keepRate }),
			)

			// The exporter's own tracer, wrapped twice: sampling decides which traces
			// are worth sending, redaction scrubs caller-supplied attributes on the
			// way out whichever library recorded them. Sampling sits outside so it
			// settles `sampled` before a span is built.
			const ExportTracer = Layer.effect(Tracer.Tracer)(
				Effect.map(Effect.service(Tracer.Tracer), inner =>
					samplingTracer(redactingTracer(inner), keepRate),
				),
			)

			// The client every batch goes out through, wrapped so the outcome of
			// each one is recorded — this is the only place that knows both which
			// client the exporter uses and what to record into.
			const ExportClient = Layer.effect(HttpClient.HttpClient)(
				Effect.map(Effect.service(HttpClient.HttpClient), inner =>
					observingHttpClient(inner, health, cadence.requestTimeout),
				),
			).pipe(Layer.provide(FetchHttpClient.layer))

			return Otlp.layerJson({
				baseUrl,
				resource: {
					serviceName: options.serviceName,
					serviceVersion: buildMeta.version,
					attributes: {
						'deployment.environment': environment,
						// Identifies which build is live; UKC exposes no per-instance
						// id, so the version+commit pair is the finest grain available.
						'deployment.id': `${buildMeta.version}-${buildMeta.commitShort}`,
						'vcs.revision': buildMeta.commit,
						'cloud.region': buildMeta.region,
					},
				},
				headers: headersRaw ? parseOtlpHeaders(headersRaw) : undefined,
				tracerExportInterval: Duration.seconds(5),
				loggerExportInterval: Duration.seconds(1),
				metricsExportInterval: Duration.seconds(60),
				metricsTemporality: 'cumulative',
			}).pipe(
				Layer.provide(ExportClient),
				// Merged, not provided: the exporter's flusher, logger and metrics
				// still have to reach the process; only the tracer is swapped.
				layer => ExportTracer.pipe(Layer.provideMerge(layer)),
				Layer.merge(
					Layer.effectDiscard(
						Effect.forkScoped(watchdog({ health, annotations, cadence })),
					),
				),
			)
		}),
	)
