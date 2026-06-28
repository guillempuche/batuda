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
	municipality: Schema.optional(Schema.String),
	province: Schema.optional(Schema.String),
	sector: Schema.optional(Schema.String),
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

/**
 * Deliverability verdict for a guessed or found email, shared across the
 * enrichment and verification steps of contact discovery.
 */
export const VERIFICATION_VERDICTS = [
	'deliverable',
	'risky',
	'catch_all',
	'undeliverable',
	'unknown',
] as const
export const VerificationVerdict = Schema.Literals(VERIFICATION_VERDICTS)
export type VerificationVerdict = (typeof VERIFICATION_VERDICTS)[number]

/** People found for a company domain by an enrichment vendor (Hunter/Apollo). */
export class EnrichmentResult extends Schema.Class<EnrichmentResult>(
	'EnrichmentResult',
)({
	people: Schema.Array(
		Schema.Struct({
			firstName: Schema.String,
			lastName: Schema.String,
			position: Schema.optional(Schema.String),
			seniority: Schema.optional(Schema.String),
			department: Schema.optional(Schema.String),
			email: Schema.optional(Schema.String),
			emailConfidence: Schema.optional(Schema.Number),
			// 'personal' | 'generic' (role mailbox) — generic ones rank lowest.
			type: Schema.optional(Schema.String),
			// A verdict the vendor already established for `email`, so the
			// pipeline can skip a redundant paid verification call.
			verification: Schema.optional(VerificationVerdict),
			// Other channels the vendor returns for the same person (data-only —
			// no verification today). Open-ended; only the ones a vendor fills
			// are present. `x` carries the handle from Hunter's `twitter` field.
			linkedin: Schema.optional(Schema.String),
			x: Schema.optional(Schema.String),
			phone: Schema.optional(Schema.String),
		}),
	),
	units: Schema.Number,
}) {}

/** Deliverability check on a single email address. */
export class EmailVerification extends Schema.Class<EmailVerification>(
	'EmailVerification',
)({
	result: VerificationVerdict,
	score: Schema.optional(Schema.Number),
	catchAll: Schema.optional(Schema.Boolean),
	mxFound: Schema.Boolean,
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
