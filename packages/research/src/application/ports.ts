import { type Effect, type Schema, ServiceMap } from 'effect'
import type { LanguageModel } from 'effect/unstable/ai'

import type { Country } from '../domain/country'
import type { ProviderError } from '../domain/errors'

// ── Research run context (available inside the LLM tool loop fiber) ──

export class ResearchRunContext extends ServiceMap.Service<
	ResearchRunContext,
	{ readonly researchId: string }
>()('research/ResearchRunContext') {}

// ── Tier-specific LanguageModel services ──
// Three distinct tags backed by the same LanguageModel.Service shape.
// Phase 1 pins a different model/provider cascade to each phase of the fiber
// (agent = reasoning + tool loop, extract = structured JSON, writer = brief).

export class AgentLanguageModel extends ServiceMap.Service<
	AgentLanguageModel,
	LanguageModel.Service
>()('research/AgentLanguageModel') {}

export class ExtractLanguageModel extends ServiceMap.Service<
	ExtractLanguageModel,
	LanguageModel.Service
>()('research/ExtractLanguageModel') {}

export class WriterLanguageModel extends ServiceMap.Service<
	WriterLanguageModel,
	LanguageModel.Service
>()('research/WriterLanguageModel') {}

// ── BlobStorage port (research-local view of app storage) ──
// Narrow put/get used by scrape caching. Server wires this to S3StorageProvider
// so research stays independent of the server package.

export class BlobStorage extends ServiceMap.Service<
	BlobStorage,
	{
		readonly put: (
			key: string,
			bytes: Uint8Array,
			contentType: string,
		) => Effect.Effect<void>
		readonly get: (key: string) => Effect.Effect<Uint8Array>
	}
>()('research/BlobStorage') {}

import type {
	BudgetSnapshot,
	CompanyReport,
	DiscoverResult,
	ExternalJobRef,
	RegistryRecord,
	ScrapedPage,
	SearchResult,
} from '../domain/types'

// ── Search ──

export interface SearchInput {
	readonly query: string
	readonly limit?: number | undefined
	readonly recency?: { days: number } | undefined
	readonly location?: string | undefined
	readonly languages?: string[] | undefined
}

export class SearchProvider extends ServiceMap.Service<
	SearchProvider,
	{
		readonly search: (
			input: SearchInput,
		) => Effect.Effect<SearchResult, ProviderError>
	}
>()('research/SearchProvider') {}

// ── Scrape ──

export interface ScrapeInput {
	readonly url: string
	readonly formats?:
		| ('markdown' | 'html' | 'links' | 'screenshot')[]
		| undefined
	readonly waitForSelector?: string | undefined
	readonly location?: string | undefined
}

export class ScrapeProvider extends ServiceMap.Service<
	ScrapeProvider,
	{
		readonly scrape: (
			input: ScrapeInput,
		) => Effect.Effect<ScrapedPage, ProviderError>
	}
>()('research/ScrapeProvider') {}

// ── Extract ──
// Returns `unknown` — caller decodes with Schema.decodeUnknown(schema)(raw).
// Generic methods on ServiceMap.Service lose type params through the tag.

export interface ExtractInput {
	readonly url: string
	readonly schema: Schema.Top
	readonly prompt?: string | undefined
	readonly schemaName?: string | undefined
	readonly schemaVersion?: number | undefined
}

export class ExtractProvider extends ServiceMap.Service<
	ExtractProvider,
	{
		readonly extract: (
			input: ExtractInput,
		) => Effect.Effect<unknown, ProviderError>
	}
>()('research/ExtractProvider') {}

// ── Discover ──

export interface DiscoverInput {
	readonly prompt: string
	readonly urls?: string[] | undefined
	readonly schema?: Schema.Top | undefined
	readonly maxCostCents?: number | undefined
}

export class DiscoverProvider extends ServiceMap.Service<
	DiscoverProvider,
	{
		readonly discover: (
			input: DiscoverInput,
		) => Effect.Effect<DiscoverResult, ProviderError>
		readonly cancel: (
			jobRef: ExternalJobRef,
		) => Effect.Effect<void, ProviderError>
	}
>()('research/DiscoverProvider') {}

// ── Registry (country-routed) ──

export interface RegistryInput {
	readonly country: Country
	readonly query?: string | undefined
	readonly taxId?: string | undefined
}

export class RegistryRouter extends ServiceMap.Service<
	RegistryRouter,
	{
		readonly lookup: (
			input: RegistryInput,
		) => Effect.Effect<RegistryRecord, ProviderError>
	}
>()('research/RegistryRouter') {}

// ── Report (country-routed, paid) ──

export interface ReportInput {
	readonly country: Country
	readonly taxId: string
	readonly depth: 'basic' | 'financials' | 'full'
}

export class ReportRouter extends ServiceMap.Service<
	ReportRouter,
	{
		readonly report: (
			input: ReportInput,
		) => Effect.Effect<CompanyReport, ProviderError>
	}
>()('research/ReportRouter') {}

// ── Research event sink (observability — fires webhooks, metrics, etc.) ──

// Implementations may require request-scoped tags (e.g. CurrentOrg, when the
// sink fans out webhooks scoped to the active org). The R channel stays open
// so callers thread their context — the research-service runs sinks under
// the same fiber that holds the request's tags.
export class ResearchEventSink extends ServiceMap.Service<
	ResearchEventSink,
	{
		readonly fire: (
			event: string,
			payload: unknown,
		) => Effect.Effect<void, never, never>
	}
>()('research/ResearchEventSink') {}

// ── Budget ──

export class Budget extends ServiceMap.Service<
	Budget,
	{
		readonly init: (
			cheapCents: number,
			paidCents: number,
		) => Effect.Effect<void>
		readonly chargeCheap: (
			provider: string,
			cents: number,
		) => Effect.Effect<void, import('../domain/errors').BudgetExceeded>
		readonly chargePaid: (
			provider: string,
			cents: number,
			idempotencyKey?: string,
		) => Effect.Effect<
			void,
			| import('../domain/errors').BudgetExceeded
			| import('../domain/errors').MonthlyCapExceeded
		>
		readonly snapshot: () => Effect.Effect<BudgetSnapshot>
	}
>()('research/Budget') {}

// ── Provider Quota ──

export class ProviderQuota extends ServiceMap.Service<
	ProviderQuota,
	{
		readonly check: (
			provider: string,
			units: number,
		) => Effect.Effect<void, import('../domain/errors').QuotaExhausted>
		readonly consume: (
			provider: string,
			units: number,
		) => Effect.Effect<void, import('../domain/errors').QuotaExhausted>
		readonly remaining: (
			provider: string,
		) => Effect.Effect<{ total: number; used: number; unit: string }>
		readonly sync: (provider: string) => Effect.Effect<void, ProviderError>
	}
>()('research/ProviderQuota') {}
