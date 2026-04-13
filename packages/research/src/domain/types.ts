import { Schema } from 'effect'

// ── Shared value types across all research providers ──

/** A single search result from any search provider. */
export class SearchResultItem extends Schema.Class<SearchResultItem>(
	'SearchResultItem',
)({
	url: Schema.String,
	title: Schema.String,
	snippet: Schema.String,
	publishedAt: Schema.optional(Schema.DateTimeUtc),
	score: Schema.optional(Schema.Number),
}) {}

export class SearchResult extends Schema.Class<SearchResult>('SearchResult')({
	items: Schema.Array(SearchResultItem),
	units: Schema.Number,
}) {}

/** A scraped page returned by ScrapeProvider. */
export class ScrapedPage extends Schema.Class<ScrapedPage>('ScrapedPage')({
	url: Schema.String,
	markdown: Schema.optional(Schema.String),
	html: Schema.optional(Schema.String),
	links: Schema.optional(Schema.Array(Schema.String)),
	title: Schema.optional(Schema.String),
	language: Schema.optional(Schema.String),
	contentHash: Schema.String,
	units: Schema.Number,
}) {}

/** Result of an autonomous browsing session (DiscoverProvider). */
export class DiscoverResult extends Schema.Class<DiscoverResult>(
	'DiscoverResult',
)({
	findings: Schema.String,
	structuredData: Schema.optional(Schema.Unknown),
	sourcesVisited: Schema.Array(Schema.String),
	units: Schema.Number,
}) {}

/** A reference to an external async job (e.g. Firecrawl agent). */
export class ExternalJobRef extends Schema.Class<ExternalJobRef>(
	'ExternalJobRef',
)({
	provider: Schema.String,
	jobId: Schema.String,
}) {}

/** A company record from a free registry (e.g. libreBORME). */
export class RegistryRecord extends Schema.Class<RegistryRecord>(
	'RegistryRecord',
)({
	legalName: Schema.String,
	taxId: Schema.optional(Schema.String),
	status: Schema.optional(Schema.String),
	incorporationDate: Schema.optional(Schema.String),
	capital: Schema.optional(Schema.String),
	address: Schema.optional(Schema.String),
	directors: Schema.optional(
		Schema.Array(
			Schema.Struct({
				name: Schema.String,
				role: Schema.optional(Schema.String),
				since: Schema.optional(Schema.String),
			}),
		),
	),
	raw: Schema.optional(Schema.Unknown),
	units: Schema.Number,
}) {}

/** A paid company report (e.g. einforma). */
export class CompanyReport extends Schema.Class<CompanyReport>('CompanyReport')(
	{
		legalName: Schema.String,
		taxId: Schema.String,
		depth: Schema.Literals(['basic', 'financials', 'full']),
		financials: Schema.optional(Schema.Unknown),
		shareholders: Schema.optional(Schema.Unknown),
		riskScore: Schema.optional(Schema.Number),
		raw: Schema.optional(Schema.Unknown),
		units: Schema.Number,
	},
) {}

/** Budget snapshot at a point in time. */
export class BudgetSnapshot extends Schema.Class<BudgetSnapshot>(
	'BudgetSnapshot',
)({
	cheapBudget: Schema.Number,
	cheapSpent: Schema.Number,
	cheapRemaining: Schema.Number,
	paidBudget: Schema.Number,
	paidSpent: Schema.Number,
	paidRemaining: Schema.Number,
}) {}

/** Resolved spending policy for a single run. Frozen on research_runs.paid_policy. */
export class ResolvedPolicy extends Schema.Class<ResolvedPolicy>(
	'ResolvedPolicy',
)({
	budgetCents: Schema.Number,
	paidBudgetCents: Schema.Number,
	autoApprovePaidCents: Schema.Number,
	paidMonthlyCapCents: Schema.Number,
}) {}
