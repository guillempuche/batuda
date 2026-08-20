import { Context, type Effect } from 'effect'
import type { LanguageModel } from 'effect/unstable/ai'

import type { AcceptedCountry } from '../domain/country'
import type {
	ApprovalRequired,
	BudgetExceeded,
	MonthlyCapExceeded,
	NoRegistry,
	ProviderError,
	UnsupportedSite,
} from '../domain/errors'
import type { EntityTargets } from './entity-guard'

// ── Research run context (available inside the LLM tool loop fiber) ──

export class ResearchRunContext extends Context.Service<
	ResearchRunContext,
	{
		readonly researchId: string
		// The run's language + location hints, so a search reaches the provider in
		// the target's own language instead of defaulting to English — the company's
		// own pages are rarely in English for a non-English target.
		readonly language?: string | undefined
		readonly location?: string | undefined
		// The run's target company, so a web search that dropped the company name can
		// be re-anchored to it before it reaches the provider. `entityTargets` is the
		// match keys used to tell an already-anchored query from one that drifted off
		// the company; `entityName` is the display name appended to a drifted query.
		// `entityTargets` is null for a scan/freeform run that has no single target
		// company, and that alone turns the re-anchoring off.
		readonly entityTargets?: EntityTargets | null | undefined
		readonly entityName?: string | undefined
	}
>()('research/ResearchRunContext') {}

// ── Tier-specific LanguageModel services ──
// Three distinct tags backed by the same LanguageModel.Service shape.
// Phase 1 pins a different model/provider cascade to each phase of the fiber
// (agent = reasoning + tool loop, extract = structured JSON, writer = brief).

export class AgentLanguageModel extends Context.Service<
	AgentLanguageModel,
	LanguageModel.Service
>()('research/AgentLanguageModel') {}

export class ExtractLanguageModel extends Context.Service<
	ExtractLanguageModel,
	LanguageModel.Service
>()('research/ExtractLanguageModel') {}

export class WriterLanguageModel extends Context.Service<
	WriterLanguageModel,
	LanguageModel.Service
>()('research/WriterLanguageModel') {}

// ── BlobStorage port (research-local view of app storage) ──
// Narrow put/get used by scrape caching. Server wires this to S3StorageProvider
// so research stays independent of the server package. A store failure surfaces
// as a typed ProviderError (not a defect) so the scrape cache can degrade a
// broken read to a fresh fetch instead of failing — and denying the model the
// page, which makes it invent facts.

export class BlobStorage extends Context.Service<
	BlobStorage,
	{
		readonly put: (
			key: string,
			bytes: Uint8Array,
			contentType: string,
		) => Effect.Effect<void, ProviderError>
		readonly get: (key: string) => Effect.Effect<Uint8Array, ProviderError>
	}
>()('research/BlobStorage') {}

