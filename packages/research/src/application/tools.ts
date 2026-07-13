/**
 * Research-phase-1 tool definitions.
 *
 * The phase-1 agent calls these through `generateText({ toolkit: ... })`.
 * Each handler delegates to a port (`SearchProvider`, `ScrapeProvider`,
 * `ExtractProvider`, `RegistryRouter`) whose cache/harness wrappers are
 * already composed at layer boot — the agent never sees a raw vendor.
 *
 * `paid_report` is intentionally excluded from the default toolkit. Exposing
 * it requires a confirmation gate (`CreateResearchInput.confirm`) and an
 * explicit budget check in the handler; that flow is deferred until the
 * approval-gate UI lands.
 *
 * Errors inside handlers are caught and mapped to `AiError.AiErrorReason` so
 * the tool loop surfaces them back to the model as tool results rather than
 * killing the fiber. The fiber-level handler (retry/timeout) sees a clean
 * `ProviderError` cascade through the harness, not inside tool calls.
 */

import { Cause, Effect, Schema } from 'effect'
import { AiError, Tool, Toolkit } from 'effect/unstable/ai'

import { AcceptedCountry } from '../domain/country'
import { noRegistryResult } from '../domain/errors'
import { ScrapedPage } from '../domain/types'
import { ContactDiscovery } from './contact-discovery'
import {
	Budget,
	RegistryRouter,
	ResearchRunContext,
	ScrapeProvider,
	SearchProvider,
} from './ports'
import {
	REGISTRY_LOOKUP_COST_CENTS,
	SCRAPE_COST_CENTS,
	SEARCH_COST_CENTS,
} from './tool-costs'

// Cap a scraped page before the model sees it: the reflect loop re-sends every
// round's tool results, so an uncapped page would grow the running prompt past
// the model's context window over several rounds.
const SCRAPE_MARKDOWN_MAX_CHARS = 8000

// ── Tool parameter schemas ──
// Optional params are required + nullable (`Schema.NullOr(...)`), not
// `optionalKey`: a model not using one sends an explicit `null`, which the
// handlers treat as "not provided". This shape also serializes to a single,
// non-nested union — `optionalKey` wraps the value in a second nullable layer,
// and a bare `Schema.Number` adds a NaN/Infinity string branch; either nesting
// makes a stricter provider (groq, fireworks) reject the whole tool schema. So
// numerics use `Schema.Finite`, which serializes to a plain number.

const WebSearchParams = Schema.Struct({
	query: Schema.String.annotate({
		description: 'Search query; concise keywords work best',
	}),
	limit: Schema.NullOr(Schema.Finite).annotate({
		description: 'Max results to return (default 10)',
	}),
	recency_days: Schema.NullOr(Schema.Finite).annotate({
		description:
			'Restrict to results published within the last N days. Null for no filter.',
	}),
	location: Schema.NullOr(Schema.String).annotate({
		description: 'Geographic locale hint (e.g. "ES", "es-ES")',
	}),
})

const ScrapePageParams = Schema.Struct({
	url: Schema.String.annotate({ description: 'Absolute URL to scrape' }),
})

const RegistryLookupParams = Schema.Struct({
	country: AcceptedCountry.annotate({
		description:
			'ISO 3166-1 alpha-2 country code (any case). A country without a national registry returns {status:"no_registry"} — use discover_contacts there instead.',
	}),
	query: Schema.NullOr(Schema.String).annotate({
		description: 'Company name or fuzzy search string; null if using tax_id',
	}),
	tax_id: Schema.NullOr(Schema.String).annotate({
		description:
			'National tax id (e.g. ES CIF/NIF) — more precise than query; null if using query',
	}),
})

const DiscoverContactsParams = Schema.Struct({
	company_name: Schema.String.annotate({
		description: 'Company legal or trading name',
	}),
	domain: Schema.String.annotate({
		description: 'Company web domain, e.g. "acme.com" (no scheme, no @)',
	}),
	country: Schema.NullOr(Schema.String).annotate({
		description:
			'ISO 3166-1 alpha-2 country hint (helps pick a registry); null if unknown',
	}),
})

// ── Tool results (unknown jsonb — agent treats as opaque blob) ──

const ToolResultSchema = Schema.Unknown

// ── Tool definitions ──

