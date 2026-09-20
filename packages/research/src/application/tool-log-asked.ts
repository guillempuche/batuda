/**
 * What a provider call asked for, as the run's own tool log records it: the
 * words a search went out with, the page a scrape opened. Short on purpose —
 * the log is a trail to read, and the answers are stored elsewhere.
 */

import { isPlainObject } from './guard-shapes'

/** How much of a query or an address the tool log keeps. */
export const MAX_LOGGED_ASK_CHARS = 200

const bounded = (text: string): string =>
	text.length > MAX_LOGGED_ASK_CHARS
		? `${text.slice(0, MAX_LOGGED_ASK_CHARS)}…`
		: text

const ASKED_FIELD: Readonly<Record<string, 'query' | 'url'>> = {
	web_search: 'query',
	scrape_page: 'url',
}

/**
 * The one thing worth keeping of a call's parameters, under its own name, or
 * nothing for a tool whose parameters name a company or a person — those are
 * on the run's row already and have no place being repeated per call.
 */
export const whatTheCallAsked = (
	toolName: string,
	params: unknown,
): { readonly query?: string; readonly url?: string } => {
	const field = ASKED_FIELD[toolName]
	if (field === undefined || !isPlainObject(params)) return {}
	const asked = params[field]
	if (typeof asked !== 'string' || asked.trim() === '') return {}
	return { [field]: bounded(asked) }
}
