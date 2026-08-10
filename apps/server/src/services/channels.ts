import { DateTime, Effect } from 'effect'
import type { SqlClient, SqlError } from 'effect/unstable/sql'

import { BadRequest } from '@batuda/controllers'
import {
	channelAddressIsValid,
	type HandSetVerificationVerdict,
	type VerificationVerdict,
} from '@batuda/domain'

import { pgErrorCode } from '../lib/pg-error'

// The shape a bulk channel write takes. `kind` and `value` are the names the
// outside world uses; storage calls them `channel` and `address`. The two are
// mapped explicitly in one place (see `channelsJsonFor`), so renaming a column
// never silently changes what a caller receives.
//
// `kind` is free text — email, phone, linkedin, x, website, bluesky, … — so a new
// platform needs no schema change; only the email channel carries a
// deliverability `verification`.
//
// The full verdict vocabulary is allowed here because the research pipeline
// writes through this shape and a mailbox probe is the one thing that may say an
// address is good. The doors a person or an assistant reaches take the narrower
// hand-set list instead, so nobody can claim a verdict nobody earned.
//
// The send-suppression `status` is system-managed (the send gate + the bounce
// handler) and is never accepted from a caller, so re-discovering a bounced
// address cannot quietly un-suppress it.
export interface ChannelInput {
	readonly kind: string
	readonly value: string
	/** Which of several this is, in a person's words: "Girona shop". */
	readonly label?: string | undefined
	readonly verification?: VerificationVerdict | undefined
	readonly confidence?: number | undefined
	readonly is_primary?: boolean | undefined
}

/**
 * The one spelling a kind is stored in.
 *
 * `channelAddressIsValid` lowercases before it looks up a shape, so `Email`
 * validates as an email — and then everything that reads by kind looks for
 * `channel = 'email'` and never finds it. An address stored that way is invisible
 * to the send gate, to the suppression clear, and to the check that strips a
 * bounce off a row that stops being an email.
 */
export const foldKind = (kind: string): string => kind.trim().toLowerCase()

