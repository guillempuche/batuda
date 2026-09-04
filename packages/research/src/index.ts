// Research bounded context entry point. The server imports ports + types
// for handler wiring; infrastructure implementations live in this package
// and are selected at boot-time via env vars.

// ── Application (services) ─────────────────────────────────────────────────
export {
	type BudgetConfig,
	makeBudgetLayer,
	monthlyRemainingCents,
} from './application/budget'
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
	type FarmJudge,
	type FarmLabel,
	type FarmReplayScore,
	type FarmRow,
	type FarmRowParseResult,
	type FarmVerdict,
	parseFarmCorpus,
	parseFarmRow,
	rowByRow,
	scoreFarmReplay,
} from './application/eval-farm-replay'
export {
	type GoldenParseResult,
	parseGoldenRow,
	parseGoldenSet,
	type RawGoldenRow,
} from './application/eval-golden'
export {
	compareFramings,
	type FramingComparison,
	type FramingOutcome,
} from './application/eval-invariance'
export {
	judgeOrganisationKinds,
	type KindCandidate,
	type KindMethod,
	type OrganisationKind,
	type OrganisationKindJudge,
	OrganisationKindVerdictsSchema,
	organisationKindPrompt,
	removalAsCandidate,
} from './application/eval-organisation-kind'
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
	type FieldOutcome,
	type GoldenExpectation,
	type MarketExpectation,
	type MarketPart,
	type MarketScore,
	type RunOutcome,
	type RunScore,
	type RunUsage,
	SCORABLE_FIELDS,
	type ScorableField,
	scoreRun,
	summarizeScores,
	type TerminalStatus,
} from './application/eval-scoring'
// The one way to read a field that may carry the page it was read on. Exported
// because a caller outside this package reading such a field bare gets null and
// no complaint — the failure this whole shape has caused before.
export { readTextValue } from './application/guard-shapes'
export {
	type DroppedNetworkRow,
	dropNetworkRows,
	type NetworkGuardResult,
	placesNamed,
} from './application/network-guard'
export {
	type PerRunOverrides,
	resolvePolicy,
	type SystemDefaults,
} from './application/policy'
export type {
	EmailVerifyInput,
	EnrichmentInput,
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
	type BudgetService,
	EmailVerifier,
	EnrichmentChain,
	EnrichmentProvider,
	ExtractLanguageModel,
	MapProvider,
	MxResolver,
	RegistryRouter,
	ReportRouter,
	ResearchDispatch,
	ResearchEventSink,
	ResearchRunContext,
	ScrapeProvider,
	SearchProvider,
	WriterLanguageModel,
} from './application/ports'
export {
	type CreateResearchInput,
	cloneCacheHitRun,
	type PendingProposalRow,
	queryPendingPaidActions,
	queryPendingProposals,
	type ResearchEvent,
	type ResearchEventType,
	ResearchService,
	type ResolvedInstructions,
	stampRunCostFromLedger,
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
export {
	canonicalizeUrl,
	isWebAddress,
	sourceIdFor,
	urlHashForScrape,
} from './application/source-key'
export { AUTO_APPLY_CONFIDENCE_FLOOR } from './application/source-tier-guard'
export {
	researchToolkit,
	researchToolkitLayer,
	researchToolkitWireFormat,
} from './application/tools'
export {
	makeUsageMeter,
	UsageMeter,
	type UsageSnapshot,
} from './application/usage-meter'
// ── Domain ─────────────────────────────────────────────────────────────────
export { AcceptedCountry } from './domain/country'
export {
	SNAPSHOT_COMPANY_FIELDS,
	SNAPSHOT_CONTACT_FIELDS,
} from './domain/crm-vocabulary'
export {
	ApprovalRequired,
	BudgetExceeded,
	MonthlyCapExceeded,
	NoRegistry,
	noRegistryResult,
	ProviderError,
	SubjectUnavailable,
} from './domain/errors'
export type {
	BudgetSnapshot,
	CompanyReport,
	EmailVerification,
	EnrichmentResult,
	RegistryRecord,
	ResolvedPolicy,
	ScrapedPage,
} from './domain/types'
export {
	RESEARCH_REASON_CODES,
	ReasonCode,
	SearchResult,
	SearchResultItem,
} from './domain/types'
export type { LlmTier } from './infrastructure/cached-llm'
export { makeCachedLanguageModel } from './infrastructure/cached-llm'
export { makeCachedScrape } from './infrastructure/cached-scrape'
export { makeCachedSearch } from './infrastructure/cached-search'
export {
	type ModelProbeResult,
	type ProbeCheck,
	probeModelCapabilities,
} from './infrastructure/capability-probe'
export {
	type ConfiguredSlot,
	configuredSlots,
	type LlmVendor,
	makeResearchLlmLive,
	type ResolvedTier,
	resolvedTierVendors,
} from './infrastructure/llm-live'
// ── Infrastructure (provider layers) ──────────────────────────────────────
export {
	type CapabilityVendor,
	makeResearchProvidersLive,
	type ResearchCapability,
	type ResolvedCapability,
	resolvedCapabilityVendors,
} from './infrastructure/providers-live'
// ── Infrastructure (vendor reachability) ──────────────────────────────────
export {
	hostOf,
	probeReachability,
	researchProviderEndpoints,
} from './infrastructure/reachability'
