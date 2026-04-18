// Research bounded context entry point. The server imports ports + types
// for handler wiring; infrastructure implementations live in this package
// and are selected at boot-time via env vars.

// ── Application (services) ─────────────────────────────────────────────────
export { type BudgetConfig, makeBudgetLayer } from './application/budget'
export {
	type PerRunOverrides,
	resolvePolicy,
	type SystemDefaults,
} from './application/policy'
export type {
	DiscoverInput,
	ExtractInput,
	RegistryInput,
	ReportInput,
	ScrapeInput,
	SearchInput,
} from './application/ports'
// ── Application (ports) ────────────────────────────────────────────────────
export {
	AgentLanguageModel,
	BlobStorage,
	Budget,
	DiscoverProvider,
	ExtractLanguageModel,
	ExtractProvider,
	ProviderQuota,
	RegistryRouter,
	ReportRouter,
	ResearchEventSink,
	ResearchRunContext,
	ScrapeProvider,
	SearchProvider,
	WriterLanguageModel,
} from './application/ports'
export {
	makeProviderQuotaLayer,
	type ProviderQuotaConfig,
} from './application/provider-quota'
export {
	type CreateResearchInput,
	type ResearchEvent,
	type ResearchEventType,
	ResearchService,
	type ToolLogEntry,
} from './application/research-service'
export type { SchemaName } from './application/schemas/index'
// ── Application (schemas) ──────────────────────────────────────────────────
export {
	CompanyEnrichmentV1Schema,
	CompetitorScanV1Schema,
	ContactDiscoveryV1Schema,
	FreeformSchema,
	ProspectScanV1Schema,
	schemaRegistry,
} from './application/schemas/index'
export { researchToolkit, researchToolkitLayer } from './application/tools'
// ── Domain ─────────────────────────────────────────────────────────────────
export {
	ApprovalRequired,
	BudgetExceeded,
	MonthlyCapExceeded,
	ProviderError,
	QuotaExhausted,
} from './domain/errors'
export type {
	BudgetSnapshot,
	CompanyReport,
	DiscoverResult,
	ExternalJobRef,
	RegistryRecord,
	ResolvedPolicy,
	ScrapedPage,
	SearchResult,
	SearchResultItem,
} from './domain/types'
export { makeResearchLlmLive } from './infrastructure/llm-live'
// ── Infrastructure (provider layers) ──────────────────────────────────────
export { makeResearchProvidersLive } from './infrastructure/providers-live'
