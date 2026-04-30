import { Data, Effect, Layer, ServiceMap } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg } from '@batuda/controllers'

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

export class ParticipantMatcher extends ServiceMap.Service<ParticipantMatcher>()(
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
							SELECT id, company_id FROM contacts
							WHERE lower(email) = ${email}
							  AND organization_id = ${currentOrg.id}
							ORDER BY updated_at DESC
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

						const inserted = yield* sql<{ id: string }>`
							INSERT INTO contacts ${sql.insert({
								organizationId: currentOrg.id,
								companyId,
								email,
								name: args.displayName ?? email,
								role: null,
								isDecisionMaker: null,
								phone: null,
								whatsapp: null,
								linkedin: null,
								instagram: null,
								emailStatus: 'unknown',
								emailStatusReason: null,
								emailStatusUpdatedAt: null,
								emailSoftBounceCount: 0,
								notes: null,
								metadata: null,
							})} RETURNING id
						`
						const [createdContact] = inserted
						if (!createdContact) {
							return yield* Effect.die(
								new Error('INSERT INTO contacts RETURNING id yielded no row'),
							)
						}
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
