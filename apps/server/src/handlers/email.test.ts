import { describe, it } from 'vitest'

describe('email handlers (HTTP)', () => {
	describe('POST /v1/email/attachments/staging', () => {
		it.todo(
			// GIVEN a multipart upload with a PNG file
			// WHEN the endpoint runs
			// THEN the response body includes stagingId + previewUrl (short-lived signed URL)
			'should return stagingId and previewUrl after a successful staging upload',
		)

		it.todo(
			// GIVEN the same endpoint with no file
			// WHEN the endpoint runs
			// THEN a 400 BadRequest is returned
			'should reject staging requests without a file',
		)

		it.todo(
			// GIVEN a multipart with two "file" fields
			// WHEN the endpoint runs
			// THEN only the first is staged, or a 400 is returned (document whichever — single-file endpoint)
			'should handle multiple file fields deterministically',
		)

		it.todo(
			// GIVEN an unauthenticated request
			// WHEN the endpoint runs
			// THEN a 401 Unauthorized is returned before any storage work
			'should require authentication',
		)

		it.todo(
			// GIVEN a request whose inbox_id does not belong to the caller
			// WHEN the endpoint runs
			// THEN a 403 Forbidden is returned
			'should enforce per-inbox authorization',
		)

		it.todo(
			// GIVEN a file larger than MAX_BYTES
			// WHEN the endpoint runs
			// THEN a 413 Payload Too Large is returned before compression
			'should reject oversize uploads with 413',
		)

		it.todo(
			// GIVEN a malformed multipart stream (truncated)
			// WHEN the endpoint runs
			// THEN a 400 BadRequest is returned (no 500)
			'should reject malformed multipart bodies cleanly',
		)

		it.todo(
			// GIVEN an unsupported content-type (e.g. "application/x-msdownload")
			// WHEN the endpoint runs
			// THEN a 400 is returned (safelist of allowed types enforced at the handler)
			'should reject disallowed content types',
		)

		it.todo(
			// GIVEN an authenticated request with filename = "report.pdf"
			// WHEN the endpoint runs
			// THEN previewUrl is null/absent for non-image types (only images need preview)
			'should omit previewUrl for non-image staged attachments',
		)
	})

	describe('DELETE /v1/email/attachments/staging/:stagingId', () => {
		it.todo(
			// GIVEN a previously-staged id
			// WHEN the DELETE endpoint is hit
			// THEN the staging service's discard() runs; response is 204 No Content
			'should delete a staged blob on DELETE',
		)

		it.todo(
			// GIVEN an unknown id
			// WHEN DELETE is hit
			// THEN the response is 204 (idempotent) — no information-leak 404
			'should be idempotent for unknown ids',
		)

		it.todo(
			// GIVEN a DELETE for a staging row owned by a different inbox
			// WHEN authorization runs
			// THEN 403 Forbidden is returned (not 204 — would leak existence)
			'should enforce cross-inbox authorization on DELETE',
		)

		it.todo(
			// GIVEN a DELETE where storage.delete fails mid-call
			// WHEN the endpoint runs
			// THEN the response is 500 with a retry hint; the row is NOT silently left in DB
			'should surface storage-delete failures',
		)
	})

	describe('PATCH /v1/email/inboxes/:inboxId/drafts/:draftId', () => {
		it.todo(
			// GIVEN a PATCH with bodyJson
			// WHEN the handler runs
			// THEN renderBlocks produces html+text; provider update receives those; shadow row stores bodyJson
			'should render html+text from bodyJson and persist the shadow',
		)

		it.todo(
			// GIVEN a PATCH with a legacy "html" field
			// WHEN the handler validates the payload
			// THEN schema rejects the request — only bodyJson is accepted now
			'should reject legacy html/text fields in draft payloads',
		)

		it.todo(
			// GIVEN a PATCH with an empty bodyJson ([])
			// WHEN the handler runs
			// THEN the draft updates to an empty body (user cleared text); no crash
			'should handle empty bodyJson',
		)

		it.todo(
			// GIVEN a PATCH with bodyJson containing a stagingId that the caller does not own
			// WHEN the handler runs
			// THEN 403 Forbidden — cannot reference another inbox's staging
			'should reject cross-inbox stagingId references',
		)

		it.todo(
			// GIVEN a PATCH with a malformed bodyJson (schema decode fails)
			// WHEN the handler runs
			// THEN 400 BadRequest with a parse-error path pointing at the offending block
			'should return a localized parse error for malformed bodyJson',
		)

		it.todo(
			// GIVEN a PATCH for a draft in a different inbox than the path :inboxId
			// WHEN the handler runs
			// THEN 404 Not Found — no leaking drafts across inboxes
			'should not update drafts under the wrong inbox path',
		)
	})

	describe('POST /v1/email/send', () => {
		it.todo(
			// GIVEN a send with body containing an image block referencing stagingId=stg_1
			// AND attachments=[{stagingId: stg_1, inline: true}]
			// WHEN the handler runs
			// THEN resolve() pulls bytes from StorageProvider
			// AND renderBlocks rewrites the <img src> to cid:<generated>
			// AND markSentAndCleanup is invoked after the provider returns success
			'should end-to-end resolve, render, send, and clean up staged inline images',
		)

		it.todo(
			// GIVEN the provider send fails (e.g. suppressed recipient)
			// WHEN the handler runs
			// THEN staged blobs are NOT cleaned up (user can retry without re-uploading)
			'should preserve staging bytes when the send fails',
		)

		it.todo(
			// GIVEN a send with NO recipients (to/cc/bcc all empty)
			// WHEN the handler runs
			// THEN 400 BadRequest is returned
			'should reject sends with no recipients',
		)

		it.todo(
			// GIVEN a send with a malformed recipient address
			// WHEN the handler runs
			// THEN 400 BadRequest with the offending address
			'should validate recipient addresses',
		)

		it.todo(
			// GIVEN a send where the same stagingId appears in body AND attachments
			// WHEN the handler runs
			// THEN only one inline MIME part is generated; cid is shared
			'should deduplicate staging refs present in both body and attachments',
		)

		it.todo(
			// GIVEN a send that times out at the provider
			// WHEN the handler runs
			// THEN staged blobs are preserved and a retryable 504 is returned
			'should return a retryable error on provider timeout',
		)
	})

	describe('POST /v1/email/inboxes/:inboxId/threads/:threadId/reply', () => {
		it.todo(
			// GIVEN a reply body_json containing inline images with kind="cid" (inherited from parent)
			// WHEN the handler runs
			// THEN the parent's inline MIME parts are re-attached with matching Content-IDs
			// AND no staging resolve happens for those cids (they were never staged)
			're-attaches parent inline MIME parts for cid-inherited images',
		)

		it.todo(
			// GIVEN a reply where the parent no longer has a fetchable attachment (provider 404)
			// WHEN the handler runs
			// THEN the <img> is replaced with an "[image]" placeholder in the rendered quote
			// AND the send still succeeds
			'should degrade gracefully when a parent attachment is missing',
		)
	})
})
