import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// A mailbox now says what it is for in whatever words fit, and who may touch it
// follows from who owns it.
//
// Every mailbox used to be filed under one of three fixed kinds — a person's,
// an assistant's, or the whole team's. Those three words decided three
// unrelated things at once: whether the mailbox needed an owner, which mailbox
// someone sends from by default, and the label shown in the list. None of them
// said how the mailbox is actually used, and nobody could write that down.
// `description` is free text for exactly that, and carries no rules of its own.
//
// The rules move onto the owner: a mailbox with an owner belongs to that
// person, a mailbox without one is the whole team's. The old check already said
// the same, so no mailbox that was legal before becomes illegal — only the
// column that decides it changes.
//
// Three smaller things ride along:
//
//   * A mailbox nobody owns is nobody's default. Nothing ever read such a mark
//     — "which mailbox do I send from" always asks for the caller's own — yet
//     the list drew a star on team mailboxes, so the star did nothing.
//   * The same address is connected once at a time. Reconnecting an address
//     whose password had gone stale left the broken mailbox in the list beside
//     the new one. Removed mailboxes keep theirs, since history points at them.
//   * `member.primary_inbox_id` goes: it was meant to hold a member's default
//     sending address and was never once written. The mark on the mailbox row
//     is what the product reads.
//
// expand-contract: pre-production, no backward-compatibility guarantee — every
// reader of `purpose` ships in this same release, `description` starts empty
// for mailboxes connected before it, and `member.primary_inbox_id` has no
// reader to break.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`ALTER TABLE inboxes ADD COLUMN IF NOT EXISTS description TEXT`
	// A line about what the mailbox is for, not a place to paste a document.
	yield* sql`
		ALTER TABLE inboxes
			ADD CONSTRAINT inboxes_description_len_chk CHECK (
				description IS NULL OR char_length(description) <= 200
			)
	`

	// A team mailbox is nobody's default — clear the marks that were settable
	// but never readable, so the surviving rule only has to describe owned ones.
	yield* sql`
		UPDATE inboxes
		SET is_default = false, updated_at = now()
		WHERE owner_user_id IS NULL AND is_default = true
	`

	// One address, one mailbox in use. The newest wins, since connecting an
	// address a second time is someone repairing the first; the rest switch off
	// the same way removing a mailbox does, so history still resolves through
	// them.
	yield* sql`
		UPDATE inboxes
		SET active = false, is_default = false, updated_at = now()
		WHERE active = true
		  AND id NOT IN (
			SELECT DISTINCT ON (organization_id, lower(email)) id
			FROM inboxes
			WHERE active = true
			ORDER BY organization_id, lower(email), created_at DESC
		  )
	`

	// One person, one default. Prefer a mailbox still in use, then the earliest
	// they connected.
	yield* sql`
		UPDATE inboxes
		SET is_default = false, updated_at = now()
		WHERE owner_user_id IS NOT NULL
		  AND is_default = true
		  AND id NOT IN (
			SELECT DISTINCT ON (organization_id, owner_user_id) id
			FROM inboxes
			WHERE owner_user_id IS NOT NULL AND is_default = true
			ORDER BY organization_id, owner_user_id, active DESC, created_at ASC
		  )
	`

	yield* sql`
		ALTER TABLE inboxes DROP CONSTRAINT IF EXISTS inboxes_purpose_owner_chk
	`
	// A mailbox nobody owns is the whole team's, so it can neither be hidden
	// from them nor stand in for any one person as their default.
	yield* sql`
		ALTER TABLE inboxes
			ADD CONSTRAINT inboxes_team_mailbox_chk CHECK (
				owner_user_id IS NOT NULL OR (is_private = false AND is_default = false)
			)
	`

	// Dropping the column takes its own index and the two default-uniqueness
	// rules with it, since all three were written in terms of it.
	yield* sql`ALTER TABLE inboxes DROP COLUMN purpose`

	// The per-owner default rule comes back without the dropped column. It has
	// no twin for team mailboxes: a mailbox nobody owns is nobody's default.
	yield* sql`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_inboxes_default_per_owner
		ON inboxes(organization_id, owner_user_id)
		WHERE is_default = true AND owner_user_id IS NOT NULL
	`

	yield* sql`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_inboxes_email_active
		ON inboxes(organization_id, lower(email))
		WHERE active = true
	`

	// Dropping the column takes its foreign key and index with it.
	yield* sql`ALTER TABLE "member" DROP COLUMN IF EXISTS primary_inbox_id`
})
