import { DateTime, Effect } from 'effect'
import type { SqlClient } from 'effect/unstable/sql'

// The open channel shape both the MCP tool and the HTTP API accept. `kind` is
// free text — email, phone, linkedin, x, website, bluesky, … — so a new
// platform needs no schema change; only the email channel carries a
// deliverability `verification`. The send-suppression `status` is
// system-managed (the send gate + the bounce handler), never set by callers
// here, so re-discovering a bounced address never silently un-suppresses it.
export interface ChannelInput {
	readonly kind: string
	readonly value: string
	readonly verification?: string | undefined
	readonly confidence?: number | undefined
	readonly is_primary?: boolean | undefined
}

// The resolved SQL client is passed in (not pulled from context) so these
// helpers add nothing to a caller's requirements — MCP tool handlers and HTTP
// route handlers both already hold one.
type Sql = SqlClient.SqlClient

/**
 * Upsert channels for a contact — additive: re-discovering a handle refreshes
 * it in place and never deletes the others. `status` is deliberately left out
 * of the conflict update so a prior bounced/complained verdict survives.
 */
export const writeChannels = (
	sql: Sql,
	orgId: string,
	contactId: string,
	channels: ReadonlyArray<ChannelInput>,
) =>
	Effect.forEach(
		channels,
		c => sql`
			INSERT INTO contact_channels
				(organization_id, contact_id, kind, value, verification, confidence, is_primary)
			VALUES (
				${orgId}, ${contactId}, ${c.kind}, ${c.value},
				${c.verification ?? null}, ${c.confidence ?? null}, ${c.is_primary ?? false}
			)
			ON CONFLICT (contact_id, kind, value) DO UPDATE SET
				verification = EXCLUDED.verification,
				confidence = EXCLUDED.confidence,
				is_primary = EXCLUDED.is_primary,
				updated_at = now()
		`,
		{ discard: true },
	)

/** Every channel for a contact, primary first. */
export const channelsOf = (sql: Sql, contactId: string) =>
	sql`
		SELECT * FROM contact_channels
		WHERE contact_id = ${contactId}
		ORDER BY is_primary DESC, kind
	`

/** Add a single channel (the UI's "add"), returning the stored row. */
export const addChannel = (
	sql: Sql,
	orgId: string,
	contactId: string,
	c: ChannelInput,
) =>
	sql`
		INSERT INTO contact_channels
			(organization_id, contact_id, kind, value, verification, confidence, is_primary)
		VALUES (
			${orgId}, ${contactId}, ${c.kind}, ${c.value},
			${c.verification ?? null}, ${c.confidence ?? null}, ${c.is_primary ?? false}
		)
		ON CONFLICT (contact_id, kind, value) DO UPDATE SET
			is_primary = EXCLUDED.is_primary,
			updated_at = now()
		RETURNING *
	`.pipe(Effect.map(rows => rows[0]))

/**
 * Edit a channel's reachable value / kind / primary flag. Never touches
 * `verification` or the suppression `status` — those are system-derived, so a
 * human rename can't drop the email channel's deliverability verdict.
 */
export const patchChannel = (
	sql: Sql,
	channelId: string,
	patch: {
		readonly kind?: string | undefined
		readonly value?: string | undefined
		readonly is_primary?: boolean | undefined
	},
) =>
	Effect.gen(function* () {
		const data: Record<string, unknown> = {
			updatedAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
		}
		if (patch.kind !== undefined) data['kind'] = patch.kind
		if (patch.value !== undefined) data['value'] = patch.value
		if (patch.is_primary !== undefined) data['isPrimary'] = patch.is_primary
		const rows = yield* sql`
			UPDATE contact_channels SET ${sql.update(data)}
			WHERE id = ${channelId} RETURNING *
		`
		return rows[0]
	})

/** Remove a channel by id. */
export const deleteChannel = (sql: Sql, channelId: string) =>
	sql`DELETE FROM contact_channels WHERE id = ${channelId}`

/**
 * Reset the email channel's suppression to `unknown` — used after a
 * bounced/complained contact confirms the address is good again, re-enabling
 * outbound mail to it.
 */
export const clearEmailSuppression = (sql: Sql, contactId: string) =>
	sql`
		UPDATE contact_channels
		SET status = 'unknown',
		    status_reason = NULL,
		    status_updated_at = now(),
		    soft_bounce_count = 0
		WHERE contact_id = ${contactId} AND kind = 'email'
	`