import type {
	BudgetSnapshot,
	CompanyReport,
	EmailVerification,
	EnrichmentResult,
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

export class SearchProvider extends Context.Service<
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

export class ScrapeProvider extends Context.Service<
	ScrapeProvider,
	{
		readonly scrape: (
			input: ScrapeInput,
			// UnsupportedSite is a routing outcome (the provider refuses this site),
			// not a fetch failure — the tool loop catches it and skips the URL.
		) => Effect.Effect<ScrapedPage, ProviderError | UnsupportedSite>
	}
>()('research/ScrapeProvider') {}

// ── Site map (discover a site's own pages, whatever its URL structure) ──

export interface SiteMapInput {
	/** The site to map — a full URL like "https://acme.es". */
	readonly url: string
	/** Cap on returned page URLs; the provider may return fewer. */
	readonly limit?: number | undefined
}

/** Page URLs a site map turned up, and what the provider charged for them. */
export interface SiteMapResult {
	readonly links: ReadonlyArray<string>
	readonly units: number
}

export class MapProvider extends Context.Service<
	MapProvider,
	{
		/**
		 * Page URLs discovered on the site itself (sitemap + crawl), so a run can
		 * reach a team or about page the homepage never links. Configured 'none'
		 * in environments without a vendor — callers treat an error as "no map".
		 */
		readonly map: (
			input: SiteMapInput,
		) => Effect.Effect<SiteMapResult, ProviderError>
	}
>()('research/MapProvider') {}

// ── Enrichment (decision-maker name + email discovery, universal) ──

export interface EnrichmentInput {
	readonly domain: string
	readonly companyName?: string | undefined
	readonly country?: string | undefined
}

export class EnrichmentProvider extends Context.Service<
	EnrichmentProvider,
	{
		readonly findPeople: (
			input: EnrichmentInput,
		) => Effect.Effect<EnrichmentResult, ProviderError>
	}
>()('research/EnrichmentProvider') {}

// ── Enrichment chain (ordered per-vendor attempts + how to run them) ──
// Contact discovery runs these itself so it can bill each vendor it calls and
// pick fallback (stop at the first vendor that finds anyone) or union (call
// every vendor and merge the people). Each attempt is one vendor's findPeople,
// labelled so the spend row names the vendor that actually ran.

export interface EnrichmentAttempt {
	readonly label: string
	readonly findPeople: (
		input: EnrichmentInput,
	) => Effect.Effect<EnrichmentResult, ProviderError>
}

export type EnrichmentMode = 'fallback' | 'union'

export class EnrichmentChain extends Context.Service<
	EnrichmentChain,
	{
		readonly attempts: ReadonlyArray<EnrichmentAttempt>
		readonly mode: EnrichmentMode
	}
>()('research/EnrichmentChain') {}

// ── Email verification (deliverability of a guessed/found address) ──

export interface EmailVerifyInput {
	readonly email: string
}

export class EmailVerifier extends Context.Service<
	EmailVerifier,
	{
		readonly verify: (
			input: EmailVerifyInput,
		) => Effect.Effect<EmailVerification, ProviderError>
	}
>()('research/EmailVerifier') {}

// ── MX pre-gate (free DNS check before the paid verifier) ──

export type MxOutcome = 'has_mx' | 'no_mx' | 'unknown'

export class MxResolver extends Context.Service<
	MxResolver,
	{
		readonly resolve: (domain: string) => Effect.Effect<MxOutcome>
	}
>()('research/MxResolver') {}

// ── Registry (country-routed) ──

export interface RegistryInput {
	readonly country: AcceptedCountry
	readonly query?: string | undefined
	readonly taxId?: string | undefined
}

export class RegistryRouter extends Context.Service<
	RegistryRouter,
	{
		readonly lookup: (
			input: RegistryInput,
		) => Effect.Effect<RegistryRecord, ProviderError | NoRegistry>
	}
>()('research/RegistryRouter') {}

// ── Report (country-routed, paid) ──

export interface ReportInput {
	readonly country: AcceptedCountry
	readonly taxId: string
	readonly depth: 'basic' | 'financials' | 'full'
}

export class ReportRouter extends Context.Service<
	ReportRouter,
	{
		readonly report: (
			input: ReportInput,
		) => Effect.Effect<CompanyReport, ProviderError | NoRegistry>
	}
>()('research/ReportRouter') {}

// ── Research event sink (observability — fires webhooks, metrics, etc.) ──

// Implementations may require request-scoped tags (e.g. CurrentOrg, when the
// sink fans out webhooks scoped to the active org). The R channel stays open
// so callers thread their context — the research-service runs sinks under
// the same fiber that holds the request's tags.
export class ResearchEventSink extends Context.Service<
	ResearchEventSink,
	{
		readonly fire: (
			event: string,
			payload: unknown,
		) => Effect.Effect<void, never, never>
	}
>()('research/ResearchEventSink') {}

// ── Budget ──

/**
 * What came of paying for a vendor call: the answer that was bought, or word
 * that this run already paid for the same call and holds the answer somewhere
 * — never a bare value, so a caller cannot spend twice by mistaking the second
 * for the first.
 */
export type PaidCall<A> =
	| { readonly _tag: 'bought'; readonly value: A }
	| { readonly _tag: 'already_charged' }

export interface BudgetService {
	readonly chargeCheap: (
		provider: string,
		cents: number,
	) => Effect.Effect<void, BudgetExceeded>
	/**
	 * Take the price of one paid vendor call off the run's paid tier and record
	 * it. Answers whether this call was the one that paid: `false` means the same
	 * call was already paid for in this run, so calling the vendor again would be
	 * money spent twice for an answer already in hand.
	 */
	readonly chargePaid: (
		provider: string,
		cents: number,
		tool: string,
		idempotencyKey: string,
	) => Effect.Effect<
		boolean,
		BudgetExceeded | MonthlyCapExceeded | ApprovalRequired
	>
	/**
	 * Pay for one vendor call and make it, so the run is not left paying for an
	 * answer it never got. A call that fails hands the run's own allowance back;
	 * a repeat of one already paid for in this run comes back as
	 * `already_charged` and the vendor is not called again.
	 *
	 * The call is passed as a function, not as a ready-made effect, so nothing
	 * of it is built until the money is actually set aside.
	 *
	 * Prefer this to `chargePaid` wherever the vendor call is right there.
	 * Charging and calling as two steps means nothing gives the money back when
	 * the second one fails.
	 */
	readonly withPaidCharge: (
		provider: string,
		cents: number,
		tool: string,
		idempotencyKey: string,
	) => <A, E, R>(
		vendorCall: () => Effect.Effect<A, E, R>,
	) => Effect.Effect<
		PaidCall<A>,
		E | BudgetExceeded | MonthlyCapExceeded | ApprovalRequired,
		R
	>
	readonly snapshot: () => Effect.Effect<BudgetSnapshot>
}

export class Budget extends Context.Service<Budget, BudgetService>()(
	'research/Budget',
) {}

// ── Dispatch ──

/**
 * Whether this process carries queued research runs out, or only answers
 * questions about them.
 *
 * Every process that builds `ResearchService` otherwise becomes a worker: it
 * takes queued rows off the database, runs them, and fails ones whose worker
 * has gone quiet. That is right for the web server and wrong for the local
 * command-line MCP server a developer points an editor at, which would
 * otherwise compete with `pnpm dev` for the same queue — and spend, with real
 * provider keys.
 *
 * A reference rather than a service, so it carries its own answer and nothing
 * has to provide it: leave it alone and the process dispatches, as every
 * caller did before this existed.
 */
export const ResearchDispatch = Context.Reference<boolean>(
	'research/ResearchDispatch',
	{ defaultValue: () => true },
)
