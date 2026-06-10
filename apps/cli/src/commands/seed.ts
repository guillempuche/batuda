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
import { seedPages } from './seed/pages'
import { seedPersonaActivity } from './seed/personas'
import { seedProposals } from './seed/proposals'
import { seedRecordings } from './seed/recordings'
import {
	seedProviderQuotas,
	seedResearchPolicy,
	seedResearchRuns,
} from './seed/research'
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

				const insertedProducts = yield* seedProducts(ctx)
				const { insertedCompanies, companyMap } = yield* seedCompanies(ctx)
				const { insertedContacts, contactMap } = yield* seedContacts(
					ctx,
					companyMap,
				)
				const { insertedInteractions, dataWithContacts } =
					yield* seedInteractions(ctx, companyMap, contactMap)
				const insertedTasks = yield* seedTasks(ctx, dataWithContacts)
				yield* seedCalendar(ctx, companyMap, insertedTasks)
				const testUser = yield* seedResearchPolicy(ctx)
				const seededInboxes = yield* seedInboxes(ctx)
				yield* seedDemoEmails(sql, seededInboxes)
				const instructionTemplateIds = yield* seedInstructions(ctx)

				if (preset === 'full') {
					yield* seedDocuments(ctx, companyMap, insertedInteractions)
					yield* seedProposals(ctx, companyMap, contactMap, insertedProducts)
					yield* seedPages(ctx, companyMap)
					yield* seedResearchRuns(ctx, testUser, companyMap)
					yield* seedProviderQuotas(ctx, testUser)
					yield* seedRecordings(ctx, companyMap)
					yield* linkRunProvenance(ctx, instructionTemplateIds)
				}

				yield* seedPersonaActivity(ctx)

				const counts = {
					products: insertedProducts.length,
					instructionTemplates: instructionTemplateIds.size,
					companies: insertedCompanies.length,
					contacts: insertedContacts.length,
					interactions: insertedInteractions.length,
					tasks: insertedTasks.length,
					researchPolicy: testUser ? 1 : 0,
					documents: preset === 'full' ? 6 : 0,
					proposals: preset === 'full' ? 7 : 0,
					pages: preset === 'full' ? 14 : 0,
					emailThreads: preset === 'full' ? 12 : 0,
					emailMessages: preset === 'full' ? 16 : 0,
					researchRuns: preset === 'full' ? 73 : 0,
					sources: preset === 'full' ? 8 : 0,
					callRecordings: preset === 'full' ? 6 : 0,
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
