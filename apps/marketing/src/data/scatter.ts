import type { CSSProperties } from 'react'

/**
 * Deterministic pseudo-random scatter for workshop card placement.
 *
 * Returns CSS custom properties that components read via var() with fallbacks.
 * Set `style={scatter(index)}` on a card wrapper — all children inherit.
 *
 * To add a new dimension: add a spread() call here, consume via var() in the component.
 */

/* `MotionStyle` from motion redefines a handful of CSS shorthand keys
 * (`rotate`, `scale`, `perspective`, `x`, `y`, `z`) and disallows
 * `undefined` for them. We don't touch those — only CSS custom properties —
 * so we omit them from the scatter return type to keep `style={scatter(i)}`
 * assignable to both plain `<div>` and `<motion.div>`. The omit set must
 * match `MotionCSS` in `framer-motion/dist/m.d.ts`. */
type ScatterStyle = Omit<
	CSSProperties,
	'rotate' | 'scale' | 'perspective' | 'x' | 'y' | 'z'
>

/** Deterministic hash: integer → float [0, 1). Uses Murmur-inspired bit mixing. */
function hash(n: number): number {
	let h = Math.imul(n | 0, 0x9e3779b9) | 0
	h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) | 0
	h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) | 0
	return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff
}

/** Map (seed, channel) → float in [-max, +max]. Each channel produces independent values. */
function spread(seed: number, channel: number, max: number): number {
	return (hash(seed * 7 + channel * 13) * 2 - 1) * max
}

/** Map (seed, channel) → float in [center - range, center + range]. */
function around(
	seed: number,
	channel: number,
	center: number,
	range: number,
): number {
	return center + spread(seed, channel, range)
}

export function scatter(index: number): ScatterStyle {
	return {
		'--scatter-rotate': `${spread(index, 0, 1.1).toFixed(2)}deg`,
		'--scatter-dx': `${spread(index, 1, 1).toFixed(2)}px`,
		'--scatter-dy': `${spread(index, 2, 0.8).toFixed(2)}px`,
		'--scatter-grad': `${around(index, 3, 160, 10).toFixed(1)}deg`,
		'--scatter-shadow-x': `${spread(index, 4, 1.5).toFixed(2)}px`,
		'--scatter-shadow-y': `${around(index, 5, 2, 1).toFixed(2)}px`,
		'--scatter-pin-dx': `${spread(index, 6, 3).toFixed(1)}px`,
		'--scatter-hue': `${spread(index, 7, 3).toFixed(1)}deg`,
		'--scatter-pin-hue': `${spread(index, 8, 8).toFixed(1)}deg`,
	} as ScatterStyle
}

/** Micro-scatter for small inline elements (IO tags). Lighter range. */
export function microScatter(index: number): ScatterStyle {
	return {
		'--tag-rotate': `${spread(index, 9, 1.5).toFixed(2)}deg`,
	} as ScatterStyle
}
