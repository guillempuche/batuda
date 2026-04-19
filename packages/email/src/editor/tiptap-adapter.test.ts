import { describe, it } from 'vitest'

describe('emailBlocksToTiptap', () => {
	describe('block mapping', () => {
		it.todo(
			// GIVEN a paragraph block with a single text span "hi"
			// WHEN emailBlocksToTiptap runs
			// THEN the doc has one { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }
			'should map paragraph with text span to a paragraph node',
		)

		it.todo(
			// GIVEN a heading block with level=2
			// WHEN converted
			// THEN the node has type 'heading' and attrs.level === 2
			'should map heading level to node attrs',
		)

		it.todo(
			// GIVEN a heading block with level=1|2|3
			// WHEN converted
			// THEN each level surfaces verbatim on attrs.level — no silent clamp
			'should preserve all supported heading levels',
		)

		it.todo(
			// GIVEN a list block with ordered=false
			// WHEN converted
			// THEN the node has type 'bulletList' and each item becomes a listItem containing a paragraph
			'should map bullet lists to nested listItem>paragraph nodes',
		)

		it.todo(
			// GIVEN a list block with ordered=true
			// WHEN converted
			// THEN the node has type 'orderedList'
			'should map ordered lists to orderedList nodes',
		)

		it.todo(
			// GIVEN a list block with zero items
			// WHEN converted
			// THEN the bulletList/orderedList node has an empty content array
			'should convert empty lists to empty list nodes',
		)

		it.todo(
			// GIVEN a divider block
			// WHEN converted
			// THEN the node has type 'horizontalRule' with no content
			'should map divider to horizontalRule',
		)

		it.todo(
			// GIVEN a quote block wrapping two paragraph children
			// WHEN converted
			// THEN the node is a blockquote whose content contains the two paragraph nodes in order
			'should map quote to blockquote preserving child order',
		)

		it.todo(
			// GIVEN a quote block nested inside another quote block
			// WHEN converted
			// THEN the result is a blockquote inside a blockquote — arbitrary depth preserved
			'should preserve nested quote depth',
		)

		it.todo(
			// GIVEN an image block with source.kind='staging', stagingId='stg_1'
			// WHEN converted
			// THEN the image node has attrs.stagingId === 'stg_1' and NO src (editor fills src later)
			'should map staging images to a stagingId attr with no src',
		)

		it.todo(
			// GIVEN an image block with source.kind='cid', cid='abc'
			// WHEN converted
			// THEN the image node has attrs.cid === 'abc' AND attrs.src === 'cid:abc'
			'should map cid images to both cid and src attrs',
		)

		it.todo(
			// GIVEN an image block with source.kind='url', href='https://x/y.png'
			// WHEN converted
			// THEN the image node has attrs.src === 'https://x/y.png'
			'should map url images to a plain src attr',
		)

		it.todo(
			// GIVEN an image block with width=400, no height
			// WHEN converted
			// THEN attrs.width === 400 and attrs.height is absent (undefined, not null)
			'should omit undefined dimension attrs rather than emitting null',
		)

		it.todo(
			// GIVEN an empty EmailBlocks array
			// WHEN converted
			// THEN the result is { type: 'doc', content: [] }
			'should produce an empty doc for empty blocks',
		)
	})

	describe('span → inline node mapping', () => {
		it.todo(
			// GIVEN a paragraph containing a break span between two text spans
			// WHEN converted
			// THEN the paragraph's content is [text, hardBreak, text]
			'should emit hardBreak between text nodes',
		)

		it.todo(
			// GIVEN a text span with bold=true
			// WHEN converted
			// THEN the text node has marks === [{ type: 'bold' }]
			'should map bold to a bold mark',
		)

		it.todo(
			// GIVEN a text span with bold, italic, strike, code all true
			// WHEN converted
			// THEN marks contains entries for all four mark types in order [bold, italic, strike, code]
			'should stack all four text marks in order',
		)

		it.todo(
			// GIVEN a text span with no formatting flags
			// WHEN converted
			// THEN the text node has no marks key (absent, not an empty array)
			'should omit the marks key for unformatted text',
		)

		it.todo(
			// GIVEN a link span with href="https://example.com" and text="click"
			// WHEN converted
			// THEN the node is { type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href } }] }
			'should map link spans to a text node with a link mark',
		)

		it.todo(
			// GIVEN a link span with bold=true, italic=true
			// WHEN converted
			// THEN marks contains the link first, then bold, then italic
			'should stack bold/italic marks after the link mark',
		)
	})
})

