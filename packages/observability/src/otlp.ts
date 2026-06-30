import { Config, Duration, Effect, Layer } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { Otlp } from 'effect/unstable/observability'

import { buildMeta } from './build-meta'

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
 * OTLP observability layer for a single process — exports traces, logs, and
 * metrics. `serviceName` distinguishes the emitting process in the backend
 * (e.g. `batuda-server`, `batuda-mail-worker`); the Honeycomb dataset is chosen
 * by the `x-honeycomb-dataset` value inside OTEL_EXPORTER_OTLP_HEADERS, not here.
 *
 * Enabled only when OTEL_EXPORTER_OTLP_ENDPOINT is set.
 * When disabled (local dev), returns Layer.empty.
 *
 * Config:
 * - OTEL_EXPORTER_OTLP_ENDPOINT — base URL (e.g. https://api.honeycomb.io)
 * - OTEL_EXPORTER_OTLP_HEADERS — comma-separated key=value pairs
 * - NODE_ENV — deployment environment attribute
 */
export const makeOtlpObservability = (options: {
	readonly serviceName: string
}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const baseUrl = yield* Config.string('OTEL_EXPORTER_OTLP_ENDPOINT').pipe(
				Config.withDefault(''),
			)

			if (!baseUrl) {
				yield* Effect.logInfo(
					'OTLP export disabled (no OTEL_EXPORTER_OTLP_ENDPOINT)',
				)
				return Layer.empty
			}

			// Read below the disable guard so a process with OTLP off (e.g. the
			// mail-worker run locally, where NODE_ENV is optional) never needs these.
			const headersRaw = yield* Config.string(
				'OTEL_EXPORTER_OTLP_HEADERS',
			).pipe(Config.withDefault(''))
			const environment = yield* Config.string('NODE_ENV').pipe(
				Config.withDefault('development'),
			)

			yield* Effect.logInfo('OTLP export enabled').pipe(
				Effect.annotateLogs({
					service: options.serviceName,
					endpoint: baseUrl,
					version: buildMeta.version,
					commit: buildMeta.commitShort,
					region: buildMeta.region,
					environment,
				}),
			)

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
			}).pipe(Layer.provide(FetchHttpClient.layer))
		}),
	)
