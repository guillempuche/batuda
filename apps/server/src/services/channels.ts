import { DateTime, Effect } from 'effect'
import type { SqlClient } from 'effect/unstable/sql'

// The open channel shape both the MCP tool and the HTTP API accept. `kind` and
// `value` are the names the outside world uses; storage calls them `channel` and
// `address`. The two are mapped explicitly in one place (see `channelsJsonFor`),
// so renaming a column never silently changes what a caller receives.
//
// `kind` is free text — email, phone, linkedin, x, website, bluesky, … — so a new
// platform needs no schema change; only the email channel carries a
// deliverability `verification`. The send-suppression `status` is
// system-managed (the send gate + the bounce handler), never set by callers
// here, so re-discovering a bounced address never silently un-suppresses it.
export interface ChannelInput {
	readonly kind: string
	readonly value: string
	/** Which of several this is, in a person's words: "Girona shop". */
	readonly label?: string | undefined
	readonly verification?: string | undefined
	readonly confidence?: number | undefined
	readonly is_primary?: boolean | undefined
}

/** What a way of reaching someone can hang off. */
export type ChannelSubject = 'companies' | 'contacts'

// The ways of reaching a company that used to be columns on its row. Callers
// still name them that way — a company "has a website" reads naturally, and the
// API, the MCP tools and the web app all say it — so the names stay, and this is
// where they stop being columns and become rows.
const COMPANY_CHANNEL_FIELDS = [
	'website',
	'email',
	'phone',
	'instagram',
	'linkedin',
] as const

/**
 * Separate a company's write into the columns it really has and the ways of
 * reaching it, which live elsewhere now.
 *
 * Doing it here rather than at each entry point means the HTTP routes, both MCP
 * tools and the research apply path all behave the same, and none of them has to
 * know that these five stopped being columns.
 */
export const splitCompanyChannelFields = (
	data: Record<string, unknown>,
): {
	readonly columns: Record<string, unknown>
	readonly channels: ReadonlyArray<ChannelInput>
} => {
	const columns: Record<string, unknown> = {}
	const channels: Array<ChannelInput> = []
	for (const [key, value] of Object.entries(data)) {
		if (!(COMPANY_CHANNEL_FIELDS as ReadonlyArray<string>).includes(key)) {
			columns[key] = value
			continue
		}
		// A blank is a caller clearing the field, which is a removal rather than a
		// write; nothing to add, and the row it would have written is left alone.
		if (typeof value === 'string' && value.trim() !== '') {
			channels.push({ kind: key, value: value.trim(), is_primary: true })
		}
	}
	return { columns, channels }
}

// The resolved SQL client is passed in (not pulled from context) so these
// helpers add nothing to a caller's requirements — MCP tool handlers and HTTP
// route handlers both already hold one.
type Sql = SqlClient.SqlClient

/**
 * Normalize a channel confidence to the 0–100 whole number the column stores.
 * Sources disagree on scale: the research model reports a 0–1 fraction, while
 * email-verification and enrichment scores already arrive on 0–100. A value up
 * to 1 is read as a fraction and scaled up; anything above 1 is treated as an
 * already-scaled score. The result is rounded and kept within 0–100 so no
 * fractional or out-of-range value can reach the whole-number column.
 */
export const clampConfidence = (
	confidence: number | null | undefined,
): number | null => {
	if (confidence == null || !Number.isFinite(confidence)) return null
	const score = confidence <= 1 ? confidence * 100 : confidence
	return Math.round(Math.max(0, Math.min(100, score)))
}

/**
 * Upsert channels for one company or person — additive: re-discovering a handle
 * refreshes it in place and never deletes the others. `status` is deliberately
 * left out of the conflict update so a prior bounced/complained verdict survives.
 */
export const writeChannels = (
	sql: Sql,
	orgId: string,
	subject: { readonly table: ChannelSubject; readonly id: string },
	channels: ReadonlyArray<ChannelInput>,
) =>
	Effect.forEach(
		channels,
		c => sql`
			INSERT INTO channels
				(organization_id, subject_table, subject_id, channel, address, label, verification, confidence, is_primary)
			VALUES (
				${orgId}, ${subject.table}, ${subject.id}, ${c.kind}, ${c.value}, ${c.label ?? null},
				${c.verification ?? null}, ${clampConfidence(c.confidence)}, ${c.is_primary ?? false}
			)
			ON CONFLICT (subject_table, subject_id, channel, address) DO UPDATE SET
				label = COALESCE(EXCLUDED.label, channels.label),
				verification = EXCLUDED.verification,
				confidence = EXCLUDED.confidence,
				is_primary = EXCLUDED.is_primary,
				updated_at = now()
		`,
		{ discard: true },
	)

