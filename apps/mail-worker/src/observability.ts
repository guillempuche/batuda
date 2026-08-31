import { makeOtlpObservability } from '@batuda/observability'

/**
 * OTLP observability layer for the mail worker. Exports traces, logs, and
 * metrics to the `batuda-mail-worker` Honeycomb dataset when
 * OTEL_EXPORTER_OTLP_ENDPOINT is set; otherwise it sends nothing (local dev).
 *
 * Whoever builds this in has to MERGE it, not only provide it: provided alone,
 * the process keeps its own logger and tracer, announces that export is enabled,
 * and sends nothing.
 *
 * This process has no HTTP surface, so its console is the only place it can
 * report on its own export health — which is why that report is a repeating log
 * line rather than something to be asked for.
 */
export const OtlpObservability = makeOtlpObservability({
	serviceName: 'batuda-mail-worker',
})