/** What a way of reaching someone can hang off. */
export type ChannelSubject = 'companies' | 'contacts' | 'sites'

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
 * refreshes it in place and never deletes the others.
 *
 * Nothing a write leaves unsaid is erased. A verdict, once established, is only
 * replaced by another verdict; a write that mentions the address but says nothing
 * about its deliverability keeps what is on file. That matters because saying
 * nothing used to mean "no verdict", and no verdict is the one state the send
 * gate lets straight through — so re-saving a contact's addresses quietly made a
 * known-dead one sendable again. `addChannel` already worked this way; this is
 * the two of them agreeing.
 *
 * The score follows the verdict that earned it: a fresh verdict brings its own
 * (even none), while a write carrying only a score refreshes the score alone.
 * `status` stays out of the conflict update entirely, so a prior
 * bounced/complained result survives.
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
				${orgId}, ${subject.table}, ${subject.id}, ${foldKind(c.kind)}, ${c.value}, ${c.label ?? null},
				${c.verification ?? null}, ${clampConfidence(c.confidence)}, COALESCE(${c.is_primary ?? null}, false)
			)
			ON CONFLICT (subject_table, subject_id, channel, address) DO UPDATE SET
				label = COALESCE(EXCLUDED.label, channels.label),
				verification = COALESCE(EXCLUDED.verification, channels.verification),
				confidence = CASE
					WHEN EXCLUDED.verification IS NOT NULL THEN EXCLUDED.confidence
					ELSE COALESCE(EXCLUDED.confidence, channels.confidence)
				END,
				is_primary = COALESCE(${c.is_primary ?? null}, channels.is_primary),
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
			) ORDER BY ch.is_primary DESC, ch.channel, ch.created_at, ch.id)
			FROM channels ch
			WHERE ch.subject_table = ${subject} AND ch.subject_id = c.id
		), '[]'::json)
	`

/**
 * Storage calls a channel's two main columns `channel` and `address`, while
 * everyone reading a channel knows them as `kind` and `value`. Translating in
 * this one place keeps the storage names free to change on their own.
 */
const channelColumnsWithoutSubject = (sql: Sql) =>
	sql`
		channel AS kind,
		address AS value,
		label, verification, confidence, is_primary,
		status, status_reason, status_updated_at, soft_bounce_count,
		created_at, updated_at
	`

// A person's channels are handed back keyed `contact_id`: that is the name
// callers read them by, whatever storage calls the column.
const channelRowColumns = (sql: Sql) =>
	sql`id, subject_id AS contact_id, ${channelColumnsWithoutSubject(sql)}`

/** Every channel of one person, primary first. */
export const channelsOf = (
	sql: Sql,
	subject: { readonly table: ChannelSubject; readonly id: string },
) =>
	sql`
		SELECT ${channelRowColumns(sql)} FROM channels
		WHERE subject_table = ${subject.table} AND subject_id = ${subject.id}
		ORDER BY is_primary DESC, channel, created_at, id
	`

/**
 * Every channel of a company or one of its branches, primary first.
 *
 * Kept apart from `channelsOf` because that one hands the subject back as
 * `contact_id`, which is a lie for a company: anyone passing that id where a
 * contact id belongs would be trusting the field name, not misreading it.
 */
export const subjectChannelsOf = (
	sql: Sql,
	subject: { readonly table: ChannelSubject; readonly id: string },
) =>
	sql`
		SELECT id, subject_table, subject_id, ${channelColumnsWithoutSubject(sql)}
		FROM channels
		WHERE subject_table = ${subject.table} AND subject_id = ${subject.id}
		ORDER BY is_primary DESC, channel, created_at, id
	`

/**
 * Stand down whichever address of the same kind was the default before, leaving
 * the named one as the only one.
 *
 * "Primary" is what decides where a message actually goes, so two of them for
 * one kind is not a cosmetic mess: the address a message leaves for becomes
 * whichever the sort happens to surface first. That was unaskable while a
 * company had a single mailbox, and is asked constantly once it has three.
 *
 * The old default is read from the newly-marked row itself, so nothing has to be
 * looked up first and no caller can pass a subject that disagrees with the row.
 */
const standDownOtherPrimaries = (sql: Sql, channelId: string) =>
	sql`
		UPDATE channels SET is_primary = false, updated_at = now()
		WHERE id <> ${channelId}
			AND is_primary
			AND (subject_table, subject_id, channel) = (
				SELECT subject_table, subject_id, channel
				FROM channels WHERE id = ${channelId}
			)
	`

/**
 * Hand the default to the oldest surviving address of a kind, when whatever held
 * it is gone.
 *
 * Taking the default away and putting it nowhere leaves the kind headless, and
 * the readers do not agree on what happens then — one takes the first row of a
 * sort, another the first of a different sort. So a screen, a compose box and the
 * send gate could each name a different address, and a different one again on the
 * next load. Handing it on immediately is what keeps them saying the same thing.
 *
 * The oldest one takes it, and addresses recorded together — which share a
 * timestamp — are settled by id, so the answer is always the same one rather
 * than whichever the sort happens to surface.
 *
 * Does nothing when the kind still has a default or has no addresses left, so it
 * is safe to call after any removal.
 */
const electPrimaryIfNone = (
	sql: Sql,
	orgId: string,
	subject: { readonly table: ChannelSubject; readonly id: string },
	kind: string,
) =>
	sql`
		UPDATE channels SET is_primary = true, updated_at = now()
		WHERE id = (
			SELECT id FROM channels
			WHERE subject_table = ${subject.table} AND subject_id = ${subject.id}
				AND organization_id = ${orgId} AND channel = ${kind}
			ORDER BY created_at, id
			LIMIT 1
		)
		AND NOT EXISTS (
			SELECT 1 FROM channels
			WHERE subject_table = ${subject.table} AND subject_id = ${subject.id}
				AND organization_id = ${orgId} AND channel = ${kind} AND is_primary
		)
	`

/**
 * Turn away an address that could never be one of its kind.
 *
 * The company fields check this on the way in, so without the same check here a
 * mail address the create tool refuses is accepted by the channel tool — one
 * value, two doors, two answers. A kind nothing describes passes, because an
 * unknown platform is not a wrong address.
 */
const assertAddressLooksRight = (kind: string, value: string) =>
	channelAddressIsValid(kind, value)
		? Effect.void
		: Effect.fail(
				new BadRequest({
					// "a valid email" rather than "a email": the article stays right
					// whatever the kind is called.
					message: `That does not look like a valid ${kind}: "${value}".`,
				}),
			)

/** Add a single channel (the UI's "add"), returning the stored row. */
export const addChannel = (
	sql: Sql,
	orgId: string,
	subject: { readonly table: ChannelSubject; readonly id: string },
	c: ChannelInput,
) =>
	Effect.gen(function* () {
		yield* assertAddressLooksRight(c.kind, c.value)
		// Saying nothing about the default is not the same as saying "not the
		// default": naming an address already on file — which is how somebody
		// labels one — must not quietly move where mail goes.
		const wantsPrimary = c.is_primary ?? null
		const rows = yield* sql`
			INSERT INTO channels
				(organization_id, subject_table, subject_id, channel, address, label, verification, confidence, is_primary)
			VALUES (
				${orgId}, ${subject.table}, ${subject.id}, ${foldKind(c.kind)}, ${c.value}, ${c.label ?? null},
				${c.verification ?? null}, ${clampConfidence(c.confidence)}, COALESCE(${wantsPrimary}, false)
			)
			ON CONFLICT (subject_table, subject_id, channel, address) DO UPDATE SET
				label = COALESCE(EXCLUDED.label, channels.label),
				is_primary = COALESCE(${wantsPrimary}, channels.is_primary),
				updated_at = now()
			RETURNING ${channelRowColumns(sql)}
		`
		const stored = rows[0] as { readonly id: string } | undefined
		if (c.is_primary === true && stored !== undefined) {
			yield* standDownOtherPrimaries(sql, stored.id)
		}
		return rows[0]
	})

/**
 * Edit one of a subject's channels — its address, kind, label, whether it is the
 * default, and how far its deliverability is trusted.
 *
 * The subject is part of the lookup, not something the caller is trusted to have
 * checked. An id on its own only proves a row exists, and every channel of every
 * company, branch and person lives in one table, so an unscoped edit would let a
 * request about one person reach somebody else's address — or a company's
 * switchboard. Answers `undefined` when the id is not this subject's, which reads
 * the same as "no such channel" and is what the caller reports.
 *
 * `verification` may only ever be lowered here (the type says which words), and
 * the score goes with it: it belonged to the verdict being replaced, and nobody
 * setting a verdict by hand has a score to offer. The suppression `status` stays
 * out of a caller's reach.
 */
export const patchChannel = (
	sql: Sql,
	orgId: string,
	subject: { readonly table: ChannelSubject; readonly id: string },
	channelId: string,
	patch: {
		readonly kind?: string | undefined
		readonly value?: string | undefined
		readonly label?: string | null | undefined
		readonly is_primary?: boolean | undefined
		/**
		 * A verdict to record, or null to say none was ever reached.
		 *
		 * Clearing is not the same as lowering. A word that was never a check —
		 * a guess somebody wrote down — is more honestly recorded as nothing than
		 * as a check that came back doubtful, and only a person looking at the
		 * address knows which it was. Leaving it out changes nothing.
		 */
		readonly verification?: HandSetVerificationVerdict | null | undefined
	},
) =>
	Effect.gen(function* () {
		const stored = (yield* sql<{
			channel: string
			address: string
			isPrimary: boolean
			status: string
		}>`
			SELECT channel, address, is_primary, status FROM channels
			WHERE id = ${channelId} AND subject_table = ${subject.table}
				AND subject_id = ${subject.id} AND organization_id = ${orgId}
			LIMIT 1
		`)[0]
		if (stored === undefined) return undefined

		// Folded once, here, and read everywhere below. Comparing the kind as it
		// arrived is how `Email` reads as *leaving* email — which strips the bounce
		// record off an address that never stopped being one, and hides it from the
		// send gate in the same call.
		const nextKind = patch.kind === undefined ? undefined : foldKind(patch.kind)

		// Changing one half says nothing about the other, so whichever half is not
		// being changed comes off the row. Checking only when the address moves
		// would let a phone number be relabelled an email and walk into the send
		// path, where no verdict reads as nothing known against it.
		if (nextKind !== undefined || patch.value !== undefined) {
			yield* assertAddressLooksRight(
				nextKind ?? stored.channel,
				patch.value ?? stored.address,
			)
		}

		const now = DateTime.toDateUtc(DateTime.nowUnsafe())
		const data: Record<string, unknown> = { updatedAt: now }
		if (nextKind !== undefined) data['channel'] = nextKind
		if (patch.value !== undefined) data['address'] = patch.value
		if (patch.label !== undefined) data['label'] = patch.label
		if (patch.is_primary !== undefined) data['isPrimary'] = patch.is_primary
		if (patch.verification !== undefined) {
			data['verification'] = patch.verification
			// The score belonged to the verdict being replaced, and neither a
			// hand-set one nor an empty one has a score of its own.
			data['confidence'] = null
		}
		// A row that stops being an email takes the email-only bookkeeping with it.
		// Left behind, a bounce recorded against the old address would go on
		// blocking mail while sitting on something that is no longer an address at
		// all, and no screen would show it.
		const leavingEmail =
			nextKind !== undefined &&
			stored.channel === 'email' &&
			nextKind !== 'email'
		if (leavingEmail) {
			data['verification'] = null
			data['confidence'] = null
			data['status'] = 'unknown'
			data['statusReason'] = null
			data['statusUpdatedAt'] = now
			data['softBounceCount'] = 0
		}
		// Somebody vouching stood behind one address, not behind this row for
		// good. Correcting the address is exactly the moment that stops being
		// true, and the send path reads a vouch by address across the whole
		// organisation — so carrying it over would quietly clear whatever a check
		// had found about the new address, wherever else it is on file.
		const addressChanged =
			patch.value !== undefined &&
			patch.value.trim().toLowerCase() !== stored.address.trim().toLowerCase()
		if (addressChanged && !leavingEmail && stored.status === 'valid') {
			data['status'] = 'unknown'
			data['statusReason'] = null
			data['statusUpdatedAt'] = now
		}

		// One address of a kind per subject, so renaming onto one already on file
		// is a collision rather than a merge. Wrapped in its own transaction: the
		// whole request runs inside one, and a rejected write poisons it until
		// something rolls back — this rolls back only as far as the attempt, so
		// the refusal can still be answered with the list it was asked about.
		const rows = yield* sql
			.withTransaction(
				sql`
					UPDATE channels SET ${sql.update(data)}
					WHERE id = ${channelId} RETURNING ${channelRowColumns(sql)}
				`,
			)
			.pipe(
				Effect.catchTag(
					'SqlError',
					(error): Effect.Effect<never, BadRequest | SqlError.SqlError> =>
						pgErrorCode(error) === '23505'
							? Effect.fail(
									new BadRequest({
										message: `"${patch.value ?? stored.address}" is already on file as a ${nextKind ?? stored.channel}. Remove the one you meant to replace rather than renaming onto it.`,
									}),
								)
							: Effect.fail(error),
				),
			)

		// A row carrying the default into another kind would leave two there and
		// none behind it.
		const kindChanged = nextKind !== undefined && nextKind !== stored.channel
		if (patch.is_primary === true || (kindChanged && stored.isPrimary)) {
			yield* standDownOtherPrimaries(sql, channelId)
		}
		// Wherever the default just left, somebody has to hold it. Both ways of
		// putting it down are the same problem: a kind with addresses and no
		// default is read differently by each screen that reads it.
		if (stored.isPrimary && (kindChanged || patch.is_primary === false)) {
			yield* electPrimaryIfNone(sql, orgId, subject, stored.channel)
		}
		if (patch.is_primary === false && kindChanged) {
			yield* electPrimaryIfNone(sql, orgId, subject, nextKind ?? stored.channel)
		}
		return rows[0]
	})

/**
 * Remove one of a subject's channels, scoped the same way an edit is. Answers
 * whether a row went, so a caller can tell a wrong id from a repeat.
 */
export const deleteChannel = (
	sql: Sql,
	orgId: string,
	subject: { readonly table: ChannelSubject; readonly id: string },
	channelId: string,
) =>
	Effect.gen(function* () {
		const removed = yield* sql<{ channel: string; isPrimary: boolean }>`
			DELETE FROM channels
			WHERE id = ${channelId} AND subject_table = ${subject.table}
				AND subject_id = ${subject.id} AND organization_id = ${orgId}
			RETURNING channel, is_primary
		`
		const gone = removed[0]
		if (gone === undefined) return false
		if (gone.isPrimary) {
			yield* electPrimaryIfNone(sql, orgId, subject, gone.channel)
		}
		return true
	})

/**
 * Remove every way of reaching one company, branch or person — for when the
 * subject itself is going.
 *
 * Nothing in the database does this on its own: a channel names its subject by a
 * pair of plain columns, because one key cannot point at two tables, so there is
 * no foreign key to cascade. Left behind, the rows outlive whoever they belonged
 * to and keep answering — a bounce recorded against one of them goes on blocking
 * that address for the whole organisation, with nobody left to lift it from.
 */
export const deleteSubjectChannels = (
	sql: Sql,
	orgId: string,
	subject: { readonly table: ChannelSubject; readonly id: string },
) =>
	sql`
		DELETE FROM channels
		WHERE subject_table = ${subject.table} AND subject_id = ${subject.id}
			AND organization_id = ${orgId}
	`

/** One address the organisation is holding back, and what it did. */
export interface SuppressedAddress {
	readonly address: string
	readonly status: 'bounced' | 'complained'
	readonly statusReason: string | null
	/** The person holding it, when one does — a company mailbox answers null. */
	readonly contactId: string | null
}

/**
 * Record that somebody stands behind an address, so an assistant stops asking
 * about it.
 *
 * A deliverability verdict is what a check found, and nobody at a keyboard can
 * obtain one — which is why a caller may only ever lower it. This is the other
 * half of that: a person who knows the address is good says so here, and it is
 * kept apart from the verdict rather than overwriting it. The check's finding
 * stays on file and stays true; what changes is whether it stops a send.
 *
 * Refused on an address that hard-bounced or reported spam. That state is the
 * one real block, and it is keyed on exactly the column this writes — so
 * vouching for such an address would not merely disagree with the bounce, it
 * would silently lift it for the whole organisation. Whoever wants that wants
 * `clearEmailSuppression`, which says so plainly and returns the address to
 * "nobody has checked" rather than to "somebody vouched".
 *
 * Answers what happened, so the caller can tell a refusal from a wrong id
 * rather than reporting a success nobody got.
 */
export const vouchForChannel = (
	sql: Sql,
	orgId: string,
	subject: { readonly table: ChannelSubject; readonly id: string },
	channelId: string,
	reason?: string | undefined,
): Effect.Effect<
	'vouched' | 'suppressed' | 'not_email' | 'not_found',
	SqlError.SqlError
> =>
	Effect.gen(function* () {
		const rows = yield* sql<{ channel: string; status: string }>`
			SELECT channel, status FROM channels
			WHERE id = ${channelId} AND subject_table = ${subject.table}
				AND subject_id = ${subject.id} AND organization_id = ${orgId}
			LIMIT 1
		`
		const stored = rows[0]
		if (stored === undefined) return 'not_found' as const
		// Only an email address is ever held back by a verdict, so vouching for a
		// phone number would write a state nothing reads.
		if (stored.channel !== 'email') return 'not_email' as const
		if (stored.status === 'bounced' || stored.status === 'complained')
			return 'suppressed' as const

		yield* sql`
			UPDATE channels
			SET status = 'valid',
			    status_reason = ${reason ?? null},
			    status_updated_at = now()
			WHERE id = ${channelId} AND organization_id = ${orgId}
				AND status NOT IN ('bounced', 'complained')
		`
		// The check above and this write are two statements, and a bounce landing
		// between them commits in that gap — so the condition is repeated here
		// rather than trusted from a moment ago. Without it the write would lift a
		// block that arrived while the request was in flight, for the whole
		// organisation, and overwrite the mail server's own reason with this note.
		const updated = yield* sql<{ status: string }>`
			SELECT status FROM channels WHERE id = ${channelId}
		`
		if (updated[0]?.status !== 'valid') return 'suppressed' as const
		return 'vouched' as const
	})

/**
 * Take back a vouch, returning the address to nobody having stood behind it.
 *
 * Somebody changing their mind is ordinary, and until this existed there was no
 * way back: a vouch is written to the same column a bounce uses, and the only
 * other thing that clears it is correcting the address itself. Left without a
 * door, the way out would have been to write a verdict nobody earned.
 *
 * Only ever lifts a vouch. A bounce sits in the same column and is not a thing
 * a caller may clear from here — that is `clearEmailSuppression`, which says so
 * — and an address nobody vouched for is left exactly as it is rather than
 * quietly stamped.
 */
export const withdrawVouch = (
	sql: Sql,
	orgId: string,
	subject: { readonly table: ChannelSubject; readonly id: string },
	channelId: string,
): Effect.Effect<
	'withdrawn' | 'not_vouched' | 'not_found',
	SqlError.SqlError
> =>
	Effect.gen(function* () {
		const rows = yield* sql<{ status: string }>`
			SELECT status FROM channels
			WHERE id = ${channelId} AND subject_table = ${subject.table}
				AND subject_id = ${subject.id} AND organization_id = ${orgId}
			LIMIT 1
		`
		const stored = rows[0]
		if (stored === undefined) return 'not_found' as const
		if (stored.status !== 'valid') return 'not_vouched' as const
		yield* sql`
			UPDATE channels
			SET status = 'unknown', status_reason = NULL, status_updated_at = now()
			WHERE id = ${channelId} AND organization_id = ${orgId}
				AND status = 'valid'
		`
		return 'withdrawn' as const
	})

/**
 * Which of these addresses the organisation is holding mail back from.
 *
 * Keyed on the address and the organisation, never on a subject: an address that
 * bounced is the same address whichever record happens to hold it. Asking by
 * subject instead walks past company mailboxes, second addresses, and anything
 * typed in by hand.
 */
export const suppressedAmong = (
	sql: Sql,
	orgId: string,
	addresses: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<SuppressedAddress>, SqlError.SqlError> =>
	Effect.gen(function* () {
		const normalised = [
			...new Set(
				addresses
					.map(address => address.trim().toLowerCase())
					.filter(address => address !== ''),
			),
		]
		if (normalised.length === 0) return []

		// One row per address, not per record holding it: a bounce is recorded
		// against every record with that address, so a mailbox two people are
		// listed under would otherwise answer twice and read as two problems. The
		// most recently updated record is the one that answers.
		const rows = yield* sql<SuppressedAddress>`
			SELECT DISTINCT ON (lower(address))
				lower(address) AS address, status, status_reason,
				CASE WHEN subject_table = 'contacts' THEN subject_id END AS contact_id
			FROM channels
			WHERE organization_id = ${orgId}
				AND channel = 'email'
				AND lower(address) = ANY(${normalised})
				AND status IN ('bounced', 'complained')
			ORDER BY lower(address), status_updated_at DESC NULLS LAST
		`
		return rows
	})

/**
 * Let mail go to one company's, branch's or person's addresses again, after a
 * bounce or a complaint turns out to have been a false alarm.
 *
 * Clears one subject's rows, which is narrower than the block it lifts: the send
 * gate asks whether an address has bounced anywhere in the organisation, and a
 * bounce is recorded against every record holding it. So an address two people
 * are both listed under stays blocked until both are cleared.
 */
export const clearEmailSuppression = (
	sql: Sql,
	subject: { readonly table: ChannelSubject; readonly id: string },
) =>
	sql`
		UPDATE channels
		SET status = 'unknown',
		    status_reason = NULL,
		    status_updated_at = now(),
		    soft_bounce_count = 0
		WHERE subject_table = ${subject.table}
			AND subject_id = ${subject.id}
			AND channel = 'email'
	`