describe('tiptapToEmailBlocks', () => {
	describe('node → block mapping', () => {
		it.todo(
			// GIVEN a doc with one paragraph node containing a text node "hi"
			// WHEN tiptapToEmailBlocks runs
			// THEN the output is [{ type: 'paragraph', spans: [{ kind: 'text', value: 'hi' }] }]
			'should map paragraph node to paragraph block',
		)

		it.todo(
			// GIVEN a heading node with attrs.level=3
			// WHEN converted
			// THEN the output heading block has level=3
			'should preserve heading levels 1-3',
		)

		it.todo(
			// GIVEN a heading node with attrs.level=9
			// WHEN converted
			// THEN the heading block is clamped to level=1 (fallback)
			'should clamp unsupported heading levels to 1',
		)

		it.todo(
			// GIVEN a heading node with missing level attr
			// WHEN converted
			// THEN the heading block defaults to level=1
			'should default missing heading level to 1',
		)

		it.todo(
			// GIVEN a bulletList node with three listItems
			// WHEN converted
			// THEN the list block has ordered=false and items.length === 3
			'should map bulletList to ordered=false list block',
		)

		it.todo(
			// GIVEN an orderedList node
			// WHEN converted
			// THEN the list block has ordered=true
			'should map orderedList to ordered=true list block',
		)

		it.todo(
			// GIVEN a listItem whose content contains text outside any paragraph
			// WHEN converted
			// THEN only paragraph-wrapped spans are captured; stray non-paragraph content is dropped
			'should only lift spans from paragraph-wrapped listItem content',
		)

		it.todo(
			// GIVEN a horizontalRule node
			// WHEN converted
			// THEN the output is [{ type: 'divider' }]
			'should map horizontalRule to divider',
		)

		it.todo(
			// GIVEN a blockquote with two paragraph children
			// WHEN converted
			// THEN the quote block has children.length === 2
			'should map blockquote to quote block',
		)

		it.todo(
			// GIVEN a blockquote containing an unrecognized node type
			// WHEN converted
			// THEN the unrecognized node is dropped; recognized siblings survive
			'should skip unrecognized nodes inside blockquotes',
		)

		it.todo(
			// GIVEN an image node with attrs.stagingId set
			// WHEN converted
			// THEN the image block has source.kind='staging' with that stagingId
			'should map stagingId-bearing images to staging source',
		)

		it.todo(
			// GIVEN an image node with attrs.cid set and no stagingId
			// WHEN converted
			// THEN the image block has source.kind='cid'
			'should map cid-bearing images to cid source',
		)

		it.todo(
			// GIVEN an image node whose src is "cid:abc" but no explicit cid attr
			// WHEN converted
			// THEN the node is dropped (the adapter does not parse cid from src — only explicit cid attr)
			'should drop images that have no stagingId/cid attr even if src is a cid URI',
		)

		it.todo(
			// GIVEN an image node with attrs.src="https://x/y.png"
			// WHEN converted
			// THEN the image block has source.kind='url' with href set
			'should map http(s) src images to url source',
		)

		it.todo(
			// GIVEN an image node with attrs.src="javascript:alert(1)"
			// WHEN converted
			// THEN the node is dropped (only http(s) urls are accepted)
			'should drop images with non-http(s) src when no staging/cid attrs exist',
		)

		it.todo(
			// GIVEN an image node with attrs.width as a string "400"
			// WHEN converted
			// THEN the width is dropped (adapter requires typeof width === 'number')
			'should drop non-number image dimensions',
		)

		it.todo(
			// GIVEN an image node with no useful source (no stagingId/cid/http src)
			// WHEN converted
			// THEN the adapter returns null and the image is omitted from the block tree
			'should omit unresolvable image nodes from output',
		)

		it.todo(
			// GIVEN a doc with an unrecognized top-level node type
			// WHEN converted
			// THEN the node is dropped; known siblings survive
			'should drop unknown top-level nodes',
		)

		it.todo(
			// GIVEN a doc with no content array
			// WHEN converted
			// THEN the output is []
			'should handle docs with missing content gracefully',
		)
	})

	describe('inline node → span mapping', () => {
		it.todo(
			// GIVEN a hardBreak node between two text nodes
			// WHEN converted
			// THEN the spans are [text, break, text]
			'should map hardBreak to a break span',
		)

		it.todo(
			// GIVEN a text node with a link mark
			// WHEN converted
			// THEN the span has kind='link', href from the mark attrs, and text from node.text
			'should map link-marked text nodes to link spans',
		)

		it.todo(
			// GIVEN a text node with a link mark whose attrs.href is missing
			// WHEN converted
			// THEN the link mark is ignored and the node becomes a plain text span
			'should downgrade link spans without href to text',
		)

		it.todo(
			// GIVEN a text node carrying bold, italic, strike, and code marks
			// WHEN converted
			// THEN the text span has bold, italic, strike, code all true
			'should capture all four text marks',
		)

		it.todo(
			// GIVEN a text node with no text property
			// WHEN converted
			// THEN the node is skipped (no empty spans emitted)
			'should skip text nodes with no text value',
		)

		it.todo(
			// GIVEN a link node whose marks include link + bold + italic
			// WHEN converted
			// THEN the link span has bold=true and italic=true (strike/code are dropped for links — not in schema)
			'should capture bold/italic on link spans but drop strike/code',
		)
	})
})

describe('roundtrip', () => {
	it.todo(
		// GIVEN an EmailBlocks tree with every block/span variant
		// WHEN emailBlocksToTiptap → tiptapToEmailBlocks runs
		// THEN the output equals the input exactly (lossless in one direction)
		'should be lossless from EmailBlocks to Tiptap and back',
	)

	it.todo(
		// GIVEN a Tiptap doc produced by the library from typical user editing
		// WHEN tiptapToEmailBlocks → emailBlocksToTiptap runs
		// THEN the result is structurally identical to the input for every supported node type
		'should be lossless from Tiptap to EmailBlocks and back for supported nodes',
	)

	it.todo(
		// GIVEN a block tree with deeply nested quotes (5 levels) containing paragraphs and images
		// WHEN a full roundtrip runs
		// THEN all 5 quote levels and inner content survive unchanged
		'should preserve deep quote nesting across roundtrip',
	)

	it.todo(
		// GIVEN a block tree where paragraph.spans includes every mark combination
		// WHEN roundtripped
		// THEN mark ordering and attrs match exactly — no mark drift from set vs array representation
		'should preserve mark ordering across roundtrip',
	)
})
