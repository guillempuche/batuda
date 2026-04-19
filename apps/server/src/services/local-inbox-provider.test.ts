import { describe, it } from 'vitest'

describe('LocalInboxProvider drafts', () => {
	describe('on-disk format', () => {
		it.todo(
			// GIVEN createDraft is called with { subject, to, html, text, bodyJson }
			// WHEN the draft JSON file is written to DRAFTS_DIR
			// THEN the file contains the bodyJson field alongside html and text
			'should include bodyJson in the persisted draft file',
		)

		it.todo(
			// GIVEN an existing draft JSON file without bodyJson (pre-swap file)
			// WHEN getDraft reads it
			// THEN the returned draft has bodyJson = undefined (no crash, no migration)
			'should tolerate legacy draft files that lack bodyJson',
		)

		it.todo(
			// GIVEN updateDraft replaces bodyJson
			// WHEN the file is re-read
			// THEN only the patched fields change; unaffected fields (attachments, sendAt) are preserved
			'should update bodyJson without clobbering other fields',
		)

		it.todo(
			// GIVEN two concurrent updateDraft calls for the same draft_id
			// WHEN both fire
			// THEN the write happens atomically (rename-from-tmp pattern) — no partial/corrupt file mid-read
			'should write drafts atomically to avoid partial reads',
		)

		it.todo(
			// GIVEN a corrupt JSON file (e.g. truncated during a previous crash)
			// WHEN getDraft reads it
			// THEN the error surfaces as a structured error with the draft filename
			'should raise a descriptive error on corrupt draft files',
		)

		it.todo(
			// GIVEN a getDraft call for a draft that never existed
			// WHEN the service runs
			// THEN NotFound is returned — not a raw ENOENT
			'should map missing draft files to NotFound',
		)

		it.todo(
			// GIVEN a deleteDraft for a draft that never existed
			// WHEN the service runs
			// THEN the call is idempotent (204 no-op)
			'should no-op when deleting a missing draft',
		)

		it.todo(
			// GIVEN a draft_id containing path separators or ".."
			// WHEN any CRUD method runs
			// THEN the operation is refused — no escape from DRAFTS_DIR
			'should reject draft_ids that attempt path traversal',
		)

		it.todo(
			// GIVEN a bodyJson containing a large (~2 MB) recursive quote tree
			// WHEN written to disk
			// THEN the file is written without truncation and re-read identically
			'should round-trip large bodyJson structures',
		)

		it.todo(
			// GIVEN bodyJson containing unicode (emoji, RTL, Chinese)
			// WHEN written and re-read
			// THEN the code points are preserved byte-for-byte via UTF-8
			'should preserve unicode in bodyJson on disk',
		)
	})

	describe('draft listing', () => {
		it.todo(
			// GIVEN 10 drafts on disk, one of which is malformed
			// WHEN listDrafts runs
			// THEN 9 drafts are returned and the malformed one is logged but skipped (no hard failure)
			'should skip malformed draft files while listing others',
		)
	})
})
