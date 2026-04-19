import { describe, it } from 'vitest'

describe('AgentMailProvider', () => {
	describe('send with inline attachments', () => {
		it.todo(
			// GIVEN send() is called with one inline attachment { filename:"logo.png", contentId:"abc" } and one regular attachment
			// WHEN the provider forwards to AgentMail
			// THEN attachments[0] carries contentId="abc" and inline=true
			// AND attachments[1] has no contentId and is attached as a normal MIME part
			'should forward inline attachments with Content-ID on send',
		)

		it.todo(
			// GIVEN reply() is called with an inline attachment inherited from the parent (cid preserved)
			// WHEN the provider forwards
			// THEN Content-ID equals the parent's original cid (re-threading images in the quoted subtree)
			'should preserve parent Content-IDs on reply',
		)

		it.todo(
			// GIVEN an agent-supplied html that contains <img src="cid:abc"> but no matching attachment with contentId=abc
			// WHEN send() runs
			// THEN BadRequest/EmailError is raised at the handler layer before AgentMail is called
			'should reject emails whose cid references have no matching attachment',
		)

		it.todo(
			// GIVEN send() with two inline attachments sharing the SAME contentId
			// WHEN the provider forwards
			// THEN BadRequest is raised — cid uniqueness is required
			'should reject duplicate Content-IDs within a single message',
		)

		it.todo(
			// GIVEN send() with no attachments
			// WHEN the provider forwards
			// THEN the attachments array is omitted entirely (or empty) — no stray empty MIME parts
			'should send attachment-less emails cleanly',
		)

		it.todo(
			// GIVEN send() with a filename containing unicode ("café.pdf")
			// WHEN the provider forwards
			// THEN the filename is RFC 2047 / RFC 5987 encoded and arrives intact in Gmail/Outlook
			'should encode non-ASCII attachment filenames',
		)

		it.todo(
			// GIVEN send() with 30 MB total attachments (sum of bytes)
			// WHEN the provider forwards
			// THEN AgentMail's limit is enforced — BadRequest with a clear message
			'should reject oversize total attachment payloads',
		)

		it.todo(
			// GIVEN send() with 50 attachments
			// WHEN the provider forwards
			// THEN AgentMail's per-message attachment-count limit is enforced
			'should reject attachment-count blow-ups',
		)

		it.todo(
			// GIVEN a Content-ID containing angle brackets "<abc>" (some MIME libs auto-wrap)
			// WHEN the provider forwards
			// THEN the cid is normalized to the bare form "abc" before sending
			'should normalize bracketed Content-IDs',
		)
	})

	describe('draft API field coverage', () => {
		it.todo(
			// GIVEN AgentMail's CreateDraftRequest schema (labels, reply_to, to, cc, bcc, subject, text, html, attachments, in_reply_to, send_at, client_id)
			// WHEN our createDraft wrapper runs
			// THEN it never sends a "metadata" or "body_json" field (AgentMail has no such field — bodyJson lives in email_draft_bodies shadow table)
			'should not send bodyJson through AgentMail',
		)

		it.todo(
			// GIVEN createDraft with undefined reply_to / send_at
			// WHEN the request is serialized
			// THEN those keys are OMITTED from the payload (not sent as null) — AgentMail is strict about unknown/null
			'should omit undefined optional fields on draft create',
		)

		it.todo(
			// GIVEN createDraft with an empty labels array
			// WHEN serialized
			// THEN labels is either omitted or sent as [] — not null
			'should send labels consistently (never null)',
		)
	})

	describe('error mapping', () => {
		it.todo(
			// GIVEN AgentMail returns 429 rate limit
			// WHEN send() runs
			// THEN the error maps to a retryable TooManyRequests with Retry-After surfaced
			'should map 429 to a retryable structured error',
		)

		it.todo(
			// GIVEN AgentMail returns 4xx with a suppressed-recipient code
			// WHEN send() runs
			// THEN the error maps to a non-retryable SuppressedRecipient — caller decides UX
			'should map suppression errors to a non-retryable category',
		)

		it.todo(
			// GIVEN AgentMail returns 5xx transient
			// WHEN send() runs
			// THEN the error is marked retryable; staging cleanup does NOT fire
			'should treat 5xx as retryable so staged bytes are preserved',
		)
	})
})
