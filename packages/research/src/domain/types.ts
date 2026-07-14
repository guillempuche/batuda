import { Schema } from 'effect'

// ── Shared value types across all research providers ──

/** A single search result from any search provider. */
export class SearchResultItem extends Schema.Class<SearchResultItem>(
	'SearchResultItem',
)({
	url: Schema.String,
	title: Schema.String,
	snippet: Schema.String,
	// Richer per-result context beyond the one-line snippet: the page's main
	// content as markdown (Firecrawl `scrapeOptions`) or a provider's extra
	// excerpts (Brave `extra_snippets`). Present only when the provider returns
	// it; a result with real page content can also ground the run.
	content: Schema.optional(Schema.String),
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
	// The final URL after the fetch followed any redirects — differs from `url`
	// when the requested address 301/302s elsewhere (e.g. a rebranded domain).
	// Absent when the provider doesn't report it or nothing redirected.
	resolvedUrl: Schema.optional(Schema.String),
	markdown: Schema.optional(Schema.String),
	html: Schema.optional(Schema.String),
	links: Schema.optional(Schema.Array(Schema.String)),
	title: Schema.optional(Schema.String),
	language: Schema.optional(Schema.String),
	contentHash: Schema.String,
	units: Schema.Number,
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

/**
 * Why a run ended without usable data — a structured code the UI localizes and
 * the eval aggregates, instead of an English sentence buried in findings.error.
 * (site_unreadable and name_too_generic are reserved for the grounding-retry and
 * generic-name paths and may not be written at a terminal-failure site yet.)
 */
export const RESEARCH_REASON_CODES = [
	'entity_mismatch',
	'weak_no_official_site',
	'site_unreadable',
	'name_too_generic',
	'no_sources',
	'internal_error',
] as const
export const ReasonCode = Schema.Literals(RESEARCH_REASON_CODES)
export type ReasonCode = (typeof RESEARCH_REASON_CODES)[number]

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
	// The 0–100 confidence at or above which an eligible finding applies without
	// review; null keeps everything waiting for a human.
	autoApplyMinConfidence: Schema.NullOr(Schema.Number),
}) {}
