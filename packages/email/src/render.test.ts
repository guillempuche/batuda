import { describe, it } from 'vitest'

describe('renderBlocks', () => {
	describe('HTML output', () => {
		it.todo(
			// GIVEN a single paragraph with a terracotta-linked span
			// WHEN renderBlocks runs with the brand theme
			// THEN the <a> carries color:#B05220 as an inline style (no var(--…), no CSS class)
			'should inline terracotta on link anchors',
		)

		it.todo(
			// GIVEN a heading block
			// WHEN rendered
			// THEN the <h1>/<h2>/<h3> tag carries Barlow Condensed as an inline font-family
			'should inline Barlow Condensed on headings',
		)

		it.todo(
			// GIVEN a quote block with two nested children
			// WHEN rendered
			// THEN the <blockquote> has the grey left-border style and children render inside it recursively
			'should render quote blocks with grey-left-border styling',
		)

		it.todo(
			// GIVEN an image block with source.kind="staging" and a matching attachments map entry { stagingId → cid }
			// WHEN rendered
			// THEN the <img> src equals "cid:<cid>" and max-width:100% is inlined
			'should rewrite staging image refs to cid URIs at render time',
		)

		it.todo(
			// GIVEN an image block with source.kind="cid"
			// WHEN rendered
			// THEN the existing cid is preserved unchanged in <img src="cid:…">
			'should preserve inherited cid references on parent-quoted images',
		)

		it.todo(
			// GIVEN an image block referencing a stagingId with NO matching attachments entry
			// WHEN rendered
			// THEN render fails with a descriptive error (caught at handler, surfaced as BadRequest)
			'should fail when a staging ref is missing from the attachments map',
		)

		it.todo(
			// GIVEN a block tree followed by a footer block tree
			// WHEN renderBlocks([...user, ...footer]) runs
			// THEN both appear in a single <body>, footer last, no duplicate <html> wrappers
			'should append footer blocks without structural duplication',
		)

		it.todo(
			// GIVEN an empty block array []
			// WHEN rendered
			// THEN HTML is still a valid <html><body></body></html> — no crash
			'should render an empty body for empty input',
		)

		it.todo(
			// GIVEN a text span with HTML-sensitive characters like "<script>" and "&copy;"
			// WHEN rendered
			// THEN the output HTML escapes them to "&lt;script&gt;" and "&amp;copy;"
			'should html-escape text span content',
		)

		it.todo(
			// GIVEN a link span with href="https://example.com/?a=1&b=\"2\""
			// WHEN rendered
			// THEN the href attribute has proper entity escaping (ampersands, quotes)
			'should html-escape link hrefs in attributes',
		)

		it.todo(
			// GIVEN a text span with bold, italic, strike, and code all true
			// WHEN rendered
			// THEN the output nests <strong><em><s><code> correctly and styles stack
			'should stack all text formatting flags correctly',
		)

		it.todo(
			// GIVEN a link span inside a list item inside a quote
			// WHEN rendered
			// THEN the inline <a> style is terracotta regardless of nesting depth
			'should apply link styling at any nesting depth',
		)

		it.todo(
			// GIVEN a divider block between two paragraphs
			// WHEN rendered
			// THEN an <hr> with inline style color and margin separates the paragraphs
			'should render dividers with inline style',
		)

		it.todo(
			// GIVEN an image block with width=800 but no height
			// WHEN rendered
			// THEN the img has width="800" attribute and no height, preserving natural aspect
			'should render image width without height when height is missing',
		)

		it.todo(
			// GIVEN two list blocks back-to-back
			// WHEN rendered
			// THEN the two <ul>/<ol> elements are distinct — items from the second don't leak into the first
			'should not merge adjacent lists of the same ordered-ness',
		)

		it.todo(
			// GIVEN a list block where one item contains a link span
			// WHEN rendered
			// THEN the <li> contains a styled <a> inside, not plain text
			'should render link spans inside list items',
		)

		it.todo(
			// GIVEN an ordered list block with 100 items
			// WHEN rendered
			// THEN all 100 <li> items appear and the <ol> start attribute defaults to 1
			'should render long lists without truncation',
		)

		it.todo(
			// GIVEN a hard-break span between two text spans in a paragraph
			// WHEN rendered
			// THEN a <br/> separates the two pieces of text within the <p>
			'should render Span.break as <br/> inside a paragraph',
		)
	})

	describe('plain-text output', () => {
		it.todo(
			// GIVEN a quote block containing a quote block containing a paragraph "Hi"
			// WHEN rendered
			// THEN the plain-text output prefixes the innermost line with "> > "
			'should double-prefix plain-text lines for nested quotes',
		)

		it.todo(
			// GIVEN a list block with three items
			// WHEN rendered as plain text
			// THEN each item gets "- " (unordered) or "1. " (ordered) prefix
			'should prefix list items correctly in plain text',
		)

		it.todo(
			// GIVEN an ordered list with 12 items
			// WHEN rendered as plain text
			// THEN items are numbered 1. through 12. with dot alignment preserved
			'should number ordered list items sequentially in plain text',
		)

		it.todo(
			// GIVEN an image block
			// WHEN rendered as plain text
			// THEN the alt text appears in square brackets like "[alt text]"
			'should render inline images as [alt] in plain text',
		)

		it.todo(
			// GIVEN an image block with empty alt
			// WHEN rendered as plain text
			// THEN the placeholder is "[image]" rather than an empty "[]"
			'should substitute "[image]" for missing alt in plain text',
		)

		it.todo(
			// GIVEN a paragraph with only whitespace text
			// WHEN rendered as plain text
			// THEN the output normalizes to a single empty line (no runaway spaces)
			'should collapse whitespace-only paragraphs',
		)

		it.todo(
			// GIVEN a divider block
			// WHEN rendered as plain text
			// THEN a line of dashes (e.g. "---") represents it
			'should render dividers as a dashed line in plain text',
		)

		it.todo(
			// GIVEN a link span "Taller" href="https://taller.cat"
			// WHEN rendered as plain text
			// THEN the format is "Taller (https://taller.cat)" to preserve the URL
			'should include link URLs inline in plain text output',
		)
	})

	describe('preview metadata', () => {
		it.todo(
			// GIVEN a preview string in options
			// WHEN rendered
			// THEN a React-Email <Preview> node appears in <head> but not in <body>
			'should embed preview text in the head, not the body',
		)

		it.todo(
			// GIVEN a preview longer than 150 chars
			// WHEN rendered
			// THEN the preview is truncated or warned about — inbox snippet cap is ~140
			'should handle preview strings longer than inbox snippet cap',
		)

		it.todo(
			// GIVEN a preview with HTML-sensitive characters
			// WHEN rendered
			// THEN they are escaped so the inbox snippet shows the literal text
			'should escape HTML-sensitive characters in preview',
		)

		it.todo(
			// GIVEN no preview option
			// WHEN rendered
			// THEN no <Preview> node is emitted — inbox shows provider default snippet
			'should omit preview entirely when not provided',
		)
	})

	describe('attachment side-effects', () => {
		it.todo(
			// GIVEN a body tree containing three staging-image blocks
			// WHEN renderBlocks runs
			// THEN resolvedAttachments contains exactly three entries in insertion order with unique CIDs
			'should assign unique CIDs to each staging image',
		)

		it.todo(
			// GIVEN two image blocks both referencing the same stagingId
			// WHEN rendered
			// THEN only one attachment entry is emitted and both <img> tags share the same cid
			'should deduplicate attachment entries when the same stagingId appears twice',
		)
	})
})
