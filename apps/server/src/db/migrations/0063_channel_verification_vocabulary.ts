import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Put right what the deliverability column holds, now that the app refuses
// anything else on the way in.
//
// `verification` was free text at every door, so a word nothing in the app
// understands could be written and then never changed: the edit path deliberately
// left verdicts alone, so an address stamped with one was stuck with it. Our own
// data has addresses guessed from a company's email pattern carrying the word
// "inferred", which no reader knows.
//
// Nothing is added to the database to enforce the list. A CHECK belongs here by
// the usual rule — a closed vocabulary, repaired first — but the deploy applies
// migrations *before* the new build goes out and the old one keeps serving
// meanwhile (docs/runbooks.md, Rolling-deploy compatibility). The instance still
// running accepts any string, so a constraint landing now would start rejecting
// its writes mid-release. It goes in the release after this one, once no running
// version can write a word the list does not have.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	// Case and stray spacing first, before anything is judged unrecognisable.
	// "Deliverable" from the same import that produced "inferred" is exactly as
	// likely, and demoting that one would put a warning on an address a check had
	// already cleared.
	yield* sql`
		UPDATE channels SET verification = lower(trim(verification))
		WHERE verification IS NOT NULL
			AND verification <> lower(trim(verification))
			AND lower(trim(verification)) IN
				('deliverable','risky','catch_all','undeliverable','unknown')
	`

	// Then whatever is left that was never a verdict. "risky" is the honest
	// reading: a word nobody recognises is not a check that came back, it is
	// something somebody wrote, and an address carrying it should show doubt.
	//
	// Not "unknown", which says a check ran and settled nothing. Nothing ran on
	// these. Our own data has addresses guessed from a company's email pattern
	// stamped "inferred" — a guess is exactly what "risky" is for, and filing it
	// as a finished check would claim more than anybody knows.
	//
	// Only rows that hold something. A null verdict is not an unrecognised one:
	// it means nobody has checked, which is no evidence against the address at
	// all. Almost every address somebody typed by hand is null, so sweeping those
	// in would put a warning on the entire book — and there is no way back.
	yield* sql`
		UPDATE channels SET verification = 'risky'
		WHERE verification IS NOT NULL
			AND verification NOT IN
				('deliverable','risky','catch_all','undeliverable','unknown')
	`

	// The score that came with a repaired word is left alone. It is about the
	// address, not the wording — a model's own confidence, a verifier's score, an
	// enrichment match strength — and every reader that acts on a verdict wants
	// `deliverable` before the score matters at all. Clearing it would destroy
	// something this migration cannot put back.

	// And the rows that belong to nobody. A channel names its subject by two plain
	// columns because one key cannot point at two tables, so there is no foreign
	// key to cascade and deleting a contact used to leave their addresses behind.
	// Those rows still answer: the send gate looks a bounced address up across the
	// whole organisation without asking whose it is, so a leftover row goes on
	// blocking mail — and the only way to lift a block is scoped to a contact who
	// is gone. Deleting a person now takes their channels with them; this clears
	// what the old behaviour left.
	yield* sql`
		DELETE FROM channels
		WHERE subject_table = 'contacts'
			AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = channels.subject_id)
	`
	// The other two subjects for completeness. Companies are never hard-deleted,
	// and a branch has cleaned its own channels since the release that gave
	// branches channels at all, so both are expected to be nothing.
	yield* sql`
		DELETE FROM channels
		WHERE subject_table = 'companies'
			AND NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = channels.subject_id)
	`
	yield* sql`
		DELETE FROM channels
		WHERE subject_table = 'sites'
			AND NOT EXISTS (SELECT 1 FROM sites s WHERE s.id = channels.subject_id)
	`
})
