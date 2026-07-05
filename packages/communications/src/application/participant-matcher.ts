import { Data, Effect, Layer, ServiceMap } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg } from '@batuda/domain'

import type { Channel } from '../domain/channel'

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
	readonly channel: Channel
	readonly address: string
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
	readonly channel: Channel
	readonly address: string
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
						const address = args.address.trim().toLowerCase()

						const contacts = yield* sql<{
							id: string
							companyId: string
						}>`
							SELECT c.id, c.company_id FROM contact_channels ch
							JOIN contacts c ON c.id = ch.contact_id
							WHERE ch.channel = ${args.channel}
							  AND lower(ch.address) = ${address}
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

						// Company fallback matches on the email domain; only the email
						// channel carries an @-domain, so a non-email address with no
						// contact hit resolves to NoMatch here.
						const domain = address.split('@')[1]
						if (!domain) return new NoMatch({ channel: args.channel, address })

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
						if (!company) return new NoMatch({ channel: args.channel, address })
						const companyId = company.id

						if (args.createPolicy === 'never') {
							return new MatchedCompanyOnly({ companyId })
						}

						const inserted = yield* sql<{ id: string }>`
							INSERT INTO contacts ${sql.insert({
								organizationId: currentOrg.id,
								companyId,
								name: args.displayName ?? address,
								role: null,
								isDecisionMaker: null,
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
						// The inbound sender's address becomes the contact's primary
						// channel handle, so a later reply matches it back.
						yield* sql`
							INSERT INTO contact_channels
								(organization_id, contact_id, channel, address, is_primary)
							VALUES (${currentOrg.id}, ${createdContact.id}, ${args.channel}, ${address}, true)
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
