/**
 * Checks that every theme keeps enough contrast between text and the surface
 * behind it, reading the real token file rather than a copy of the numbers.
 *
 * The written-down contrast tables in docs/brand-visual.md drifted from the
 * code once already; this makes them a check rather than a claim.
 *
 * Run: pnpm --filter @batuda/ui check-contrast
 */

// biome-ignore-all lint/suspicious/noConsole: a command-line check reports through stdout

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const TOKENS = fileURLToPath(new URL('../src/tokens.css', import.meta.url))

/* Perceived brightness, per WCAG. */
function luminance(hex: string): number {
	const h = hex.trim().replace('#', '')
	const full =
		h.length === 3
			? h
					.split('')
					.map(c => c + c)
					.join('')
			: h
	const channel = (i: number) => {
		const v = Number.parseInt(full.slice(i, i + 2), 16) / 255
		return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
	}
	return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

function ratio(a: string, b: string): number {
	const [x, y] = [luminance(a), luminance(b)]
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/* Pull one rule's declarations out of the stylesheet.
 *
 * `occurrence` matters: a selector that is also one line of a grouped selector
 * appears twice, and taking the first match silently reads the wrong rule —
 * which reports the wrong theme's numbers while looking entirely plausible.
 * The high-contrast block is the later of the two, so it asks for 'last'. */
function ruleBody(
	css: string,
	selector: string,
	occurrence: 'first' | 'last' = 'first',
): Record<string, string> {
	const at =
		occurrence === 'last' ? css.lastIndexOf(selector) : css.indexOf(selector)
	if (at === -1) throw new Error(`selector not found: ${selector}`)
	const open = css.indexOf('{', at)
	let depth = 0
	let close = open
	for (let i = open; i < css.length; i++) {
		if (css[i] === '{') depth++
		else if (css[i] === '}' && --depth === 0) {
			close = i
			break
		}
	}
	const out: Record<string, string> = {}
	for (const m of css
		.slice(open, close)
		.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
		out[m[1] as string] = (m[2] as string).trim()
	}
	return out
}

const css = readFileSync(TOKENS, 'utf8')
const light = ruleBody(css, ':root {')
const sharedDark = ruleBody(css, ':root[data-theme="dark"],')
const hcOnly = ruleBody(css, ':root[data-theme="dark-hc"] {', 'last')

/* Guard the read itself: if the two dark rules ever collapse to the same
 * block, every high-contrast number below would be quietly wrong. */
if (hcOnly['--color-surface'] === sharedDark['--color-surface']) {
	throw new Error(
		'high-contrast block resolved to the same rule as dark — check the selectors',
	)
}

const themes = {
	light: { tokens: light, text: 4.5 },
	dark: { tokens: { ...light, ...sharedDark }, text: 4.5 },
	'dark-hc': { tokens: { ...light, ...sharedDark, ...hcOnly }, text: 7 },
}

const SURFACES = [
	'surface',
	'surface-bright',
	'surface-container-lowest',
	'surface-container-low',
	'surface-container',
	'surface-container-high',
	'surface-container-highest',
]

let failures = 0
for (const [name, { tokens, text }] of Object.entries(themes)) {
	const get = (key: string) => {
		const value = tokens[`--color-${key}`]
		if (!value) throw new Error(`${name}: missing --color-${key}`)
		return value
	}
	const pairs: Array<[string, string, string, number]> = []
	for (const role of ['primary', 'secondary', 'error']) {
		pairs.push([`on-${role} on ${role}`, get(`on-${role}`), get(role), text])
		pairs.push([`${role} on surface`, get(role), get('surface'), text])
		pairs.push([
			`on-${role}-container on ${role}-container`,
			get(`on-${role}-container`),
			get(`${role}-container`),
			text,
		])
	}
	for (const surface of SURFACES) {
		pairs.push([
			`on-surface on ${surface}`,
			get('on-surface'),
			get(surface),
			text,
		])
		pairs.push([
			`on-surface-variant on ${surface}`,
			get('on-surface-variant'),
			get(surface),
			text,
		])
	}
	/* Borders and other non-text parts need less than text does. */
	pairs.push(['outline on surface', get('outline'), get('surface'), 3])

	let worst = Number.POSITIVE_INFINITY
	for (const [label, fg, bg, target] of pairs) {
		const r = ratio(fg, bg)
		worst = Math.min(worst, r)
		if (r < target) {
			failures++
			console.error(
				`  FAIL ${name}: ${label} is ${r.toFixed(2)}:1, needs ${target}:1`,
			)
		}
	}
	console.log(
		`${name}: ${pairs.length} pairings checked, weakest ${worst.toFixed(2)}:1 (text needs ${text}:1)`,
	)
}

if (failures > 0) {
	console.error(`\n${failures} pairing(s) below target`)
	process.exit(1)
}
console.log('\nAll themes clear their contrast targets.')
