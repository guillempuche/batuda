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
 * OTLP observability layer — exports traces, logs, and metrics.
 *
 * Enabled only when OTEL_EXPORTER_OTLP_ENDPOINT is set.
 * When disabled (local dev), returns Layer.empty.
 *
 * Config:
 * - OTEL_EXPORTER_OTLP_ENDPOINT — base URL (e.g. https://api.honeycomb.io)
 * - OTEL_EXPORTER_OTLP_HEADERS — comma-separated key=value pairs
 * - NODE_ENV — deployment environment attribute
 */
export const OtlpObservability = Layer.unwrap(
	Effect.gen(function* () {
		const baseUrl = yield* Config.string('OTEL_EXPORTER_OTLP_ENDPOINT').pipe(
			Config.withDefault(''),
		)
		const headersRaw = yield* Config.string('OTEL_EXPORTER_OTLP_HEADERS').pipe(
			Config.withDefault(''),
		)
		const environment = yield* Config.string('NODE_ENV').pipe(
			Config.withDefault('development'),
		)

		if (!baseUrl) {
			yield* Effect.logInfo(
				'OTLP export disabled (no OTEL_EXPORTER_OTLP_ENDPOINT)',
			)
			return Layer.empty
		}

		yield* Effect.logInfo('OTLP export enabled').pipe(
			Effect.annotateLogs({
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
				serviceName: 'forja-server',
				serviceVersion: buildMeta.version,
				attributes: {
					'deployment.environment': environment,
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
