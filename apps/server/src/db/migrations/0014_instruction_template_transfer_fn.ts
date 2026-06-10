import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Reassigning a personal instruction template to another member can't happen in
// the member's own access scope: the per-user read policy
// (owner_user_id IS NULL OR = the current user) hides the resulting row from
// them, and the row-level security rules refuse to write a row you can't see.
// This function runs the single ownership change with elevated rights, but
// re-checks the rules itself first — the caller must own the template in the
// active org, and the target must be a live member of that same org — so the
// elevation can never move a template across users or orgs even if a caller's
// own checks are wrong. Only the request role may run it; the search path is
// pinned empty and every object fully qualified, the standard hardening so the
// body can't be tricked into running through a same-named impostor object.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		CREATE OR REPLACE FUNCTION public.transfer_instruction_template(
			p_template_id uuid,
			p_target_user_id text
		) RETURNS SETOF public.instruction_templates
		LANGUAGE plpgsql
		SECURITY DEFINER
		SET search_path = ''
		AS $$
		DECLARE
			v_actor text := current_setting('app.current_user_id', true);
			v_org   text := current_setting('app.current_org_id', true);
		BEGIN
			IF v_actor IS NULL OR v_actor = '' OR v_org IS NULL OR v_org = '' THEN
				RAISE EXCEPTION 'instruction template transfer requires an active org and user scope';
			END IF;

			IF NOT EXISTS (
				SELECT 1 FROM public.member
				WHERE "userId" = p_target_user_id AND "organizationId" = v_org
			) THEN
				RAISE EXCEPTION 'instruction template transfer target is not a member of the active org';
			END IF;

			RETURN QUERY
				WITH updated AS (
					UPDATE public.instruction_templates
					SET owner_user_id = p_target_user_id, updated_at = now()
					WHERE id = p_template_id
						AND organization_id = v_org
						AND owner_user_id = v_actor
					RETURNING *
				)
				SELECT * FROM updated;
		END;
		$$
	`

	// Lock execution to the request role while the migration role still owns the
	// function — these are owner-only changes.
	yield* sql`REVOKE EXECUTE ON FUNCTION public.transfer_instruction_template(uuid, text) FROM PUBLIC`
	yield* sql`GRANT EXECUTE ON FUNCTION public.transfer_instruction_template(uuid, text) TO app_user`

	// The function must run as app_service (BYPASSRLS) so its definer rights can
	// write the new owner. Handing ownership over needs app_service to hold CREATE
	// on the schema for that one step, so grant it just long enough to make the
	// transfer, then take it back to keep app_service at least privilege.
	yield* sql`GRANT CREATE ON SCHEMA public TO app_service`
	yield* sql`ALTER FUNCTION public.transfer_instruction_template(uuid, text) OWNER TO app_service`
	yield* sql`REVOKE CREATE ON SCHEMA public FROM app_service`
})