// A failed fetch (a dead URL, a provider 4xx) comes back to the model as a tool
// result instead of aborting the run, so one unreachable page or a forbidden
// extraction can't sink a whole research pass — the model reads the error and
// moves on to another source. All three web-fetch tools (search, scrape, extract)
// opt in; budget and registry failures stay fatal.
export const WebSearchTool = Tool.make('web_search', {
	description:
		'Search the public web for URLs relevant to a query. Returns a list of (url, title, snippet). Prefer this over scrape_page when you do not yet have a specific URL.',
	parameters: WebSearchParams,
	success: ToolResultSchema,
	failureMode: 'return',
})

export const ScrapePageTool = Tool.make('scrape_page', {
	description:
		'Fetch and parse a specific URL, returning markdown plus metadata. Use only after web_search has surfaced a concrete URL.',
	parameters: ScrapePageParams,
	success: ToolResultSchema,
	failureMode: 'return',
})

export const RegistryLookupTool = Tool.make('registry_lookup', {
	description:
		'Look up a company in its national business registry. Accepts any ISO country; one without a national registry returns {status:"no_registry"} — use discover_contacts for contact enrichment there. Metered (~€0.29/lookup), so use it to confirm a specific company rather than browsing. Returns legal name, tax id, status, and (when available) directors.',
	parameters: RegistryLookupParams,
	success: ToolResultSchema,
})

export const DiscoverContactsTool = Tool.make('discover_contacts', {
	description:
		'Find verified decision-maker contacts for a company: guesses likely emails, MX-gates them, and pays to verify deliverability. Metered against this run. Returns ranked candidates each with a deliverability verdict, or {status:"no_reliable_contact"}. Fold the results into contact_discovery_v1 findings; to persist a new contact, add a proposed_updates entry with operation:"create" carrying the contact and its channels.',
	parameters: DiscoverContactsParams,
	success: ToolResultSchema,
})

export const researchToolkit = Toolkit.make(
	WebSearchTool,
	ScrapePageTool,
	RegistryLookupTool,
	DiscoverContactsTool,
)

// ── Handler layer ──
// Each handler maps port-level ProviderError to AiErrorReason so tool-call
// failures land in the model's context as strings rather than killing the
// outer `generateText` effect.

// The tool-failure handlers below feed this a `Cause` (from `catchCause`), not
// a bare error. `String(cause)` would drop a tagged error's `message` — it
// extends `Error`, whose `message` is non-enumerable — leaving only
// `{provider,recoverable,_tag}` in the tool log, which never names the failing
// line. Squash the cause to its underlying error and read `.message` directly.
const errorMessage = (err: unknown): string => {
	if (typeof err === 'string') return err
	if (Cause.isCause(err)) return errorMessage(Cause.squash(err))
	if (err instanceof Error) return err.message
	return String(err)
}

const mapToolError = (toolName: string) => (err: unknown) =>
	Effect.fail(
		new AiError.UnknownError({
			description: `${toolName}: ${errorMessage(err)}`,
		}),
	)

