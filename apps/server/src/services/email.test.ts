import { describe, it } from 'vitest'

describe('email service', () => {
	describe('footer rendering', () => {
		it.todo(
			// GIVEN user blocks ending in a paragraph AND a default footer with two paragraphs
			// WHEN the render pipeline runs
			// THEN the final HTML contains user paragraphs followed by footer paragraphs, inside one <body>
			// AND the plain text ends with the footer's text projection in the same order
			'should append footer blocks to user blocks before rendering',
		)

		it.todo(
			// GIVEN a send with skipFooter=true
			// WHEN the pipeline runs
			// THEN the footer block tree is not appended; output contains only user blocks
			'should honour skipFooter and emit no footer content',
		)

		it.todo(
			// GIVEN a footer row with body_json
			// WHEN listFooters returns
			// THEN the text_fallback is derived at read time, not stored (no stale fallbacks)
			'should derive text fallback at render time instead of reading from DB',
		)

		it.todo(
			// GIVEN an inbox with no default footer
			// WHEN the pipeline runs
			// THEN no footer is appended; user blocks are the full body
			'should render without a footer when none is configured',
		)

		it.todo(
			// GIVEN a footer with an inline image (staging reference)
			// WHEN the pipeline runs
			// THEN the image is resolved the same way user-body images are (shared resolver)
			// AND the final MIME has the logo as an inline attachment
			'should resolve footer inline images through the staging pipeline',
		)

		it.todo(
			// GIVEN a send with skipFooter=false on an empty body
			// WHEN the pipeline runs
			// THEN the output contains only the footer — no wrapper div, no trailing empty paragraphs
			'should render footer-only messages cleanly',
		)

		it.todo(
			// GIVEN a footer body_json that is malformed JSONB in the DB (drift)
			// WHEN the pipeline runs
			// THEN the error surfaces as InternalServerError with the footer ID in the log context
			'should fail loudly on corrupt footer body_json',
		)
	})

	describe('draft body shadow', () => {
		it.todo(
			// GIVEN createDraft is called with bodyJson
			// WHEN the service completes
			// THEN the provider draft has html+text
			// AND email_draft_bodies has a row with matching draft_id and body_json JSONB
			'should upsert the body shadow on draft creation',
		)

		it.todo(
			// GIVEN createDraft where the provider succeeds but the shadow DB insert fails
			// WHEN the compensating path runs
			// THEN the provider draft is deleted (no draft without a shadow pairing)
			'should rollback the provider draft on shadow insert failure',
		)

		it.todo(
			// GIVEN updateDraft is called with a new bodyJson
			// WHEN the service runs
			// THEN email_draft_bodies.body_json is replaced; updated_at advances
			'should replace the body shadow on draft update',
		)

		it.todo(
			// GIVEN updateDraft for a draft whose shadow row is missing (drift — e.g. manual DB intervention)
			// WHEN the service runs
			// THEN the shadow is UPSERTED (insert-if-missing), not errored
			'should upsert the shadow even when the existing row is missing',
		)

		it.todo(
			// GIVEN two concurrent updateDraft calls for the same draft_id
			// WHEN they run
			// THEN the last-writer-wins via updated_at; no unique-key exception
			'should handle concurrent updateDraft safely',
		)

		it.todo(
			// GIVEN getDraft is called
			// WHEN the service runs
			// THEN the returned DraftView contains bodyJson LEFT JOINed from the shadow table
			'should read back bodyJson alongside provider fields',
		)

		it.todo(
			// GIVEN getDraft is called for a draft whose shadow row does not exist (legacy pre-swap draft)
			// WHEN the service runs
			// THEN the result has bodyJson=undefined and the editor hydrates from html via sanitize
			'should tolerate missing shadow rows (legacy draft compatibility)',
		)

		it.todo(
			// GIVEN deleteDraft is called for a draft with two inline-image stagings
			// WHEN the service runs
			// THEN the provider draft is deleted
			// AND the email_draft_bodies row is deleted
			// AND sweepForDraft is called so staging rows + storage keys are cleaned
			'should cascade staging cleanup on draft delete',
		)

		it.todo(
			// GIVEN deleteDraft where the provider delete fails but the shadow delete succeeds
			// WHEN the compensating path runs
			// THEN the shadow is NOT silently left behind — the error bubbles up so operators see drift
			'should not hide provider delete failures',
		)

		it.todo(
			// GIVEN the parent inbox is deleted
			// WHEN the ON DELETE CASCADE fires
			// THEN all email_draft_bodies rows tied to its draft_ids also drop
			'should cascade shadow rows when an inbox is deleted',
		)
	})

	describe('send path', () => {
		it.todo(
			// GIVEN send() invoked with a bodyJson that references three staging attachments
			// WHEN the pipeline runs
			// THEN resolve() fetches all three, renderBlocks maps stagingIds to cids,
			// provider.send is invoked with the full attachment list,
			// and markSentAndCleanup fires with all three ids after success
			'should end-to-end resolve, render, send, and clean up staged inline images',
		)

		it.todo(
			// GIVEN provider.send fails (e.g. recipient suppressed)
			// WHEN the pipeline runs
			// THEN markSentAndCleanup is NOT called — staging blobs remain for retry
			// AND the failure reason is logged with event=email.send
			'should preserve staging bytes when the send fails',
		)

		it.todo(
			// GIVEN send() with a body that references a stagingId the user never actually uploaded
			// WHEN resolve() runs
			// THEN BadRequest is raised before provider.send is attempted
			'should not call the provider when a referenced staging is missing',
		)
	})
})
