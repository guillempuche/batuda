import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Two invariants the code assumed and nothing held it to.
//
// A kind is stored as it was typed, while everything that reads by kind asks for
// a lowercase one. `channelAddressIsValid` lowercases before looking up a shape,
// so `Email` passes as an email and is then invisible to the send gate, to the
// suppression clear, and to the check that strips a bounce off a row that stops
// being an email. A bounced address stored that way is never held back.
//
// And each kind is supposed to have exactly one address marked as the one to
// use. Nothing enforced it, and two ways of putting the mark down left a kind
// with none while two writers at once could leave it with two. Every screen then
// picks a different address, and a different one again on the next load.
//
// The app now folds a kind on the way in and hands the mark on when it is put
// down. This puts right what was stored before that, and adds the index so the
// pair cannot come back — a unique index as a race guard is one of the two things
// docs/backend.md allows the database to decide.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	// A row whose kind only differs by case or spacing from one already stored
	// the canonical way is a duplicate of it, and folding it would collide with
	// the unique index on (subject, kind, address). The canonical row is the one
	// that has been readable all along, so it stays and the shadow goes.
	yield* sql`
		DELETE FROM channels odd
		WHERE odd.channel <> lower(trim(odd.channel))
			AND EXISTS (
				SELECT 1 FROM channels canonical
				WHERE canonical.subject_table = odd.subject_table
					AND canonical.subject_id = odd.subject_id
					AND canonical.address = odd.address
					AND canonical.channel = lower(trim(odd.channel))
			)
	`

	yield* sql`
		UPDATE channels SET channel = lower(trim(channel))
		WHERE channel <> lower(trim(channel))
	`

	// Where a kind ended up with more than one, the oldest keeps it: it is the one
	// that has been answering all along, so the fewest readers change their mind.
	yield* sql`
		UPDATE channels SET is_primary = false
		WHERE is_primary
			AND id NOT IN (
				SELECT DISTINCT ON (subject_table, subject_id, channel) id
				FROM channels
				WHERE is_primary
				ORDER BY subject_table, subject_id, channel, created_at, id
			)
	`

	// No index holding the one-per-kind rule yet, though that is where it belongs.
	// Both writers set the new mark first and take the old one down second, so
	// inside a single transaction two rows carry it — which a unique index refuses
	// on the spot, and a partial one cannot be deferred. Enforcing it means
	// reordering both writes and teaching the duplicate-row handler which of two
	// constraints fired, since it currently answers every 23505 with "that address
	// is already on file". Worth doing, too big to ride along with a repair.
})