// A model sometimes appends a made-up "site:" filter (e.g. site:example.com) to a
// search, which guarantees zero results. Detect the obvious placeholder hosts so
// such a filter can be dropped before the query reaches the provider.
const isPlaceholderSiteHost = (host: string): boolean => {
	const normalizedHost = host
		.toLowerCase()
		.replace(/^www\./, '')
		.replace(/[).,;:'"]+$/, '')
	return (
		/^example\.[a-z]{2,}$/.test(normalizedHost) ||
		normalizedHost === 'example' ||
		/^(your|my)domain\.[a-z]{2,}$/.test(normalizedHost) ||
		/^domain\.[a-z]{2,}$/.test(normalizedHost) ||
		/^placeholder\.[a-z]{2,}$/.test(normalizedHost) ||
		/^(your|my)site\.[a-z]{2,}$/.test(normalizedHost)
	)
}

/**
 * Removes any `site:` filter that targets an obvious placeholder host from a
 * search query. If stripping would leave nothing to search, the original query
 * is kept so the search still runs.
 */
export const stripPlaceholderSiteFilters = (query: string): string => {
	const stripped = query
		.replace(/\bsite:(\S+)/gi, (match, host: string) =>
			isPlaceholderSiteHost(host) ? '' : match,
		)
		.replace(/\s{2,}/g, ' ')
		.trim()
	return stripped.length > 0 ? stripped : query
}

// People directories the loop should not scrape: their staff/decision-maker data
// belongs in discover_contacts, and the scrape provider refuses them anyway
// (Firecrawl 403s LinkedIn). Skipping them up front spends no scrape on a fetch
// that can't help; the provider-side UnsupportedSite catch is the backstop for
// any site not listed here that the provider still turns away. Registrable hosts.
const SCRAPE_SKIP_HOSTS = new Set(['linkedin.com'])

const registrableHost = (url: string): string | undefined => {
	try {
		return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
	} catch {
		return undefined
	}
}

/**
 * Whether a URL points at a site the scrape provider won't fetch — LinkedIn and
 * other people directories. A subdomain (e.g. es.linkedin.com) counts too.
 */
export const isUnsupportedScrapeUrl = (url: string): boolean => {
	const host = registrableHost(url)
	if (host === undefined) return false
	return [...SCRAPE_SKIP_HOSTS].some(
		skip => host === skip || host.endsWith(`.${skip}`),
	)
}

/**
 * The model-facing result for a scrape the loop skips: not a failure, just a
 * pointer to fetch that data another way — discover_contacts for people, the
 * company's own site for the company. Mirrors `noRegistryResult`'s shape.
 */
export const scrapeSkipResult = (url: string) =>
	({
		status: 'skipped',
		url,
		reason: 'unsupported_site',
		message:
			"This site can't be fetched with scrape_page. For a company's decision-makers or staff, use discover_contacts with the company domain; for the company itself, scrape its official website instead.",
	}) as const

export const researchToolkitLayer = researchToolkit.toLayer(
	Effect.gen(function* () {
		const search = yield* SearchProvider
		const scrape = yield* ScrapeProvider
		const registry = yield* RegistryRouter
		const contactDiscovery = yield* ContactDiscovery
		const budget = yield* Budget
		const {
			researchId,
			language: hintLanguage,
			location: hintLocation,
		} = yield* ResearchRunContext

		// Charged against the run before each vendor call (cheap tier for
		// search/scrape, paid tier for the registry). When the budget
		// refuses, the refusal is handed back to the model as a tool result so it
		// stops using that tool and wraps up; the loop's own budget check is the
		// hard halt. Logged at warning (not error) since running out of budget is
		// an expected signal, not a failure.
		const cheapExhausted =
			(toolName: string) => (e: { readonly remaining: number }) =>
				Effect.logWarning('research.tool.budget_exhausted').pipe(
					Effect.annotateLogs({
						tool: toolName,
						'research.run_id': researchId,
						remaining_cents: e.remaining,
					}),
					Effect.andThen(
						mapToolError(toolName)(
							`cheap budget exhausted (${e.remaining}¢ left) — stop searching and summarize what you have`,
						),
					),
				)

		// A tool failure otherwise reaches the model and the run's tool_log but
		// never the telemetry backend, so a systemic failure (e.g. every
		// scrape_page call rejected by the object store) stays invisible outside
		// the DB. Logged here, before the cause is mapped to the model-facing
		// tool result, so it shows up in Honeycomb regardless of what kind of
		// failure it was.
		const logToolFailure =
			(toolName: string) => (cause: Cause.Cause<unknown>) =>
				Effect.logError('research.tool.failed').pipe(
					Effect.annotateLogs({
						tool: toolName,
						'research.run_id': researchId,
						cause: Cause.pretty(cause),
					}),
					Effect.andThen(mapToolError(toolName)(cause)),
				)

		// A scrape the provider refuses (or one of the known people directories) is
		// logged as a skip, not a failure, so it stays queryable without the
		// error-level noise a starved-run investigation would otherwise sift.
		const skipUnsupportedScrape = (url: string) =>
			Effect.logInfo('research.scrape.skipped_unsupported').pipe(
				Effect.annotateLogs({
					tool: 'scrape_page',
					'research.run_id': researchId,
					url,
					reason: 'unsupported_site',
				}),
				Effect.as(scrapeSkipResult(url)),
			)

		return researchToolkit.of({
			web_search: params =>
				Effect.gen(function* () {
					yield* budget.chargeCheap('search', SEARCH_COST_CENTS)
					// Drop a made-up placeholder site: filter (e.g. site:example.com)
					// so it can't force a zero-result search.
					const query = stripPlaceholderSiteFilters(params.query)
					if (query !== params.query) {
						yield* Effect.logWarning(
							'research.search.placeholder_site_stripped',
						).pipe(Effect.annotateLogs({ tool: 'web_search' }))
					}
					return yield* search.search({
						query,
						limit: params.limit ?? undefined,
						recency:
							params.recency_days != null
								? { days: params.recency_days }
								: undefined,
						// Fall back to the run's location hint when the model gives none, and
						// carry the run's language so the provider searches in the target's
						// own language rather than defaulting to English.
						location: params.location ?? hintLocation ?? undefined,
						languages: hintLanguage ? [hintLanguage] : undefined,
					})
				}).pipe(
					Effect.catchTag('BudgetExceeded', cheapExhausted('web_search')),
					Effect.catchCause(logToolFailure('web_search')),
					Effect.withSpan('research.tool.web_search', {
						attributes: {
							'research.tool': 'web_search',
							'research.run_id': researchId,
							query: params.query,
						},
					}),
				),

			scrape_page: params =>
				Effect.gen(function* () {
					// Skip a site the provider refuses (LinkedIn etc.) before spending a
					// scrape: hand the model a routing hint, not a guaranteed-failing fetch.
					if (isUnsupportedScrapeUrl(params.url)) {
						return yield* skipUnsupportedScrape(params.url)
					}
					yield* budget.chargeCheap('scrape', SCRAPE_COST_CENTS)
					const page = yield* scrape.scrape({
						url: params.url,
						formats: ['markdown'],
					})
					return page.markdown !== undefined &&
						page.markdown.length > SCRAPE_MARKDOWN_MAX_CHARS
						? new ScrapedPage({
								...page,
								markdown: `${page.markdown.slice(0, SCRAPE_MARKDOWN_MAX_CHARS)}…[truncated]`,
							})
						: page
				}).pipe(
					// The provider refused the site (a 403 no key or retry can fix):
					// skip the URL and let the loop keep going, rather than logging a
					// failure and handing the model an error it can't act on.
					Effect.catchTag('UnsupportedSite', e => skipUnsupportedScrape(e.url)),
					Effect.catchTag('BudgetExceeded', cheapExhausted('scrape_page')),
					Effect.catchCause(logToolFailure('scrape_page')),
					Effect.withSpan('research.tool.scrape_page', {
						attributes: {
							'research.tool': 'scrape_page',
							'research.run_id': researchId,
							url: params.url,
						},
					}),
				),

			registry_lookup: params =>
				Effect.gen(function* () {
					const country = params.country.toUpperCase()
					// Deterministic key: a resumed run re-charging the same lookup is
					// a DB no-op, so a crash mid-run never double-charges for it.
					const idempotencyKey = `${researchId}:registry:${country}:${params.tax_id ?? params.query ?? ''}`
					yield* budget.chargePaid(
						'registry',
						REGISTRY_LOOKUP_COST_CENTS,
						'registry_lookup',
						idempotencyKey,
					)
					return yield* registry.lookup({
						country,
						query: params.query ?? undefined,
						taxId: params.tax_id ?? undefined,
					})
				}).pipe(
					// A registry-less country is a routing answer, not a failure:
					// hand it back as data so the model can switch to discover_contacts.
					Effect.catchTag('NoRegistry', e =>
						Effect.succeed(noRegistryResult(e.country)),
					),
					Effect.catchTag('BudgetExceeded', e =>
						mapToolError('registry_lookup')(
							`paid budget exhausted (${e.remaining}¢ left) — stop using registry_lookup`,
						),
					),
					Effect.catchTag('MonthlyCapExceeded', e =>
						mapToolError('registry_lookup')(
							`monthly paid cap reached (${e.spentCents}/${e.capCents}¢) — stop using registry_lookup`,
						),
					),
					Effect.catchCause(cause => mapToolError('registry_lookup')(cause)),
				),

			// Reuses this run's id + budget so paid enrichment/verification lands on
			// the run and its cap applies — no separate anchor run or allowance.
			discover_contacts: params =>
				contactDiscovery
					.discover({
						companyName: params.company_name,
						domain: params.domain,
						country: params.country ?? undefined,
						runContext: { researchId, budget },
					})
					.pipe(
						Effect.catchCause(cause =>
							mapToolError('discover_contacts')(cause),
						),
					),
		})
	}),
)
