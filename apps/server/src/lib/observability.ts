import { makeOtlpObservability } from '@batuda/observability'

/**
 * OTLP observability layer for the API server. Exports traces, logs, and
 * metrics to the `batuda-server` Honeycomb dataset when
 * OTEL_EXPORTER_OTLP_ENDPOINT is set; otherwise it sends nothing (local dev).
 *
 * Either way it keeps saying which of the two it is doing, so the question can
 * be answered from a running process rather than from a line written at boot.
 */
export const OtlpObservability = makeOtlpObservability({
	serviceName: 'batuda-server',
})
