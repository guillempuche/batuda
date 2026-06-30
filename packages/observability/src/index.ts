// Shared OTLP observability for every Batuda process. Owns the build metadata
// (version/commit/region) surfaced on the health endpoint and the OTLP resource,
// plus the per-process exporter layer factory.

export { buildMeta } from './build-meta'
export { makeOtlpObservability } from './otlp'
