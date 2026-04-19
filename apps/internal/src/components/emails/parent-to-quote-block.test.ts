import { describe, it } from 'vitest'

describe('parentToQuoteBlock', () => {
	describe('attribution', () => {
		it.todo(
			// GIVEN { fromName: "Alice", receivedAt, locale: "en" }
			// WHEN parentToQuoteBlock runs
			// THEN the first block is a paragraph "On <date>, Alice wrote:" matching en-locale date format
			'should emit an English attribution paragraph',
		)

		it.todo(
			// GIVEN { fromName: null, fromEmail: "x@y.z" }
			// WHEN parentToQuoteBlock runs
			// THEN the attribution uses the email address as fallback for the name
			'should fall back to email when fromName is missing',
		)

		it.todo(
			// GIVEN { fromName: null, fromEmail: null }
			// WHEN parentToQuoteBlock runs
			// THEN the attribution degrades to "On <date>, someone wrote:" — no crash on missing sender
			'should handle missing sender gracefully',
		)

		it.todo(
			// GIVEN { locale: "ca" }
			// WHEN parentToQuoteBlock runs
			// THEN the date is formatted in Catalan and the attribution text is localized
			'should localize attribution in Catalan',
		)

		it.todo(
			// GIVEN { locale: "xx" } (unsupported locale)
			// WHEN parentToQuoteBlock runs
			// THEN the attribution falls back to English
			'should fall back to English for unsupported locales',
		)

		it.todo(
			// GIVEN a receivedAt far in the past (e.g. 10 years ago)
			// WHEN parentToQuoteBlock runs
			// THEN the date formats normally — no "x minutes ago" relative form
			'should format old dates absolutely',
		)

		it.todo(
			// GIVEN receivedAt is missing/null
			// WHEN parentToQuoteBlock runs
			// THEN the attribution omits the date portion gracefully ("Alice wrote:")
			'should handle missing receivedAt',
		)

		it.todo(
			// GIVEN fromName contains HTML-like text "<Evil>"
			// WHEN parentToQuoteBlock runs
			// THEN the name is emitted as text (not interpreted), and any later HTML rendering escapes it
			'should treat fromName as plain text, not HTML',
		)
	})

	describe('plain-text parents', () => {
		it.todo(
			// GIVEN { html: undefined, text: "line 1\n\nline 2" }
			// WHEN parentToQuoteBlock runs
			// THEN the quote block contains two paragraph children
			'should split plain-text parents on blank lines',
		)

		it.todo(
			// GIVEN { html: undefined, text: "" }
			// WHEN parentToQuoteBlock runs
			// THEN the quote block has empty children (attribution still present)
			'should handle empty plain-text parents',
		)

		it.todo(
			// GIVEN a plain-text parent where every line is prefixed with "> " (quoted reply)
			// WHEN parentToQuoteBlock runs
			// THEN nested quote blocks mirror the "> " depth
			'should detect plain-text quote depth',
		)

		it.todo(
			// GIVEN a very long plain-text parent (1 MB)
			// WHEN parentToQuoteBlock runs
			// THEN the function completes within reasonable time bounds
			'should handle large plain-text parents',
		)
	})

	describe('HTML parents', () => {
		it.todo(
			// GIVEN { html: "<p>A</p><blockquote><p>B</p></blockquote>" }
			// WHEN parentToQuoteBlock runs
			// THEN the outer quote wraps a paragraph "A" and a nested quote with paragraph "B"
			'should preserve nested blockquotes verbatim',
		)

		it.todo(
			// GIVEN an HTML parent with <img src="cid:abc"> inside a <p>
			// WHEN parentToQuoteBlock runs
			// THEN the image block inside the quote has source.kind="cid", cid="abc"
			'should keep parent inline-image cid references',
		)

		it.todo(
			// GIVEN an HTML parent with a <table>
			// WHEN parentToQuoteBlock runs
			// THEN an italic [table] placeholder paragraph replaces it inside the quote
			'should substitute a placeholder for unsupported tables',
		)

		it.todo(
			// GIVEN an HTML parent with a <script>
			// WHEN parentToQuoteBlock runs
			// THEN the script is dropped entirely — no trace in the quote
			'should drop script tags from HTML parents',
		)

		it.todo(
			// GIVEN an HTML parent with remote <img src="https://tracker/px">
			// WHEN parentToQuoteBlock runs
			// THEN the image appears as a kind="url" image block (reply shows recipient's parent as-is)
			'should preserve remote images as url-source blocks',
		)

		it.todo(
			// GIVEN an HTML parent from Outlook with VML + conditional MSO comments
			// WHEN parentToQuoteBlock runs
			// THEN VML is stripped; MSO conditionals are dropped; remaining text survives
			'should strip Outlook-specific markup',
		)

		it.todo(
			// GIVEN an HTML parent quoted 7 levels deep
			// WHEN parentToQuoteBlock runs
			// THEN all 7 levels of nesting are preserved in the output tree
			'should preserve deep quote nesting without cap',
		)

		it.todo(
			// GIVEN an HTML parent with inline style "color:red"
			// WHEN parentToQuoteBlock runs
			// THEN the style is dropped; quote color comes from brandTheme at render time
			'should drop inline styles from parent HTML',
		)

		it.todo(
			// GIVEN an HTML parent that contains our OWN previously-sent footer stamp
			// WHEN parentToQuoteBlock runs
			// THEN it appears at the end of the quote — user can manually trim if desired (no auto-strip)
			'should not auto-strip our own previous footer',
		)
	})

	describe('ordering', () => {
		it.todo(
			// GIVEN any valid parent
			// WHEN parentToQuoteBlock runs
			// THEN the returned body is [<empty paragraph>, <attribution>, <quote>] — empty paragraph first so the editor's cursor lands there (top-posting)
			'should prepend an empty paragraph for cursor placement',
		)

		it.todo(
			// GIVEN a parent with both html and text
			// WHEN parentToQuoteBlock runs
			// THEN the html path is preferred (richer); text is fallback only if html is undefined
			'should prefer html over text when both are present',
		)
	})

	describe('inherited attachments', () => {
		it.todo(
			// GIVEN a parent with two inline cids ("abc", "def") and a non-inline PDF attachment
			// WHEN parentToQuoteBlock runs
			// THEN the output tree contains two cid-source image blocks; the PDF is not referenced
			'should carry forward only inline-image attachments, not regular ones',
		)

		it.todo(
			// GIVEN a parent inline-image whose cid contains special chars ("<abc@example>")
			// WHEN parentToQuoteBlock runs
			// THEN the cid is normalized to bare form before storing in the image block
			'should normalize bracketed Content-IDs from parent',
		)
	})
})
