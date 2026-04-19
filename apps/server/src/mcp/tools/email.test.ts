import { describe, it } from 'vitest'

describe('MCP email tools', () => {
	describe('send_email', () => {
		it.todo(
			// GIVEN a tool input that passes body: <EmailBlocks>, subject, to
			// WHEN the schema decodes
			// THEN the call succeeds and body is typed as EmailBlocks
			'should accept a valid block-tree body',
		)

		it.todo(
			// GIVEN a tool input with html: "<p>…</p>" (legacy)
			// WHEN the schema decodes
			// THEN decoding fails with an "unknown field" error
			'should reject legacy html payload',
		)

		it.todo(
			// GIVEN a tool input with body: <image block pointing at stagingId="stg_x"> and attachments: [{staging_id: "stg_x", inline: true}]
			// WHEN the handler runs
			// THEN the rendered html contains cid:<generated> and attachments are forwarded inline
			'should render inline images for agent-sent emails',
		)

		it.todo(
			// GIVEN an image block with source.kind="url" and href="https://evil.example"
			// WHEN the handler runs
			// THEN decoding rejects (agents may only reference url images for assets we control — narrowed allowlist)
			'should reject url-source images outside the allowed host list',
		)

		it.todo(
			// GIVEN a tool input missing "to", "subject", or "body"
			// WHEN schema decodes
			// THEN each missing required field produces a ParseError
			'should require to, subject, and body',
		)

		it.todo(
			// GIVEN a to-list with a malformed address
			// WHEN schema decodes
			// THEN ParseError surfaces with the offending address
			'should validate each recipient address',
		)

		it.todo(
			// GIVEN a body containing 10,000 blocks
			// WHEN the schema decodes
			// THEN it either succeeds (no cap) or fails with a descriptive "body too large" error
			'should enforce a reasonable body-size bound',
		)

		it.todo(
			// GIVEN a send_email with attachments that reference stagingIds not owned by the inbox
			// WHEN the handler resolves
			// THEN the error surfaces as a structured MCP error
			'should reject unauthorized staging references',
		)
	})

	describe('reply_email', () => {
		it.todo(
			// GIVEN a reply with body: <quote block containing the parent's sanitized tree>
			// WHEN the handler runs
			// THEN the provider reply endpoint is called with threadLinkId preserved (threading headers intact)
			'should preserve threading metadata on reply',
		)

		it.todo(
			// GIVEN a reply that does NOT include a quote block
			// WHEN the handler runs
			// THEN the reply succeeds — agents are not required to quote the parent
			'should allow agent replies without a quote block',
		)

		it.todo(
			// GIVEN a reply_email for a thread the caller cannot access
			// WHEN authorization runs
			// THEN a structured MCP not-authorized error is returned
			'should enforce thread access control',
		)

		it.todo(
			// GIVEN a reply containing cid-inherited inline images
			// WHEN the handler runs
			// THEN the parent's attachments are re-attached with matching Content-IDs
			'should re-attach parent inline images referenced by cid',
		)
	})

	describe('stage_email_attachment', () => {
		it.todo(
			// GIVEN bytes_base64, filename, content_type, inbox_id, inline=true
			// WHEN the tool runs
			// THEN the same staging service is invoked
			// AND the compression pipeline applies (image content types)
			// AND the tool returns { staging_id }
			'should stage attachments via the same pipeline as humans',
		)

		it.todo(
			// GIVEN an oversized bytes_base64
			// WHEN the tool runs
			// THEN the error surfaces as a structured MCP error (no raw stack)
			'should surface size-limit errors cleanly',
		)

		it.todo(
			// GIVEN malformed base64 input
			// WHEN decoding fails
			// THEN the error surfaces as a structured MCP error with "invalid base64"
			'should reject malformed base64',
		)

		it.todo(
			// GIVEN an inbox_id the agent does not have access to
			// WHEN authorization runs
			// THEN a structured not-authorized MCP error is returned
			'should enforce per-inbox authorization for staging',
		)

		it.todo(
			// GIVEN filename containing path separators
			// WHEN the tool runs
			// THEN the stored filename is the basename only
			'should sanitize agent-supplied filenames',
		)
	})

	describe('create_inbox_footer / update_inbox_footer', () => {
		it.todo(
			// GIVEN a footer payload with body_json: EmailBlocks
			// WHEN the tool runs
			// THEN inbox_footers.body_json is persisted; html column no longer exists
			'should persist footer body_json instead of html',
		)

		it.todo(
			// GIVEN a footer payload with a body_json containing a H1 heading
			// WHEN the tool validates
			// THEN decoding rejects — footer mode palette does not allow H1
			'should enforce footer mode palette restrictions',
		)

		it.todo(
			// GIVEN a footer update where the footer belongs to a different inbox
			// WHEN authorization runs
			// THEN a structured not-authorized MCP error is returned
			'should enforce footer-ownership on update',
		)
	})
})
