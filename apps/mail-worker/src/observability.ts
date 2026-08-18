import { makeOtlpObservability } from '@batuda/observability'

/**
 * OTLP observability layer for the mail worker. Exports traces, logs, and
 * metrics to the `batuda-mail-worker` Honeycomb dataset when
 * OTEL_EXPORTER_OTLP_ENDPOINT is set; otherwise a no-op (local dev).
 *
 * Whoever builds this in has to MERGE it, not only provide it — see the note at
 * the use site in `main.ts`. The worker ran for months provided-only: booting,
 * announcing that export was enabled, and sending nothing.
 */
export const OtlpObservability = makeOtlpObservability({
	serviceName: 'batuda-mail-worker',
})
