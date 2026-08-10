import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// A backstop under the five words an address's verdict can be, and two indexes
// nothing needs.
//
// Nothing still running can write anything but these five, and the words that
// predate that were put right by 0063, which is already live — so the check
// cannot fail on what is on file. What it adds is that the column stays that way
// through the next hand-run repair or one-off script, which is how the wrong
// words got in.
//
// The two indexes are each the leading columns of a wider one that is already
// there, so every lookup they served is served without them. They cost a write
// on every insert and update to answer nothing that is asked.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE channels ADD CONSTRAINT channels_verification_chk
			CHECK (verification IS NULL OR verification IN
				('deliverable','risky','catch_all','undeliverable','unknown'))
	`

	// Covered by channels_subject_address_idx (subject_table, subject_id, channel, address).
	yield* sql`DROP INDEX IF EXISTS channels_subject_idx`

	// Covered by channels_org_address_idx (organization_id, channel, lower(address)).
	yield* sql`DROP INDEX IF EXISTS idx_channels_org`
})