/**
 * The channels of one subject, primary first, as one JSON array column —
 * for a query that already has the subject's row aliased.
 *
 * Each key is named here rather than handing over the whole database row, so one
 * place decides what callers receive and a channel's internal bookkeeping —
 * owning organization, bounce counts, timestamps — stays out of the response.
 *
 * The two storage renames are absorbed here on purpose: `channel` is handed back
 * as `kind` and `address` as `value`, which are the names the HTTP API, the MCP
 * tools and the web app already use. Storage and the public contract move
 * separately, so renaming a column is never a breaking change to a caller unless
 * somebody chooses to make it one.
 */
export const channelsJsonFor = (sql: Sql, subject: ChannelSubject) =>
	sql`
		COALESCE((
			SELECT json_agg(json_build_object(
				'id', ch.id,
				'kind', ch.channel,
				'value', ch.address,
				'label', ch.label,
				'verification', ch.verification,
				'confidence', ch.confidence,
				'isPrimary', ch.is_primary,
				'status', ch.status,
				'statusReason', ch.status_reason
			) ORDER BY ch.is_primary DESC, ch.channel)
			FROM channels ch
			WHERE ch.subject_table = ${subject} AND ch.subject_id = c.id
		), '[]'::json)
	`

/**
 * The columns a channel row is handed back as, named one by one.
 *
 * Storage keys a channel by its subject and calls its two main columns `channel`
 * and `address`; every caller outside this file — the HTTP API, the web app, the
 * MCP tools — knows them as `contact_id`, `kind` and `value`. Translating in this
 * one place is what let the columns be renamed, and a company's channels be
 * stored beside a person's, without any of them noticing. Moving the outside
 * names is then a separate decision, made on purpose.
 */
const channelRowColumns = (sql: Sql) =>
	sql`
		id,
		subject_id AS contact_id,
		channel AS kind,
		address AS value,
		label, verification, confidence, is_primary,
		status, status_reason, status_updated_at, soft_bounce_count,
		created_at, updated_at
	`

/** Every channel of one subject, primary first. */
export const channelsOf = (
	sql: Sql,
	subject: { readonly table: ChannelSubject; readonly id: string },
) =>
	sql`
		SELECT ${channelRowColumns(sql)} FROM channels
		WHERE subject_table = ${subject.table} AND subject_id = ${subject.id}
		ORDER BY is_primary DESC, channel
	`

/** Add a single channel (the UI's "add"), returning the stored row. */
export const addChannel = (
	sql: Sql,
	orgId: string,
	subject: { readonly table: ChannelSubject; readonly id: string },
	c: ChannelInput,
) =>
	sql`
		INSERT INTO channels
			(organization_id, subject_table, subject_id, channel, address, label, verification, confidence, is_primary)
		VALUES (
			${orgId}, ${subject.table}, ${subject.id}, ${c.kind}, ${c.value}, ${c.label ?? null},
			${c.verification ?? null}, ${clampConfidence(c.confidence)}, ${c.is_primary ?? false}
		)
		ON CONFLICT (subject_table, subject_id, channel, address) DO UPDATE SET
			label = COALESCE(EXCLUDED.label, channels.label),
			is_primary = EXCLUDED.is_primary,
			updated_at = now()
		RETURNING ${channelRowColumns(sql)}
	`.pipe(Effect.map(rows => rows[0]))

/**
 * Edit a channel's reachable value / kind / label / primary flag. Never touches
 * `verification` or the suppression `status` — those are system-derived, so a
 * human rename can't drop the email channel's deliverability verdict.
 */
export const patchChannel = (
	sql: Sql,
	channelId: string,
	patch: {
		readonly kind?: string | undefined
		readonly value?: string | undefined
		readonly label?: string | null | undefined
		readonly is_primary?: boolean | undefined
	},
) =>
	Effect.gen(function* () {
		const data: Record<string, unknown> = {
			updatedAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
		}
		if (patch.kind !== undefined) data['channel'] = patch.kind
		if (patch.value !== undefined) data['address'] = patch.value
		if (patch.label !== undefined) data['label'] = patch.label
		if (patch.is_primary !== undefined) data['isPrimary'] = patch.is_primary
		const rows = yield* sql`
			UPDATE channels SET ${sql.update(data)}
			WHERE id = ${channelId} RETURNING ${channelRowColumns(sql)}
		`
		return rows[0]
	})

/** Remove a channel by id. */
export const deleteChannel = (sql: Sql, channelId: string) =>
	sql`DELETE FROM channels WHERE id = ${channelId}`

/**
 * Reset a person's email suppression to `unknown` — used after a
 * bounced/complained contact confirms the address is good again, re-enabling
 * outbound mail to it.
 */
export const clearEmailSuppression = (sql: Sql, contactId: string) =>
	sql`
		UPDATE channels
		SET status = 'unknown',
		    status_reason = NULL,
		    status_updated_at = now(),
		    soft_bounce_count = 0
		WHERE subject_table = 'contacts'
			AND subject_id = ${contactId}
			AND channel = 'email'
	`
