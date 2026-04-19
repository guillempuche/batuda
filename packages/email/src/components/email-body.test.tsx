// @vitest-environment jsdom

import { describe, it } from 'vitest'

describe('EmailBody', () => {
	describe('shell structure', () => {
		it.todo(
			// GIVEN <EmailBody><p>hi</p></EmailBody>
			// WHEN rendered
			// THEN the DOM contains <html lang="en"><head>…</head><body>…</body></html> with the child inside <body>
			'should wrap children in a full <html> document with body',
		)

		it.todo(
			// GIVEN <EmailBody preview="Hello" />
			// WHEN rendered
			// THEN a Preview node appears after <head> and before <body>
			'should place Preview between head and body when preview is set',
		)

		it.todo(
			// GIVEN no preview prop
			// WHEN rendered
			// THEN no Preview element appears anywhere in the DOM
			'should omit Preview when prop is undefined',
		)

		it.todo(
			// GIVEN multiple children
			// WHEN rendered
			// THEN each child appears inside <body> in source order
			'should render children inside body in order',
		)

		it.todo(
			// GIVEN no children
			// WHEN rendered
			// THEN <body> is present and empty (no crash)
			'should render an empty body when no children are passed',
		)
	})

	describe('font face declarations', () => {
		it.todo(
			// GIVEN the default brand font faces
			// WHEN rendered
			// THEN <head> contains one <Font> per face, each with a unique family+weight key
			'should declare a Font per brand font face',
		)

		it.todo(
			// GIVEN a Font with webFont url
			// WHEN rendered
			// THEN the url is carried through to the underlying @react-email/components Font
			'should forward the web font url verbatim',
		)

		it.todo(
			// GIVEN the fallbackFontFamily in the declaration
			// WHEN rendered
			// THEN Arial and sans-serif are declared as fallbacks so Outlook fills a stack
			'should declare Arial + sans-serif fallbacks for every Font',
		)
	})

	describe('body inline style', () => {
		it.todo(
			// GIVEN the component mounts
			// WHEN <body> is rendered
			// THEN the inline style equals brandTheme.body — no stylesheet dependency
			'should inline the brand body style rather than reference a class',
		)

		it.todo(
			// GIVEN the inline style
			// THEN it contains no var(--…) tokens — email clients strip custom properties
			'should contain no CSS custom properties',
		)

		it.todo(
			// GIVEN the inline style
			// THEN no value uses color-mix, linear-gradient, or text-shadow
			'should contain no CSS features that email clients strip',
		)
	})
})
