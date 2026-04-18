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

import { Effect, Schema } from 'effect'
import { AiError, Tool, Toolkit } from 'effect/unstable/ai'

import { SUPPORTED_COUNTRIES } from '../domain/country'
import {
	ExtractProvider,
	RegistryRouter,
	ScrapeProvider,
	SearchProvider,
} from './ports'
import { schemaRegistry } from './schemas/index'

// ── Tool parameter schemas ──

const WebSearchParams = Schema.Struct({
	query: Schema.String.annotate({
		description: 'Search query; concise keywords work best',
	}),
	limit: Schema.optional(Schema.Number).annotate({
		description: 'Max results to return (default 10)',
	}),
	recency_days: Schema.optional(Schema.Number).annotate({
		description:
			'Restrict to results published within the last N days. Omit for no filter.',
	}),
	location: Schema.optional(Schema.String).annotate({
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
	prompt: Schema.optional(Schema.String).annotate({
		description:
			'Optional extra guidance for the extractor (e.g. "focus on revenue figures").',
	}),
})

const RegistryLookupParams = Schema.Struct({
	country: Schema.Literals(SUPPORTED_COUNTRIES).annotate({
		description: 'ISO country code; determines which registry to query',
	}),
	query: Schema.optional(Schema.String).annotate({
		description: 'Company name or fuzzy search string',
	}),
	tax_id: Schema.optional(Schema.String).annotate({
		description: 'National tax id (e.g. ES CIF/NIF) — more precise than query',
	}),
})

// ── Tool results (unknown jsonb — agent treats as opaque blob) ──

const ToolResultSchema = Schema.Unknown

// ── Tool definitions ──

export const WebSearchTool = Tool.make('web_search', {
	description:
		'Search the public web for URLs relevant to a query. Returns a list of (url, title, snippet). Prefer this over scrape_page when you do not yet have a specific URL.',
	parameters: WebSearchParams,
	success: ToolResultSchema,
})

export const ScrapePageTool = Tool.make('scrape_page', {
	description:
		'Fetch and parse a specific URL, returning markdown plus metadata. Use only after web_search has surfaced a concrete URL.',
	parameters: ScrapePageParams,
	success: ToolResultSchema,
})

export const ExtractStructuredTool = Tool.make('extract_structured', {
	description:
		'Re-extract a page into a named structured schema. Use when downstream consumers need typed fields rather than prose.',
	parameters: ExtractStructuredParams,
	success: ToolResultSchema,
})

export const RegistryLookupTool = Tool.make('registry_lookup', {
	description:
		'Look up a company in its national business registry (free tier). Returns legal name, tax id, status, and (when available) directors. Paid reports are not exposed to the agent.',
	parameters: RegistryLookupParams,
	success: ToolResultSchema,
})

export const researchToolkit = Toolkit.make(
	WebSearchTool,
	ScrapePageTool,
	ExtractStructuredTool,
	RegistryLookupTool,
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

export const researchToolkitLayer = researchToolkit.toLayer(
	Effect.gen(function* () {
		const search = yield* SearchProvider
		const scrape = yield* ScrapeProvider
		const extract = yield* ExtractProvider
		const registry = yield* RegistryRouter

		return researchToolkit.of({
			web_search: params =>
				search
					.search({
						query: params.query,
						limit: params.limit,
						recency:
							params.recency_days !== undefined
								? { days: params.recency_days }
								: undefined,
						location: params.location,
					})
					.pipe(Effect.catchCause(cause => mapToolError('web_search')(cause))),

			scrape_page: params =>
				scrape
					.scrape({ url: params.url, formats: ['markdown'] })
					.pipe(Effect.catchCause(cause => mapToolError('scrape_page')(cause))),

			extract_structured: params => {
				const schema = schemaRegistry[params.schema_name]
				if (!schema) {
					return mapToolError('extract_structured')(
						`Unknown schema_name: ${params.schema_name}. Valid names: ${Object.keys(schemaRegistry).join(', ')}`,
					)
				}
				return extract
					.extract({
						url: params.url,
						schema,
						schemaName: params.schema_name,
						prompt: params.prompt,
					})
					.pipe(
						Effect.catchCause(cause =>
							mapToolError('extract_structured')(cause),
						),
					)
			},

			registry_lookup: params =>
				registry
					.lookup({
						country: params.country,
						query: params.query,
						taxId: params.tax_id,
					})
					.pipe(
						Effect.catchCause(cause => mapToolError('registry_lookup')(cause)),
					),
		})
	}),
)
