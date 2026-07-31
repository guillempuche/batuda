import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Who a mailbox belongs to is no longer something an ordinary request can write.
//
// A mailbox belongs to one person, or to the whole team when nobody owns it,
// and since 0046 that single fact decides who may read it, change it, or send
// from it. Nothing in the database was enforcing it. The rule lived entirely in
// application code; underneath, the only thing row security asked of a mailbox
// was that it stay inside the organization, and the request role could write
// every column. Any member could put their own name on a colleague's mailbox —
// and a mailbox carries the stored password for someone's real email account.
//
// No route reached it. Both ways in go through the same service, which refuses
// first: a member who does not already own a mailbox cannot see it at all. So
// this closes a gap under the floor rather than a hole somebody could walk
// through. It is worth closing because the same arrangement, one table over,
// stopped being theoretical the moment its application check was removed —
// the check had been the only thing there, and nobody knew.
//
// Handing a mailbox over is a real thing admins do, so the column cannot simply
// be taken away. It moves instead into a routine that re-checks the rules for
// itself — the caller runs the organization, the receiver is really a member of
// it — the same shape 0014 uses for instruction templates. The routine settles
// the two things that follow from a handover in the same breath, because the
// database refuses the in-between states: a mailbox nobody owns cannot be
// hidden from the team, and whoever receives one chooses for themselves whether
// they send from it.
//
// The columns an ordinary request may still write are listed rather than
// excluded, so a column added later is not writable until somebody says so. If
// that is forgotten, the write fails loudly and says which table.
//
// expand-contract: replacing the grant means dropping it first, and in the
// moment between, an ordinary member's edit is refused. Both statements sit
// inside one migration.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		CREATE OR REPLACE FUNCTION public.transfer_inbox(
			p_inbox_id uuid,
			p_target_user_id text
		) RETURNS SETOF public.inboxes
		LANGUAGE plpgsql
		SECURITY DEFINER
		SET search_path = ''
		AS $$
		DECLARE
			v_actor text := current_setting('app.current_user_id', true);
			v_org   text := current_setting('app.current_org_id', true);
		BEGIN
			IF v_actor IS NULL OR v_actor = '' OR v_org IS NULL OR v_org = '' THEN
				RAISE EXCEPTION 'mailbox handover requires an active org and user scope';
			END IF;

			IF NOT EXISTS (
				SELECT 1 FROM public.member
				WHERE "userId" = v_actor
					AND "organizationId" = v_org
					AND role IN ('owner', 'admin')
			) THEN
				RAISE EXCEPTION 'only an organization admin can hand a mailbox over';
			END IF;

			-- A null target gives the mailbox to the whole team, which needs no
			-- membership check. Anyone else must really be in the organization.
			IF p_target_user_id IS NOT NULL AND NOT EXISTS (
				SELECT 1 FROM public.member
				WHERE "userId" = p_target_user_id AND "organizationId" = v_org
			) THEN
				RAISE EXCEPTION 'mailbox handover target is not a member of the active org';
			END IF;

			RETURN QUERY
				WITH updated AS (
					UPDATE public.inboxes
					SET owner_user_id = p_target_user_id,
						-- A mailbox the whole team owns cannot be hidden from them.
						is_private = CASE
							WHEN p_target_user_id IS NULL THEN false
							ELSE is_private
						END,
						-- Receiving a mailbox does not decide that you send from it.
						is_default = false,
						updated_at = now()
					WHERE id = p_inbox_id AND organization_id = v_org
					RETURNING *
				)
				SELECT * FROM updated;
		END;
		$$
	`

	// Only the request role runs it, while the migration role still owns it.
	yield* sql`REVOKE EXECUTE ON FUNCTION public.transfer_inbox(uuid, text) FROM PUBLIC`
	yield* sql`GRANT EXECUTE ON FUNCTION public.transfer_inbox(uuid, text) TO app_user`

	// It has to run as a role whose rights can write the owner column once the
	// grant below no longer covers it. app_service needs CREATE on the schema for
	// that one step, so it is given and taken straight back.
	yield* sql`GRANT CREATE ON SCHEMA public TO app_service`
	yield* sql`ALTER FUNCTION public.transfer_inbox(uuid, text) OWNER TO app_service`
	yield* sql`REVOKE CREATE ON SCHEMA public FROM app_service`

	// Everything about a mailbox stays a member's to edit except the two things
	// that say whose it is and where it lives.
	yield* sql`REVOKE UPDATE ON inboxes FROM app_user`
	yield* sql`
		GRANT UPDATE (
			email, display_name, description, is_default, is_private, active,
			imap_host, imap_port, imap_security,
			smtp_host, smtp_port, smtp_security,
			username, password_ciphertext, password_nonce, password_tag,
			grant_status, grant_last_error, grant_last_seen_at,
			folder_state, updated_at
		) ON inboxes TO app_user
	`
})
