// Shared OTLP observability for every Batuda process. Owns the build metadata
// (version/commit/region) surfaced on the health endpoint and the OTLP resource,
// plus the per-process exporter layer factory.

export { boundedCause } from './bounded-cause'
export { buildMeta } from './build-meta'
export {
	defaultClockTolerance,
	defaultFailingAfter,
	type ExportFailure,
	type ExportHealth,
	type ExportReport,
	type ExportSignal,
	type ExportSnapshot,
	exportHealth,
	exportReport,
	exportSignals,
	failingSignals,
	isClockSkewed,
	isFailing,
	makeExportHealth,
	observingHttpClient,
	type SignalHealth,
	type SignalReport,
} from './export-health'
export {
	type ExportCadence,
	endpointOf,
	makeOtlpObservability,
} from './otlp'
export {
	makeWorkRecord,
	recordFacts,
	WorkRecord,
	type WorkRecordService,
} from './work-record'
