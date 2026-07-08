/**
 * Route-matching helpers for the nav, kept free of Lingui/lucide imports so
 * they can be unit-tested in a plain Node environment (the nav data in
 * `nav-items.ts` pulls in the `msg` macro, which only exists after the
 * build-time transform). The types are structural on purpose — `NavItem`
 * and `NavGroup` satisfy them without importing the concrete definitions.
 */

export type MatchableItem = {
	readonly path: string
	readonly exact?: boolean | undefined
}

export type MatchableGroup = {
	readonly items: ReadonlyArray<MatchableItem>
}

/**
 * Whether the current pathname sits under a nav item. `exact` items (the
 * Pipeline root `/`) only match their own path; the rest also match any
 * nested route so a detail page keeps its section lit.
 */
export function navItemMatches(pathname: string, item: MatchableItem): boolean {
	if (item.exact === true) return pathname === item.path
	return pathname === item.path || pathname.startsWith(`${item.path}/`)
}

/** A belt slot lights up when the current route matches any of its members. */
export function navGroupActive(
	pathname: string,
	group: MatchableGroup,
): boolean {
	return group.items.some(item => navItemMatches(pathname, item))
}
