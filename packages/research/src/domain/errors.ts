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
		/**
		 * The vendor refused because the account's paid allowance is spent, rather
		 * than because it had nothing to say. The two look identical to a caller
		 * that only sees an empty result, and they mean opposite things: one is a
		 * bill to pay, the other is an answer.
		 */
		quotaExhausted: Schema.optional(Schema.Boolean),
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

/**
 * A run named a company or contact it cannot read — it belongs to another
 * organization, or it was deleted between the run being asked for and the run
 * starting. Terminal: the record it was pinned to is what grounds the whole
 * run, so carrying on would research whatever the free text alone suggests
 * and report it as if the record had been read.
 */
export class SubjectUnavailable extends Schema.TaggedErrorClass<SubjectUnavailable>()(
	'SubjectUnavailable',
	{
		subjects: Schema.Array(
			Schema.Struct({ table: Schema.String, id: Schema.String }),
		),
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
/**
 * This run already bought this exact lookup, and the answer is earlier in the
 * run's own transcript. A routing outcome, not a failure: buying it again would
 * be paying a second time for something already in hand.
 */
export const alreadyLookedUpResult = (subject: string) => ({
	status: 'already_looked_up' as const,
	subject,
	message: `This run already looked up ${subject}. Its result is earlier in this transcript — use it rather than looking it up again.`,
})

export const noRegistryResult = (country: string) => ({
	status: 'no_registry' as const,
	country,
	message: `No national business registry for ${country}. Use discover_contacts for contact enrichment.`,
})

/**
 * A tool that spends money, reached by a run that may not spend it. A scan is
 * handed a list of companies to work through, so buying a record about one of
 * them is work for a run about that one company — which a person starts, from
 * what the scan proposes.
 */
export const paidToolBarredResult = (tool: string) => ({
	status: 'not_available_here' as const,
	tool,
	message: `${tool} is not available on a list-of-companies search, because it spends money on one company at a time. Record it under pending_paid_actions with the company it is for, and a person decides whether to run it.`,
})

/**
 * The register exists but our account has no credit left to ask it, so no lookup
 * in this run will be answered. Kept apart from `no_registry`, which says the
 * country has no register at all: this one is a fact about us, and a run that
 * confuses the two reports a gap in our billing as a gap in the record.
 */
export const registryUnavailableResult = (country: string) => ({
	status: 'registry_unavailable' as const,
	country,
	message: `The ${country} business registry cannot be reached this run — our paid allowance for it is spent, which is about us and not about the company. Do not look it up again; carry on with the open web, and say plainly that the register went unchecked rather than that the company is not on it.`,
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
