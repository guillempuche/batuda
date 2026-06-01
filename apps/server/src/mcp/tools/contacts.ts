import { DateTime, Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg } from '@batuda/controllers'

const ListContacts = Tool.make('list_contacts', {
	description: 'List contacts for a company.',
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
		'Create a contact linked to a company. Role examples: CEO, CTO, Marketing Director, Sales Manager.',
	parameters: Schema.Struct({
		company_id: Schema.String,
		name: Schema.String,
		role: Schema.optional(Schema.String),
		email: Schema.optional(Schema.String),
		phone: Schema.optional(Schema.String),
		linkedin: Schema.optional(Schema.String),
		notes: Schema.optional(Schema.String),
	}),
	success: Schema.Unknown,
	dependencies: [CurrentOrg],
})
	.annotate(Tool.Title, 'Create Contact')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const UpdateContact = Tool.make('update_contact', {
	description:
		'Update one or more fields on an existing contact by UUID. Only include fields to change. Set clear_email_suppression=true to reset email_status to "unknown" (use after a bounced/complained contact confirms their address is good again — this re-enables outbound mail to that address).',
	parameters: Schema.Struct({
		id: Schema.String,
		name: Schema.optional(Schema.String),
		role: Schema.optional(Schema.String),
		email: Schema.optional(Schema.String),
		phone: Schema.optional(Schema.String),
		linkedin: Schema.optional(Schema.String),
		notes: Schema.optional(Schema.String),
		clear_email_suppression: Schema.optional(Schema.Boolean),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Update Contact')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

const DeleteContact = Tool.make('delete_contact', {
	description:
		'Permanently delete a contact by UUID. Cascade-detaches the contact from interactions / proposals / threads via ON DELETE SET NULL — those rows survive with contact_id=NULL.',
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
				sql`SELECT * FROM contacts WHERE company_id = ${company_id} ORDER BY name`.pipe(
					Effect.orDie,
				),
			create_contact: ({ company_id, ...fields }) =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const rows = yield* sql`INSERT INTO contacts ${sql.insert({
						organizationId: currentOrg.id,
						companyId: company_id,
						...fields,
					})} RETURNING *`
					return rows[0]
				}).pipe(Effect.orDie),
			update_contact: ({ id, clear_email_suppression, ...fields }) =>
				Effect.gen(function* () {
					const data: Record<string, unknown> = {
						...fields,
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
					return rows[0]
				}).pipe(Effect.orDie),
			delete_contact: ({ id }) =>
				Effect.gen(function* () {
					yield* sql`DELETE FROM contacts WHERE id = ${id}`
					return { status: 'deleted' as const }
				}).pipe(Effect.orDie),
		}
	}),
)
