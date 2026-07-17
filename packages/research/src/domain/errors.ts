import { Schema } from 'effect'

// ── Research domain errors ──
// These are internal to the research bounded context. The server maps them
// to HTTP errors at the handler layer (e.g., BudgetExceeded → 409). They
// are Schema.TaggedErrorClass so they serialize over SSE tool error events.

/** External provider call failed (Firecrawl, Exa, libreBORME, etc.). */
export class ProviderError extends Schema.TaggedErrorClass<ProviderError>()(
	'ProviderError',
	{
		provider: Schema.String,
		message: Schema.String,
		recoverable: Schema.Boolean,
	},
) {}

/** Per-run resource budget (cheap or paid tier) exceeded. */
export class BudgetExceeded extends Schema.TaggedErrorClass<BudgetExceeded>()(
	'BudgetExceeded',
	{
		tier: Schema.Literals(['cheap', 'paid-run']),
		needed: Schema.Number,
		remaining: Schema.Number,
	},
) {}

/** Per-user monthly paid spend cap exceeded. Terminal for the run. */
export class MonthlyCapExceeded extends Schema.TaggedErrorClass<MonthlyCapExceeded>()(
	'MonthlyCapExceeded',
	{
		capCents: Schema.Number,
		spentCents: Schema.Number,
	},
) {}

/** Provider quota (native units) exhausted. Recoverable: try alternative. */
export class QuotaExhausted extends Schema.TaggedErrorClass<QuotaExhausted>()(
	'QuotaExhausted',
	{
		provider: Schema.String,
		unit: Schema.String,
		remaining: Schema.Number,
	},
) {}

/**
 * A paid call whose cost is over the user's auto-approve limit. Raised in-run
 * instead of spending; the model records it under findings.pending_paid_actions
 * for the user to approve (resolve_research_paid_action) rather than retrying.
 */
export class ApprovalRequired extends Schema.TaggedErrorClass<ApprovalRequired>()(
	'ApprovalRequired',
	{
		tool: Schema.String,
		estimatedCents: Schema.Number,
	},
) {}

/** The approval gate rendered as a plain result value the model can act on. */
export const approvalRequiredResult = (
	tool: string,
	estimatedCents: number,
) => ({
	status: 'approval_required' as const,
	tool,
	estimated_cents: estimatedCents,
	message: `Paid ${tool} (~${estimatedCents}¢) is over the auto-approve limit — record it under pending_paid_actions for the user to approve instead of retrying.`,
})

/**
 * The requested country has no national business registry — a routing outcome,
 * not a failure. It marks the lookup as one to satisfy through universal
 * contact enrichment instead of a registry.
 */
export class NoRegistry extends Schema.TaggedErrorClass<NoRegistry>()(
	'NoRegistry',
	{
		country: Schema.String,
	},
) {}

/** The no_registry outcome rendered as a plain result value. */
export const noRegistryResult = (country: string) => ({
	status: 'no_registry' as const,
	country,
	message: `No national business registry for ${country}. Use discover_contacts for contact enrichment.`,
})

/**
 * The scrape provider flatly refuses this site — Firecrawl answers a page fetch
 * with "we do not support this site" (LinkedIn and other people directories).
 * A routing outcome, not a failure: the page can never be fetched no matter the
 * key or the retry, so the run should skip it and gather that data another way
 * (its own official site, or discover_contacts for people). Kept distinct from
 * ProviderError so it neither retries, cascades to another key, nor counts as a
 * tool failure.
 */
export class UnsupportedSite extends Schema.TaggedErrorClass<UnsupportedSite>()(
	'UnsupportedSite',
	{
		provider: Schema.String,
		url: Schema.String,
	},
) {}
