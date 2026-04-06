import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

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
})
	.annotate(Tool.Title, 'Create Contact')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const UpdateContact = Tool.make('update_contact', {
	description:
		'Update one or more fields on an existing contact by UUID. Only include fields to change.',
	parameters: Schema.Struct({
		id: Schema.String,
		name: Schema.optional(Schema.String),
		role: Schema.optional(Schema.String),
		email: Schema.optional(Schema.String),
		phone: Schema.optional(Schema.String),
		linkedin: Schema.optional(Schema.String),
		notes: Schema.optional(Schema.String),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Update Contact')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

export const ContactTools = Toolkit.make(
	ListContacts,
	CreateContact,
	UpdateContact,
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
					const rows = yield* sql`INSERT INTO contacts ${sql.insert({
						companyId: company_id,
						...fields,
					})} RETURNING *`
					return rows[0]
				}).pipe(Effect.orDie),
			update_contact: ({ id, ...fields }) =>
				Effect.gen(function* () {
					const data: Record<string, unknown> = {
						...fields,
						updatedAt: new Date(),
					}
					const rows =
						yield* sql`UPDATE contacts SET ${sql.update(data, ['id'])} WHERE id = ${id} RETURNING *`
					return rows[0]
				}).pipe(Effect.orDie),
		}
	}),
)
