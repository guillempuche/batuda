import { Context, Data, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg, isRoleAddress } from '@batuda/domain'

export class MatchedContact extends Data.TaggedClass('MatchedContact')<{
	readonly contactId: string
	readonly companyId: string
}> {}

export class MatchedCompanyOnly extends Data.TaggedClass('MatchedCompanyOnly')<{
	readonly companyId: string
}> {}

export class CreatedContact extends Data.TaggedClass('CreatedContact')<{
	readonly contactId: string
	readonly companyId: string
}> {}

export class CreatedBoth extends Data.TaggedClass('CreatedBoth')<{
	readonly contactId: string
	readonly companyId: string
}> {}

export class Ambiguous extends Data.TaggedClass('Ambiguous')<{
	readonly candidates: ReadonlyArray<{
		readonly contactId: string
		readonly companyId: string
	}>
}> {}

export class NoMatch extends Data.TaggedClass('NoMatch')<{
	readonly email: string
}> {}

export type ParticipantMatch =
	| MatchedContact
	| MatchedCompanyOnly
	| CreatedContact
	| CreatedBoth
	| Ambiguous
	| NoMatch

export type CreatePolicy = 'never' | 'contact-only' | 'both'

export interface MatchArgs {
	readonly email: string
	readonly displayName?: string | undefined
	readonly createPolicy: CreatePolicy
}

export class ParticipantMatcher extends Context.Service<ParticipantMatcher>()(
	'ParticipantMatcher',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient

			return {
				match: (
					args: MatchArgs,
				): Effect.Effect<ParticipantMatch, never, CurrentOrg> =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const email = args.email.trim().toLowerCase()

						const contacts = yield* sql<{
							id: string
							companyId: string
						}>`
							SELECT c.id, c.company_id FROM channels ch
							JOIN contacts c ON c.id = ch.subject_id
							WHERE ch.subject_table = 'contacts'
							  AND ch.channel = 'email'
							  AND lower(ch.address) = ${email}
							  AND ch.organization_id = ${currentOrg.id}
							ORDER BY c.updated_at DESC
						`
						const [firstContact, secondContact] = contacts
						if (firstContact && !secondContact) {
							return new MatchedContact({
								contactId: firstContact.id,
								companyId: firstContact.companyId,
							})
						}
						if (firstContact && secondContact) {
							return new Ambiguous({
								candidates: contacts.map(c => ({
									contactId: c.id,
									companyId: c.companyId,
								})),
							})
						}

						const domain = email.split('@')[1]
						if (!domain) return new NoMatch({ email })

						const companies = yield* sql<{ id: string }>`
							SELECT id FROM companies
							WHERE organization_id = ${currentOrg.id}
								AND (
									lower(email) LIKE ${`%@${domain}`}
									OR lower(website) LIKE ${`%${domain}%`}
								)
							ORDER BY updated_at DESC
							LIMIT 1
						`
						const [company] = companies
						if (!company) return new NoMatch({ email })
						const companyId = company.id

						if (args.createPolicy === 'never') {
							return new MatchedCompanyOnly({ companyId })
						}

						// A shared mailbox — info@, hola@, sales@ — is answered by
						// whoever is on duty, so there is no person here to record.
						// Making one invents somebody who does not exist: a contact
						// named after an address, who can then be assigned a task or
						// greeted by name in a template. The address is real and worth
						// keeping, so it goes on the company, where the next reply and
						// the send gate both find it.
						if (isRoleAddress(email)) {
							yield* sql`
								INSERT INTO channels
									(organization_id, subject_table, subject_id, channel, address)
								VALUES (${currentOrg.id}, 'companies', ${companyId}, 'email', ${email})
								ON CONFLICT (subject_table, subject_id, channel, address) DO NOTHING
							`
							return new MatchedCompanyOnly({ companyId })
						}

						// No `notes` here: a person's notes became filed documents, and the
						// column went with them. Naming it made every one of these
						// inserts fail, which took calendar ingest down for any attendee
						// not already on file — the exact case this branch exists for.
						const inserted = yield* sql<{ id: string }>`
							INSERT INTO contacts ${sql.insert({
								organizationId: currentOrg.id,
								companyId,
								name: args.displayName ?? email,
								role: null,
								isDecisionMaker: null,
								metadata: null,
							})} RETURNING id
						`
						const [createdContact] = inserted
						if (!createdContact) {
							return yield* Effect.die(
								new Error('INSERT INTO contacts RETURNING id yielded no row'),
							)
						}
						// The inbound sender address becomes the contact's primary
						// email channel, so a later reply matches it back.
						yield* sql`
							INSERT INTO channels
								(organization_id, subject_table, subject_id, channel, address, is_primary)
							VALUES (${currentOrg.id}, 'contacts', ${createdContact.id}, 'email', ${email}, true)
						`
						return new CreatedContact({
							contactId: createdContact.id,
							companyId,
						})
					}).pipe(Effect.orDie),
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
