// Research bounded context entry point. The server imports ports + types
// for handler wiring; infrastructure implementations live in this package
// and are selected at boot-time via env vars.

// ── Application (services) ─────────────────────────────────────────────────
export { makeBudgetLayer } from './application/budget'
// ── Application (contact discovery) ────────────────────────────────────────
export {
	ContactDiscovery,
	estimateDiscoverCostCents,
} from './application/contact-discovery'
export {
	baselineReportName,
	goldenStem,
	newestReportName,
	stripReportForBaseline,
} from './application/eval-baselines'
// ── Application (contact-finding eval) ─────────────────────────────────────
export {
	parseContactGoldenSet,
	type RawContactGoldenRow,
} from './application/eval-contacts-golden'
export { outcomeFromContactRun } from './application/eval-contacts-outcome'
export {
	buildContactEvalReport,
	contactEvalSpanAttributes,
	contactEvalSummaryAttributes,
} from './application/eval-contacts-report'
export {
	type ContactEvalSummary,
	type ContactGoldenExpectation,
	type ContactRunScore,
	scoreContactRun,
} from './application/eval-contacts-scoring'
// ── Application (eval harness) ─────────────────────────────────────────────
export {
	type FarmJudge,
	type FarmReplayScore,
	networkGuardJudge,
	parseFarmCorpus,
	rowByRow,
	scoreFarmReplay,
	townPageJudge,
} from './application/eval-farm-replay'
export {
	parseGoldenSet,
	type RawGoldenRow,
} from './application/eval-golden'
export {
	compareFramings,
	type FramingOutcome,
} from './application/eval-invariance'
export {
	type KindReaskJudge,
	type KindReaskScore,
	parseKindCorpus,
	removedFromRun,
	scoreKindReask,
	spreadOf,
} from './application/eval-kind-reask'
export {
	judgeOrganisationKinds,
	type KindCandidate,
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
} from './application/eval-report'
export {
	type EvalSummary,
	type GoldenExpectation,
	type MarketExpectation,
	type MarketScore,
	type RunScore,
	type RunUsage,
	scoreRun,
} from './application/eval-scoring'
// The one way to read a field that may carry the page it was read on. Exported
// because a caller outside this package reading such a field bare gets null and
// no complaint — the failure this whole shape has caused before.
export { isPlainObject, readTextValue } from './application/guard-shapes'
export {
	dropNetworkRows,
	placesNamed,
} from './application/network-guard'
export {
	OrganisationKindGuardVerdictsSchema,
	organisationKindGuardPrompt,
} from './application/organisation-kind-guard'
export {
	resolvePolicy,
	type SystemDefaults,
} from './application/policy'
export type {
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
	ExtractLanguageModel,
	MapProvider,
	MxResolver,
	RegistryRouter,
	ResearchDispatch,
	ResearchEventSink,
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
	type ResearchLiveSnapshot,
	ResearchService,
	type ResolvedInstructions,
	stampRunCostFromLedger,
	withProposalIds,
} from './application/research-service'
export type { SchemaName } from './application/schemas/index'
// ── Application (schemas) ──────────────────────────────────────────────────
export {
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
	researchToolkitLayer,
	researchToolkitWireFormat,
} from './application/tools'
export { placeReadOffATownPage } from './application/town-page-guard'
export {
	makeUsageMeter,
	UsageMeter,
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
	CutOffReply,
	MonthlyCapExceeded,
	NoRegistry,
	noRegistryResult,
	ProviderError,
	RESPONSE_CUT_OFF,
	SubjectUnavailable,
} from './domain/errors'
export { looksLikeRegistrationNumber } from './domain/registration-number'
export type { ScrapedPage } from './domain/types'
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
	probeModelCapabilities,
} from './infrastructure/capability-probe'
export {
	configuredSlots,
	makeResearchLlmLive,
	resolvedTierVendors,
} from './infrastructure/llm-live'
// ── Infrastructure (provider layers) ──────────────────────────────────────
export {
	makeResearchProvidersLive,
	type ResearchCapability,
	resolvedCapabilityVendors,
} from './infrastructure/providers-live'
// ── Infrastructure (vendor reachability) ──────────────────────────────────
export {
	hostOf,
	probeReachability,
	researchProviderEndpoints,
} from './infrastructure/reachability'
