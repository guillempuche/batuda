// Research bounded context entry point. The server imports ports + types
// for handler wiring; infrastructure implementations live in this package
// and are selected at boot-time via env vars.

// ── Application (services) ─────────────────────────────────────────────────
export { type BudgetConfig, makeBudgetLayer } from './application/budget'
// ── Application (contact discovery) ────────────────────────────────────────
export {
	type ContactChannel,
	ContactDiscovery,
	type DiscoverContactsInput,
	type DiscoverContactsOutcome,
	type DiscoveredContact,
	estimateDiscoverCostCents,
} from './application/contact-discovery'
// ── Application (contact-finding eval) ─────────────────────────────────────
export {
	type ContactGoldenParseResult,
	parseContactGoldenRow,
	parseContactGoldenSet,
	type RawContactGoldenRow,
} from './application/eval-contacts-golden'
export { outcomeFromContactRun } from './application/eval-contacts-outcome'
export {
	buildContactEvalReport,
	type ContactEvalReport,
	contactEvalSpanAttributes,
	contactEvalSummaryAttributes,
} from './application/eval-contacts-report'
export {
	type ContactEvalSummary,
	type ContactGoldenExpectation,
	type ContactRunOutcome,
	type ContactRunScore,
	type ContactTerminalStatus,
	type GoldenContact,
	type OutcomeContact,
	scoreContactRun,
	summarizeContactScores,
} from './application/eval-contacts-scoring'
// ── Application (eval harness) ─────────────────────────────────────────────
export {
	type GoldenParseResult,
	parseGoldenRow,
	parseGoldenSet,
	type RawGoldenRow,
} from './application/eval-golden'
export { outcomeFromRun } from './application/eval-outcome'
export {
	buildEvalReport,
	type EvalReport,
	evalSpanAttributes,
	evalSummaryAttributes,
	type ScorePayload,
	scorePayloadsForRun,
} from './application/eval-report'
export {
	type EvalSummary,
	type GoldenExpectation,
	type RunOutcome,
	type RunScore,
	SCORABLE_FIELDS,
	type ScorableField,
	scoreRun,
	summarizeScores,
	type TerminalStatus,
} from './application/eval-scoring'
export {
	type PerRunOverrides,
	resolvePolicy,
	type SystemDefaults,
} from './application/policy'
export type {
	DiscoverInput,
	EmailVerifyInput,
	EnrichmentInput,
	ExtractInput,
	MxOutcome,
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
	EmailVerifier,
	EnrichmentProvider,
	ExtractLanguageModel,
	ExtractProvider,
	MxResolver,
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
	type PendingProposalRow,
	queryPendingProposals,
	type ResearchEvent,
	type ResearchEventType,
	ResearchService,
	type ToolLogEntry,
	withProposalIds,
} from './application/research-service'
export type { SchemaName } from './application/schemas/index'
// ── Application (schemas) ──────────────────────────────────────────────────
export {
	CompanyEnrichmentV1Schema,
	CompetitorScanV1Schema,
	ContactDiscoveryV1Schema,
	FreeformSchema,
	ProspectScanV1Schema,
	SchemaNameSchema,
	schemaRegistry,
} from './application/schemas/index'
export { researchToolkit, researchToolkitLayer } from './application/tools'
// ── Domain ─────────────────────────────────────────────────────────────────
export { AcceptedCountry } from './domain/country'
export {
	CRM_INDUSTRIES,
	CRM_REGIONS,
	CRM_SIZE_RANGES,
	type CrmIndustry,
	type CrmRegion,
	type CrmSizeRange,
} from './domain/crm-vocabulary'
export {
	ApprovalRequired,
	BudgetExceeded,
	MonthlyCapExceeded,
	NoRegistry,
	noRegistryResult,
	ProviderError,
	QuotaExhausted,
} from './domain/errors'
export type {
	BudgetSnapshot,
	CompanyReport,
	DiscoverResult,
	EmailVerification,
	EnrichmentResult,
	ExternalJobRef,
	RegistryRecord,
	ResolvedPolicy,
	ScrapedPage,
	SearchResult,
	SearchResultItem,
} from './domain/types'
export {
	RESEARCH_REASON_CODES,
	ReasonCode,
	VERIFICATION_VERDICTS,
	VerificationVerdict,
} from './domain/types'
export { makeCachedScrape } from './infrastructure/cached-scrape'
export {
	type ModelProbeResult,
	type ProbeCheck,
	probeModelCapabilities,
} from './infrastructure/capability-probe'
export { makeResearchLlmLive } from './infrastructure/llm-live'
// ── Infrastructure (provider layers) ──────────────────────────────────────
export { makeResearchProvidersLive } from './infrastructure/providers-live'
