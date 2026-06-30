import { makeOtlpObservability } from '@batuda/observability'

/**
 * OTLP observability layer for the API server. Exports traces, logs, and
 * metrics to the `batuda-server` Honeycomb dataset when
 * OTEL_EXPORTER_OTLP_ENDPOINT is set; otherwise a no-op (local dev).
 */
export const OtlpObservability = makeOtlpObservability({
	serviceName: 'batuda-server',
})
