/**
 * Budget cost per research-loop tool, in cents.
 *
 * The cheap tools (search/scrape/extract) draw the run's cheap tier; the
 * registry lookup is a metered paid call (~€0.29). These live in one place so
 * the loop's affordability check and the tool handlers charge the same amounts
 * — if they drifted, the loop could keep spinning on a tool it can no longer
 * afford, or stop while budget remained.
 */

export const SEARCH_COST_CENTS = 1
export const SCRAPE_COST_CENTS = 1
export const EXTRACT_COST_CENTS = 2

/** Cheapest cheap-tier tool, used by the loop to know if any cheap tool is still fundable. */
export const CHEAP_MIN_COST_CENTS = 1

export const REGISTRY_LOOKUP_COST_CENTS = 29
