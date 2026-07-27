import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { seedCalendar } from './seed/calendar'
import {
	seedCompanies,
	seedContacts,
	seedInteractions,
	seedProducts,
	seedTasks,
} from './seed/crm'
import { seedDocuments } from './seed/documents'
import { seedDemoEmails } from './seed/emails'
import { seedInboxes } from './seed/inboxes'
import { linkRunProvenance, seedInstructions } from './seed/instructions'
import { seedMcpOAuth } from './seed/mcp-oauth'
import { seedPages } from './seed/pages'
import { seedPersonaActivity } from './seed/personas'
import { pinTimestamps } from './seed/pin-timestamps'
import { seedProposals } from './seed/proposals'
import { seedRecordings } from './seed/recordings'
import { seedResearchPolicy, seedResearchRuns } from './seed/research'
import { seedReset } from './seed/reset'
import type { Preset, SeedCtx, StampFn } from './seed/shared'

export {
	DEMO_MEMBERSHIPS,
	DEMO_ORGS,
	DEMO_USERS,
	TEST_USER,
} from './seed/fixtures'
export { seedIdentities } from './seed/identities'
export { seedReset } from './seed/reset'
export { PRESETS, type Preset } from './seed/shared'

// One transaction so a partial seed rolls back; S3 uploads use deterministic keys and overwrite on retry.
export const seed = (preset: Preset) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient

		return yield* sql.withTransaction(
			Effect.gen(function* () {
				yield* seedReset

				const tallerOrgRows = yield* sql<{ id: string }>`
					SELECT id FROM "organization" WHERE slug = 'taller' LIMIT 1
				`
				const tallerOrgId = tallerOrgRows[0]?.id
				if (!tallerOrgId) {
					return yield* Effect.fail(
						new Error(
							'CRM seed requires the taller demo org. Run `pnpm cli seed` (which seeds identities before CRM data) or `pnpm cli db reset && pnpm cli seed` for a clean slate.',
						),
					)
				}

				const restaurantOrgRows = yield* sql<{ id: string }>`
					SELECT id FROM "organization" WHERE slug = 'restaurant' LIMIT 1
				`
				const restaurantOrgId = restaurantOrgRows[0]?.id ?? null

				const stamp: StampFn = rows =>
					rows.map(r => ({ ...r, organizationId: tallerOrgId }))

				const ctx: SeedCtx = {
					sql,
					preset,
					tallerOrgId,
					restaurantOrgId,
					stamp,
				}

				// Counted from the database rather than hardcoded, so the summary
				// can never drift from what was actually inserted.
				const tally = (table: string) =>
					Effect.map(
						sql<{
							n: string
						}>`SELECT count(*)::text AS n FROM ${sql.literal(table)}`,
						rows => Number(rows[0]?.n ?? 0),
					)

				const insertedProducts = yield* seedProducts(ctx)
				const {
					insertedCompanies,
					companyMap,
					generated,
					restaurantGenerated,
					restaurantCompanyMap,
				} = yield* seedCompanies(
					ctx,
					insertedProducts.map(p => p.slug),
				)
				const { insertedContacts, contactMap } = yield* seedContacts(
					ctx,
					companyMap,
					{ generated, restaurantGenerated, restaurantCompanyMap },
				)
				const { insertedInteractions, dataWithContacts } =
					yield* seedInteractions(ctx, companyMap, contactMap)
				const insertedTasks = yield* seedTasks(ctx, dataWithContacts)
				const insertedEvents = yield* seedCalendar(
					ctx,
					companyMap,
					insertedTasks,
				)
				const testUser = yield* seedResearchPolicy(ctx)
				const seededInboxes = yield* seedInboxes(ctx)
				yield* seedDemoEmails(sql, seededInboxes)
				const instructionTemplateIds = yield* seedInstructions(ctx)
				yield* seedMcpOAuth(ctx)

				if (preset === 'full') {
					// Documents run after proposals so they can be filed against one;
					// every other record they reach already exists by here.
					const insertedProposals = yield* seedProposals(
						ctx,
						companyMap,
						contactMap,
						insertedProducts,
					)
					yield* seedDocuments(ctx, {
						companies: companyMap,
						contacts: contactMap,
						tasks: new Map(insertedTasks.map(t => [t.title, t.id])),
						proposals: new Map(insertedProposals.map(p => [p.title, p.id])),
						calendar_events: new Map(insertedEvents.map(e => [e.title, e.id])),
					})
					yield* seedPages(ctx, companyMap)
					yield* seedResearchRuns(ctx, testUser, companyMap)
					yield* seedRecordings(ctx, companyMap)
					yield* linkRunProvenance(ctx, instructionTemplateIds)
				}

				// Pinned before the persona pass because that pass copies task and
				// proposal timestamps into the activity feed — reading them while
				// they still held the database clock is what made the feed differ
				// between runs.
				yield* pinTimestamps(ctx)

				yield* seedPersonaActivity(ctx)

				// Again for the rows the persona pass inserted — scoped to the one
				// table it writes to, rather than walking the whole schema twice.
				yield* pinTimestamps(ctx, ['timeline_activity'])

				const counts = {
					products: insertedProducts.length,
					instructionTemplates: instructionTemplateIds.size,
					companies: insertedCompanies.length,
					contacts: insertedContacts.length,
					interactions: insertedInteractions.length,
					tasks: insertedTasks.length,
					researchPolicy: testUser ? 1 : 0,
					documents: yield* tally('documents'),
					proposals: yield* tally('proposals'),
					pages: yield* tally('pages'),
					emailThreads: yield* tally('email_thread_links'),
					emailMessages: yield* tally('email_messages'),
					researchRuns: yield* tally('research_runs'),
					sources: yield* tally('sources'),
					callRecordings: yield* tally('call_recordings'),
				}

				yield* Effect.logInfo('Seed complete!')
				yield* Effect.logInfo('')
				yield* Effect.logInfo(
					'⚠ If you were already signed in to https://batuda.localhost, sign out and back in.',
				)
				yield* Effect.logInfo(
					'  The reset replaced every auth row, so existing sessions point at organization ids that no longer exist',
				)
				yield* Effect.logInfo(
					'  and /emails will render "No active organization on this session" until the cookie refreshes.',
				)
				return counts
			}),
		)
	})
