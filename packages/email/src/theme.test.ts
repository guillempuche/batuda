import { describe, it } from 'vitest'

describe('brandTheme', () => {
	it.todo(
		// GIVEN the exported brandTheme
		// THEN primary equals terracotta #B05220 (mirrors packages/ui/src/tokens.css --color-primary)
		'should expose terracotta as the primary color',
	)

	it.todo(
		// GIVEN the exported brandTheme
		// THEN on-surface equals #2D2A24 (body text color)
		'should expose warm near-black as body text color',
	)

	it.todo(
		// GIVEN the exported brandTheme
		// THEN display font stack leads with Barlow Condensed and falls back to Arial Narrow then sans-serif
		'should declare Barlow Condensed display stack with email-safe fallback',
	)

	it.todo(
		// GIVEN the exported brandTheme
		// THEN body font stack leads with Barlow and falls back to Arial
		'should declare Barlow body stack with Arial fallback',
	)

	it.todo(
		// GIVEN the exported brandTheme
		// THEN no value contains color-mix(, linear-gradient(, var(--, or text-shadow
		'should contain no CSS that email clients strip',
	)

	it.todo(
		// GIVEN the exported brandTheme
		// THEN quote-border color equals #CCC5B5 (the agreed blockquote left-border)
		'should expose the quote left-border color',
	)

	it.todo(
		// GIVEN the exported brandTheme
		// THEN the sign-off color equals #56524A (muted warm grey)
		'should expose the sign-off text color',
	)

	it.todo(
		// GIVEN the exported brandTheme
		// THEN all color values are hex (#RRGGBB) — no oklab(), no hsl(), no rgb() with alpha
		// (Outlook desktop only reliably honors 6-char hex)
		'should use hex-only color literals for Outlook compatibility',
	)

	it.todo(
		// GIVEN the exported brandTheme
		// THEN no font-family value contains a shorthand or numeric weight like "900 Barlow" —
		// weights are declared separately so Outlook's font resolver doesn't fail the stack
		'should separate font-weight from font-family',
	)

	it.todo(
		// GIVEN extendTheme('basic', brandOverrides)
		// WHEN brandTheme is constructed
		// THEN the base "basic" preset is not mutated (theme construction returns a new object)
		'should not mutate the react-email basic base theme',
	)
})
