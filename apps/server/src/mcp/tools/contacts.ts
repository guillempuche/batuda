import { DateTime, Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg } from '@batuda/controllers'

import {
	channelsOf,
	clearEmailSuppression,
	writeChannels,
} from '../../services/contact-channels'

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
		'Create a contact linked to a company. Role examples: CEO, CTO, Marketing Director, Sales Manager. Pass channels[] for every reachable address (kind: email | phone | linkedin | x | website | bluesky | …); the primary email channel is the address used for sending.',
	parameters: Schema.Struct({
		company_id: Schema.String,
		name: Schema.String,
		role: Schema.optional(Schema.String),
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
		'Update one or more fields on an existing contact by UUID. Only include fields to change. Pass channels[] to add/refresh reachable addresses. Set clear_email_suppression=true to reset the email channel to "unknown" (use after a bounced/complained contact confirms their address is good again — this re-enables outbound mail to that address).',
	parameters: Schema.Struct({
		id: Schema.String,
		name: Schema.optional(Schema.String),
		role: Schema.optional(Schema.String),
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

export const ContactHandlersLive = ContactTools.toLayer(
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient

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
					const rows = yield* sql`INSERT INTO contacts ${sql.insert({
						organizationId: currentOrg.id,
						companyId: company_id,
						...fields,
					})} RETURNING *`
					const contact = rows[0] as { id: string }
					if (channels && channels.length > 0) {
						yield* writeChannels(sql, currentOrg.id, contact.id, channels)
					}
					const ch = yield* channelsOf(sql, contact.id)
					return { ...rows[0], channels: ch }
				}).pipe(Effect.orDie),

			update_contact: ({ id, channels, clear_email_suppression, ...fields }) =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const rows = yield* sql`UPDATE contacts SET ${sql.update({
						...fields,
						updatedAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
					})} WHERE id = ${id} RETURNING *`
					if (clear_email_suppression) yield* clearEmailSuppression(sql, id)
					if (channels && channels.length > 0) {
						yield* writeChannels(sql, currentOrg.id, id, channels)
					}
					const ch = yield* channelsOf(sql, id)
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
