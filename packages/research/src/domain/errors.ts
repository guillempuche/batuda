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

/** Paid call above auto-approve threshold. LLM should call propose_paid_action. */
export class ApprovalRequired extends Schema.TaggedErrorClass<ApprovalRequired>()(
	'ApprovalRequired',
	{
		tool: Schema.String,
		estimatedCents: Schema.Number,
	},
) {}
