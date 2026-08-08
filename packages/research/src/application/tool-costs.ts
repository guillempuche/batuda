/**
 * What the run's spending limit is charged per tool call, in cents.
 *
 * These are flat estimates, not what a call really costs — a run needs a
 * predictable figure before the call to decide whether it can still afford to
 * continue, and a real price arriving afterwards cannot answer that. What a run
 * was actually billed is recorded separately (see `usage-meter.ts`).
 *
 * The cheap tools (search/scrape) draw the run's cheap tier; the registry lookup
 * is a metered paid call (~€0.29). These live in one place so the loop's
 * affordability check and the tool handlers charge the same amounts — if they
 * drifted, the loop could keep spinning on a tool it can no longer afford, or
 * stop while budget remained.
 */

export const SEARCH_COST_CENTS = 1
export const SCRAPE_COST_CENTS = 1

/** Cheapest cheap-tier tool, used by the loop to know if any cheap tool is still fundable. */
export const CHEAP_MIN_COST_CENTS = 1

export const REGISTRY_LOOKUP_COST_CENTS = 29

// Finding decision-makers for a company. Hunter and FullEnrich sell credits
// rather than per-call prices, so these are flat figures that meter the run's
// budget and the month's cap without mirroring a credit sheet. Kept per-vendor
// so a spend row names the finder that actually ran.
export const ENRICH_COST_CENTS = 5
export const FULLENRICH_COST_CENTS = 6
export const VERIFY_COST_CENTS = 1
