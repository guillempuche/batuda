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
	ExtractProvider,
	RegistryRouter,
	ResearchRunContext,
	ScrapeProvider,
	SearchProvider,
} from './ports'
import { schemaRegistry } from './schemas/index'
import {
	EXTRACT_COST_CENTS,
	REGISTRY_LOOKUP_COST_CENTS,
	SCRAPE_COST_CENTS,
	SEARCH_COST_CENTS,
} from './tool-costs'

// Cap a scraped page before the model sees it: the reflect loop re-sends every
// round's tool results, so an uncapped page would grow the running prompt past
// the model's context window over several rounds.
const SCRAPE_MARKDOWN_MAX_CHARS = 8000

// ── Tool parameter schemas ──
// Optional params accept `null` (via `NullOr`) because a model may send an
// explicit `null` for a field it isn't using instead of omitting it; the
// handlers below treat that null as "not provided".

const WebSearchParams = Schema.Struct({
	query: Schema.String.annotate({
		description: 'Search query; concise keywords work best',
	}),
	limit: Schema.optionalKey(Schema.NullOr(Schema.Number)).annotate({
		description: 'Max results to return (default 10)',
	}),
	recency_days: Schema.optionalKey(Schema.NullOr(Schema.Number)).annotate({
		description:
			'Restrict to results published within the last N days. Omit for no filter.',
	}),
	location: Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
		description: 'Geographic locale hint (e.g. "ES", "es-ES")',
	}),
})

const ScrapePageParams = Schema.Struct({
	url: Schema.String.annotate({ description: 'Absolute URL to scrape' }),
})

const ExtractStructuredParams = Schema.Struct({
	url: Schema.String.annotate({
		description: 'URL of the page whose content should be re-extracted',
	}),
	schema_name: Schema.String.annotate({
		description: `Name of a registered schema. One of: ${Object.keys(schemaRegistry).join(', ')}`,
	}),
	prompt: Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
		description:
			'Optional extra guidance for the extractor (e.g. "focus on revenue figures").',
	}),
})

const RegistryLookupParams = Schema.Struct({
	country: AcceptedCountry.annotate({
		description:
			'ISO 3166-1 alpha-2 country code (any case). A country without a national registry returns {status:"no_registry"} — use discover_contacts there instead.',
	}),
	query: Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
		description: 'Company name or fuzzy search string',
	}),
	tax_id: Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
		description: 'National tax id (e.g. ES CIF/NIF) — more precise than query',
	}),
})

const DiscoverContactsParams = Schema.Struct({
	company_name: Schema.String.annotate({
		description: 'Company legal or trading name',
	}),
	domain: Schema.String.annotate({
		description: 'Company web domain, e.g. "acme.com" (no scheme, no @)',
	}),
	country: Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
		description: 'ISO 3166-1 alpha-2 country hint (helps pick a registry)',
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

export const ExtractStructuredTool = Tool.make('extract_structured', {
	description:
		'Re-extract a page into a named structured schema. Use when downstream consumers need typed fields rather than prose.',
	parameters: ExtractStructuredParams,
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
	ExtractStructuredTool,
	RegistryLookupTool,
	DiscoverContactsTool,
)

// ── Handler layer ──
// Each handler maps port-level ProviderError to AiErrorReason so tool-call
// failures land in the model's context as strings rather than killing the
// outer `generateText` effect.

const errorMessage = (err: unknown): string =>
	err instanceof Error ? err.message : String(err)

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

export const researchToolkitLayer = researchToolkit.toLayer(
	Effect.gen(function* () {
		const search = yield* SearchProvider
		const scrape = yield* ScrapeProvider
		const extract = yield* ExtractProvider
		const registry = yield* RegistryRouter
		const contactDiscovery = yield* ContactDiscovery
		const budget = yield* Budget
		const { researchId } = yield* ResearchRunContext

		// Charged against the run before each vendor call (cheap tier for
		// search/scrape/extract, paid tier for the registry). When the budget
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
						location: params.location ?? undefined,
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

			extract_structured: params => {
				// Both branches reuse these span options so the early return still
				// emits a research.tool.extract_structured span, but only the
				// extraction branch runs through catchCause below. An unknown
				// schema_name is an expected, model-caused error whose message is
				// already clean; sending it through catchCause too would re-wrap and
				// pretty-print the cause, burying that message in an unreadable dump.
				const spanOptions = {
					attributes: {
						'research.tool': 'extract_structured',
						'research.run_id': researchId,
						url: params.url,
						schema_name: params.schema_name,
					},
				}
				const schema = schemaRegistry[params.schema_name]
				if (!schema) {
					return mapToolError('extract_structured')(
						`Unknown schema_name: ${params.schema_name}. Valid names: ${Object.keys(schemaRegistry).join(', ')}`,
					).pipe(
						Effect.withSpan('research.tool.extract_structured', spanOptions),
					)
				}
				return Effect.gen(function* () {
					yield* budget.chargeCheap('extract', EXTRACT_COST_CENTS)
					return yield* extract.extract({
						url: params.url,
						schema,
						schemaName: params.schema_name,
						prompt: params.prompt ?? undefined,
					})
				}).pipe(
					Effect.catchTag(
						'BudgetExceeded',
						cheapExhausted('extract_structured'),
					),
					Effect.catchCause(logToolFailure('extract_structured')),
					Effect.withSpan('research.tool.extract_structured', spanOptions),
				)
			},

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
