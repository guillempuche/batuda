/**
 * The one hash and the one deterministic serializer every cache key in the
 * package is built from. Both caches and the research cache key read the same
 * bytes, so a change here moves every stored key at once; the pin test holds
 * the exact output so that cannot happen quietly.
 */

import { createHash } from 'node:crypto'

export const sha256Hex = (input: string): string =>
	createHash('sha256').update(input).digest('hex')

/**
 * JSON with object keys sorted and function values dropped, so two callers
 * passing the same fields in a different order hash the same. An object met
 * twice on one walk reads as `"[circular]"`, a shared reference included.
 */
export const stableStringify = (value: unknown): string => {
	const seen = new WeakSet<object>()
	const walk = (v: unknown): unknown => {
		if (v === null || typeof v !== 'object') return v
		if (seen.has(v as object)) return '[circular]'
		seen.add(v as object)
		if (Array.isArray(v)) return v.map(walk)
		return Object.fromEntries(
			Object.entries(v as Record<string, unknown>)
				.filter(([, val]) => typeof val !== 'function')
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([k, val]) => [k, walk(val)] as const),
		)
	}
	return JSON.stringify(walk(value))
}
