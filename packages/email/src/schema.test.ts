import { describe, it } from 'vitest'

describe('EmailBlocksSchema', () => {
	describe('decoding', () => {
		it.todo(
			// GIVEN a valid block tree with paragraph, heading, list, quote, divider, image
			// WHEN Schema.decode is applied
			// THEN the decoded value equals the input with no transformations
			'should decode a full-palette block tree losslessly',
		)

		it.todo(
			// GIVEN a paragraph block whose span has kind="link" with href="javascript:alert(1)"
			// WHEN decoding
			// THEN decoding should fail with a ParseError mentioning the href rule
			'should reject link spans with non-http(s)/mailto hrefs',
		)

		it.todo(
			// GIVEN a link span with href="mailto:a@b.c"
			// WHEN decoding
			// THEN decoding succeeds (mailto is on the allowlist)
			'should accept mailto hrefs',
		)

		it.todo(
			// GIVEN a link span with href="tel:+15551234"
			// WHEN decoding
			// THEN decoding fails (tel is NOT on the allowlist — day-1 scope)
			'should reject tel: hrefs',
		)

		it.todo(
			// GIVEN a link span with href="  https://example.com  " (leading/trailing whitespace)
			// WHEN decoding
			// THEN decoding fails — href must be a valid URL with no surrounding whitespace
			'should reject hrefs with surrounding whitespace',
		)

		it.todo(
			// GIVEN a link span with href="https://例え.jp/パス"
			// WHEN decoding
			// THEN decoding succeeds (unicode URLs are valid per URL spec)
			'should accept internationalized unicode URLs',
		)

		it.todo(
			// GIVEN a heading block with level=4
			// WHEN decoding
			// THEN decoding should fail (only 1,2,3 are allowed)
			'should reject headings outside levels 1-3',
		)

		it.todo(
			// GIVEN a heading block with level=0 or level=-1
			// WHEN decoding
			// THEN decoding fails for both (not positive integer in [1,3])
			'should reject non-positive heading levels',
		)

		it.todo(
			// GIVEN a heading with level as a string "2"
			// WHEN decoding
			// THEN decoding fails (no implicit type coercion)
			'should reject heading levels expressed as strings',
		)

		it.todo(
			// GIVEN a quote block containing a nested quote block
			// WHEN decoding
			// THEN the recursive structure decodes without depth limits
			'should accept arbitrarily nested quote blocks',
		)

		it.todo(
			// GIVEN a quote block nested 20 levels deep
			// WHEN decoding
			// THEN decoding succeeds — the schema has no depth cap
			'should accept extremely deep quote nesting without stack overflow',
		)

		it.todo(
			// GIVEN a quote block with empty children array
			// WHEN decoding
			// THEN decoding succeeds (empty quote is allowed — user may have trimmed body)
			'should accept empty quote children',
		)

		it.todo(
			// GIVEN a paragraph with empty spans array
			// WHEN decoding
			// THEN decoding succeeds (empty paragraph used for cursor spacing)
			'should accept empty paragraph spans',
		)

		it.todo(
			// GIVEN a list block with zero items
			// WHEN decoding
			// THEN decoding succeeds (editor may briefly produce empty lists)
			'should accept empty list items',
		)

		it.todo(
			// GIVEN a list item that itself is an empty span array
			// WHEN decoding
			// THEN decoding succeeds (bullet with no text yet)
			'should accept list items with empty span arrays',
		)

		it.todo(
			// GIVEN a text span with value=""
			// WHEN decoding
			// THEN decoding succeeds; renderer decides whether to render anything
			'should accept empty-string text spans',
		)

		it.todo(
			// GIVEN a text span where bold, italic, strike, and code are all true
			// WHEN decoding
			// THEN decoding succeeds (any combination of formatting flags is valid)
			'should accept all-flags-on text formatting combinations',
		)

		it.todo(
			// GIVEN an image block with source.kind="staging" and stagingId="stg_abc"
			// WHEN decoding
			// THEN the discriminated union resolves to the staging variant
			'should decode image blocks with staging source',
		)

		it.todo(
			// GIVEN an image block with source.kind="url" and href="not-a-url"
			// WHEN decoding
			// THEN it should fail URL validation
			'should reject url-source image blocks with invalid hrefs',
		)

		it.todo(
			// GIVEN an image block with source.kind="url" and href="http://insecure.example"
			// WHEN decoding
			// THEN decoding succeeds (http is allowed, TLS is a transport concern)
			'should accept http (non-TLS) url-source images',
		)

		it.todo(
			// GIVEN an image block with source.kind="cid" and cid=""
			// WHEN decoding
			// THEN decoding fails (cid must be non-empty to be referenceable)
			'should reject empty cid strings',
		)

		it.todo(
			// GIVEN an image block with width=-5 or height=0
			// WHEN decoding
			// THEN decoding fails (dimensions must be positive integers)
			'should reject non-positive image dimensions',
		)

		it.todo(
			// GIVEN an image block with alt missing entirely
			// WHEN decoding
			// THEN decoding fails (alt is required for accessibility)
			'should require image alt text (may be empty string)',
		)

		it.todo(
			// GIVEN an image block with source.kind="invalid"
			// WHEN decoding
			// THEN decoding fails — only staging|cid|url are valid discriminators
			'should reject unknown image source kinds',
		)

		it.todo(
			// GIVEN a block with type="code-block"
			// WHEN decoding
			// THEN decoding fails — code blocks are NOT in day-1 scope
			'should reject unsupported block types',
		)

		it.todo(
			// GIVEN a paragraph span with an extra unknown field {kind:"text", value:"x", foo:"bar"}
			// WHEN decoding with strict mode
			// THEN decoding fails — unknown fields are rejected to prevent schema drift
			'should reject unknown fields in strict decode',
		)

		it.todo(
			// GIVEN an empty top-level block array []
			// WHEN decoding
			// THEN decoding succeeds (empty body is valid — user may not have typed anything)
			'should accept empty top-level block arrays',
		)
	})

	describe('encoding', () => {
		it.todo(
			// GIVEN a decoded block tree
			// WHEN Schema.encode runs
			// THEN JSON round-trips exactly — bodyJson stored in DB reopens identical in the editor
			'should round-trip through decode → encode without field drift',
		)

		it.todo(
			// GIVEN a block tree containing unicode text (emoji, RTL Arabic, Chinese)
			// WHEN encode → decode round-trips
			// THEN the exact code points are preserved
			'should round-trip multibyte unicode content',
		)

		it.todo(
			// GIVEN a block tree with embedded null bytes in a text span
			// WHEN encoding
			// THEN encoding fails — null bytes break Postgres JSONB storage
			'should reject null bytes in text content',
		)
	})
})
