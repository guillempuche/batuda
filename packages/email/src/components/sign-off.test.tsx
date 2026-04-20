// @vitest-environment jsdom

import { describe, it } from 'vitest'

describe('SignOff', () => {
	describe('rendering', () => {
		it.todo(
			// GIVEN <SignOff author="Alice" brand="Taller" city="Barcelona" />
			// WHEN rendered
			// THEN the text content reads "Alice · Taller · Barcelona" (joined by middot · space)
			'should join all three fields with a middot separator',
		)

		it.todo(
			// GIVEN only author set
			// WHEN rendered
			// THEN the text content equals "Alice" with no trailing separator
			'should render author alone without trailing separator',
		)

		it.todo(
			// GIVEN author and city set, brand undefined
			// WHEN rendered
			// THEN the text content is "Alice · Barcelona" (brand omitted; no empty slot)
			'should omit undefined fields cleanly',
		)

		it.todo(
			// GIVEN all three fields undefined
			// WHEN rendered
			// THEN the component returns null — no empty Text element in the DOM
			'should render nothing when every field is missing',
		)

		it.todo(
			// GIVEN empty strings for every field ("", "", "")
			// WHEN rendered
			// THEN all fields are filtered out and the component returns null
			'should treat empty strings the same as undefined',
		)
	})

	describe('inline style', () => {
		it.todo(
			// GIVEN the component renders
			// WHEN the Text wrapper appears
			// THEN its inline style equals brandTheme.signOff (muted color, Barlow Condensed, uppercase, letter-spaced)
			'should inline the sign-off brand style',
		)

		it.todo(
			// GIVEN the inline style
			// THEN the color is #56524A (muted warm grey) as declared in brandTheme.signOff
			'should use the muted warm-grey sign-off color',
		)

		it.todo(
			// GIVEN the inline style
			// THEN the text-transform is uppercase and letter-spacing is a positive value
			'should uppercase the sign-off text via CSS',
		)
	})

	describe('content safety', () => {
		it.todo(
			// GIVEN author="<script>alert(1)</script>"
			// WHEN rendered
			// THEN the script text is rendered as literal text, not parsed as HTML
			'should render author as text, not HTML',
		)

		it.todo(
			// GIVEN brand containing a middot already ("Tal·ler")
			// WHEN rendered
			// THEN the join separator still appears; the inner middot is preserved as part of the brand text
			'should preserve middot characters inside field values',
		)
	})
})
