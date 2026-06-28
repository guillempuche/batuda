import { DateTime, Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg } from '@batuda/controllers'

// One reachable channel. `kind` is open (email, phone, linkedin, x, website,
// bluesky, …); only the email channel carries a deliverability `verification`.
const ChannelInput = Schema.Struct({
	kind: Schema.String,
	value: Schema.String,
	verification: Schema.optional(Schema.String),
	confidence: Schema.optional(Schema.Number),
	is_primary: Schema.optional(Schema.Boolean),
})

const ListContacts = Tool.make('list_contacts', {
	description: 'List contacts for a company, each with its channels.',
	parameters: Schema.Struct({
		company_id: Schema.String,
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'List Contacts')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const CreateContact = Tool.make('create_contact', {
	description:
		'Create a contact linked to a company. Role examples: CEO, CTO, Marketing Director, Sales Manager. Pass channels[] for any reachable address (kind: email | phone | linkedin | x | website | bluesky | …); the primary email also populates the canonical email used for sending.',
	parameters: Schema.Struct({
		company_id: Schema.String,
		name: Schema.String,
		role: Schema.optional(Schema.String),
		email: Schema.optional(Schema.String),
		phone: Schema.optional(Schema.String),
		linkedin: Schema.optional(Schema.String),
		notes: Schema.optional(Schema.String),
		channels: Schema.optional(Schema.Array(ChannelInput)),
	}),
	success: Schema.Unknown,
	dependencies: [CurrentOrg],
})
	.annotate(Tool.Title, 'Create Contact')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const UpdateContact = Tool.make('update_contact', {
	description:
		'Update one or more fields on an existing contact by UUID. Only include fields to change. Pass channels[] to add/refresh reachable addresses. Set clear_email_suppression=true to reset email_status to "unknown" (use after a bounced/complained contact confirms their address is good again — this re-enables outbound mail to that address).',
	parameters: Schema.Struct({
		id: Schema.String,
		name: Schema.optional(Schema.String),
		role: Schema.optional(Schema.String),
		email: Schema.optional(Schema.String),
		phone: Schema.optional(Schema.String),
		linkedin: Schema.optional(Schema.String),
		notes: Schema.optional(Schema.String),
		channels: Schema.optional(Schema.Array(ChannelInput)),
		clear_email_suppression: Schema.optional(Schema.Boolean),
	}),
	success: Schema.Unknown,
	dependencies: [CurrentOrg],
})
	.annotate(Tool.Title, 'Update Contact')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

const DeleteContact = Tool.make('delete_contact', {
	description:
		'Permanently delete a contact by UUID. Cascade-detaches the contact from interactions / proposals / threads via ON DELETE SET NULL — those rows survive with contact_id=NULL. Channels are removed with the contact.',
	parameters: Schema.Struct({
		id: Schema.String,
	}),
	success: Schema.Struct({
		status: Schema.Literal('deleted'),
	}),
})
	.annotate(Tool.Title, 'Delete Contact')
	.annotate(Tool.Destructive, true)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

export const ContactTools = Toolkit.make(
	ListContacts,
	CreateContact,
	UpdateContact,
	DeleteContact,
)

type ChannelInputT = typeof ChannelInput.Type

/**
 * The canonical send address for a contact: an explicit `email` field wins,
 * else the primary email channel, else the first email channel, else none.
 * `contacts.email` is what the outbound path reads, so this picks one address
 * deterministically from whatever the caller supplied.
 */
export const primaryEmailFrom = (
	email: string | undefined,
	channels: ReadonlyArray<ChannelInputT> | undefined,
): string | undefined =>
	email ??
	channels?.find(c => c.kind === 'email' && c.is_primary)?.value ??
	channels?.find(c => c.kind === 'email')?.value

export const ContactHandlersLive = ContactTools.toLayer(
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient

		// Upsert channels for a contact, mirroring the canonical email as a
		// channel so a uniform `channels` list always includes it.
		const writeChannels = (
			orgId: string,
			contactId: string,
			channels: ReadonlyArray<ChannelInputT>,
			canonicalEmail: string | undefined,
		) =>
			Effect.gen(function* () {
				const channelsToWrite = [...channels]
				if (
					canonicalEmail &&
					!channelsToWrite.some(
						c => c.kind === 'email' && c.value === canonicalEmail,
					)
				) {
					channelsToWrite.push({
						kind: 'email',
						value: canonicalEmail,
						is_primary: true,
					})
				}
				for (const c of channelsToWrite) {
					yield* sql`
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
					`
				}
			})

		const channelsOf = (contactId: string) =>
			sql`SELECT * FROM contact_channels WHERE contact_id = ${contactId} ORDER BY is_primary DESC, kind`

		return {
			list_contacts: ({ company_id }) =>
				sql`
					SELECT c.*, COALESCE(
						(SELECT json_agg(ch ORDER BY ch.is_primary DESC, ch.kind)
						 FROM contact_channels ch WHERE ch.contact_id = c.id),
						'[]'::json
					) AS channels
					FROM contacts c
					WHERE c.company_id = ${company_id}
					ORDER BY c.name
				`.pipe(Effect.orDie),

			create_contact: ({ company_id, channels, ...fields }) =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const email = primaryEmailFrom(fields.email, channels)
					const rows = yield* sql`INSERT INTO contacts ${sql.insert({
						organizationId: currentOrg.id,
						companyId: company_id,
						...fields,
						...(email !== undefined ? { email } : {}),
					})} RETURNING *`
					const contact = rows[0] as { id: string }
					if (channels && channels.length > 0) {
						yield* writeChannels(currentOrg.id, contact.id, channels, email)
					}
					const ch = yield* channelsOf(contact.id)
					return { ...rows[0], channels: ch }
				}).pipe(Effect.orDie),

			update_contact: ({ id, channels, clear_email_suppression, ...fields }) =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const email = primaryEmailFrom(fields.email, channels)
					const data: Record<string, unknown> = {
						...fields,
						...(email !== undefined ? { email } : {}),
						updatedAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
					}
					if (clear_email_suppression) {
						data['emailStatus'] = 'unknown'
						data['emailStatusReason'] = null
						data['emailStatusUpdatedAt'] = DateTime.toDateUtc(
							DateTime.nowUnsafe(),
						)
						data['emailSoftBounceCount'] = 0
					}
					const rows =
						yield* sql`UPDATE contacts SET ${sql.update(data, ['id'])} WHERE id = ${id} RETURNING *`
					if (channels && channels.length > 0) {
						yield* writeChannels(currentOrg.id, id, channels, email)
					}
					const ch = yield* channelsOf(id)
					return { ...rows[0], channels: ch }
				}).pipe(Effect.orDie),

			delete_contact: ({ id }) =>
				Effect.gen(function* () {
					yield* sql`DELETE FROM contacts WHERE id = ${id}`
					return { status: 'deleted' as const }
				}).pipe(Effect.orDie),
		}
	}),
)
