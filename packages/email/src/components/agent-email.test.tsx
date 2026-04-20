// @vitest-environment jsdom

import { describe, it } from 'vitest'

describe('AgentEmail', () => {
	describe('block dispatch', () => {
		it.todo(
			// GIVEN blocks=[{ type: 'paragraph', spans: [{ kind: 'text', value: 'hi' }] }]
			// WHEN AgentEmail renders
			// THEN the output DOM contains a <p> (react-email Text) with the literal "hi"
			'should render a paragraph block as a react-email Text element',
		)

		it.todo(
			// GIVEN blocks with heading levels 1, 2, 3
			// WHEN rendered
			// THEN the DOM has <h1>, <h2>, <h3> tags in that order
			'should render heading blocks to the correct h1/h2/h3 tag',
		)

		it.todo(
			// GIVEN a heading level=2 with brand theme
			// WHEN rendered
			// THEN the <h2> inline style includes Barlow Condensed as font-family
			'should apply Barlow Condensed to heading inline style',
		)

		it.todo(
			// GIVEN a bullet list with two items
			// WHEN rendered
			// THEN the DOM contains <ul> with two <li> children in order
			'should render bullet list to ul>li',
		)

		it.todo(
			// GIVEN an ordered list
			// WHEN rendered
			// THEN the DOM contains <ol> with matching <li> children
			'should render ordered list to ol>li',
		)

		it.todo(
			// GIVEN a divider block
			// WHEN rendered
			// THEN an <hr> appears with inline style color equal to the theme divider color
			'should render divider with brand theme hr style',
		)

		it.todo(
			// GIVEN a quote block with a single paragraph child
			// WHEN rendered
			// THEN the DOM contains <blockquote> with a <p> inside
			'should render quote as blockquote wrapping children',
		)

		it.todo(
			// GIVEN a nested quote block (quote inside a quote)
			// WHEN rendered
			// THEN the DOM contains <blockquote><blockquote><p></blockquote></blockquote>
			'should preserve quote nesting in the DOM tree',
		)
	})

	describe('span rendering', () => {
		it.todo(
			// GIVEN a paragraph with spans [text "a", break, text "b"]
			// WHEN rendered
			// THEN the paragraph contains "a" then a <br/> then "b"
			'should render break spans as br elements',
		)

		it.todo(
			// GIVEN a text span with bold=true
			// WHEN rendered
			// THEN the <span> has inline style font-weight equal to the brand bold weight
			'should inline font-weight for bold spans',
		)

		it.todo(
			// GIVEN a text span with italic=true
			// WHEN rendered
			// THEN the <span> has inline style font-style: italic
			'should inline italic style for italic spans',
		)

		it.todo(
			// GIVEN a text span with strike=true
			// WHEN rendered
			// THEN the <span> has text-decoration: line-through
			'should inline line-through for strike spans',
		)

		it.todo(
			// GIVEN a text span with code=true
			// WHEN rendered
			// THEN the <span> has a monospace font-family and a subtle background color
			'should inline monospace + background for code spans',
		)

		it.todo(
			// GIVEN a link span with href="https://example.com"
			// WHEN rendered
			// THEN the DOM contains an <a> with the href set and color equal to #B05220 (brand primary)
			'should render link spans with brand primary color',
		)

		it.todo(
			// GIVEN a link span with bold=true
			// WHEN rendered
			// THEN the <a> has font-weight bold inline style on top of the link color
			'should stack bold on link inline styles',
		)

		it.todo(
			// GIVEN a paragraph with zero spans
			// WHEN rendered
			// THEN an empty <p> still renders without crashing
			'should render empty paragraphs without crashing',
		)
	})

	describe('image source resolution', () => {
		it.todo(
			// GIVEN an image block with source.kind='staging', stagingId='stg_1'
			// AND a stagingIndex Map mapping 'stg_1' → { cid: 'cid_abc', ... }
			// WHEN rendered
			// THEN the <img> src is "cid:cid_abc"
			'should rewrite staging image src to cid: URI',
		)

		it.todo(
			// GIVEN an image block with source.kind='staging' but no matching stagingIndex entry
			// WHEN rendered
			// THEN render throws (surfaced at the handler layer as BadRequest)
			'should throw when a staging ref is not in the stagingIndex',
		)

		it.todo(
			// GIVEN an image block with source.kind='cid', cid='abc'
			// WHEN rendered
			// THEN the <img> src is "cid:abc" (no lookup needed)
			'should pass cid-source images through unchanged',
		)

		it.todo(
			// GIVEN an image block with source.kind='url', href='https://x/y.png'
			// WHEN rendered
			// THEN the <img> src equals the href verbatim
			'should render url-source images with the href as src',
		)

		it.todo(
			// GIVEN an image block with width=400 and height=300
			// WHEN rendered
			// THEN the <img> style carries width:400 and height:300 inline
			'should inline explicit width and height',
		)

		it.todo(
			// GIVEN an image block with alt="logo"
			// WHEN rendered
			// THEN the <img> alt attribute equals "logo"
			'should forward the alt attribute verbatim',
		)
	})

	describe('preview', () => {
		it.todo(
			// GIVEN preview="Hi there"
			// WHEN rendered
			// THEN the DOM contains a <div data-skip-in-text="true"> from @react-email/components Preview
			'should render a Preview node when preview prop is set',
		)

		it.todo(
			// GIVEN no preview prop
			// WHEN rendered
			// THEN no Preview element appears in the DOM
			'should omit Preview when prop is undefined',
		)
	})

	describe('signOff', () => {
		it.todo(
			// GIVEN signOff={{ author: 'Alice', brand: 'Taller', city: 'Barcelona' }}
			// WHEN rendered
			// THEN the sign-off Text reads "ALICE · TALLER · BARCELONA" (uppercase, bullet-separated)
			'should render sign-off with all three fields separated by a middot',
		)

		it.todo(
			// GIVEN signOff={{ author: 'Alice' }} only
			// WHEN rendered
			// THEN the sign-off Text reads "ALICE" with no trailing separator
			'should render sign-off with only provided fields',
		)

		it.todo(
			// GIVEN signOff is undefined
			// WHEN rendered
			// THEN no sign-off Text element is in the DOM
			'should omit sign-off Text when prop is absent',
		)
	})

	describe('composition', () => {
		it.todo(
			// GIVEN a block tree ending with a divider and a signOff prop
			// WHEN rendered
			// THEN the last two DOM children are <hr/> and the sign-off Text in that order
			'should place sign-off after the last block',
		)

		it.todo(
			// GIVEN an empty blocks array but a signOff prop
			// WHEN rendered
			// THEN the sign-off Text is the only content below the body wrapper
			'should render sign-off alone when blocks are empty',
		)
	})
})
