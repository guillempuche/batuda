import { Effect, Schema } from 'effect'
import { McpSchema, McpServer, Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg, SessionContext } from '@batuda/controllers'
import {
	ContactDiscovery,
	estimateDiscoverCostCents,
	resolvePolicy,
	type SystemDefaults,
} from '@batuda/research'

import { EnvVars } from '../../lib/env'
import { detachFromTransaction } from '../../middleware/org'
import { redactDbErrors } from './_research-shared'

// ── discover_contacts ──

const DiscoverContacts = Tool.make('discover_contacts', {
	description:
		'Find verified decision-maker email contacts for a company. Returns ranked candidates, each with a deliverability verdict (email_verification) and is_decision_maker flag — or an explicit no_reliable_contact result, never an unverified blast list. Result is one of: {status:"ok", contacts:[...]}, {status:"no_reliable_contact"}, {status:"budget_exceeded"}, or {status:"cancelled"}. Paid lookups are metered against the research budget; spend above the auto-approve threshold asks for confirmation first.',
	parameters: Schema.Struct({
		company_name: Schema.String,
		domain: Schema.String.annotate({
			description: 'Company web domain, e.g. "acme.com" (no scheme, no @).',
		}),
		country: Schema.optional(Schema.String).annotate({
			description: 'ISO-3166 country hint for enrichment (optional).',
		}),
	}),
	success: Schema.Unknown,
	dependencies: [SessionContext, CurrentOrg, McpSchema.McpServerClient],
})
	.annotate(Tool.Title, 'Discover Contacts')
	.annotate(Tool.Readonly, false)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

export const ResearchContactsTools = Toolkit.make(DiscoverContacts)

export const ResearchContactsHandlersLive = ResearchContactsTools.toLayer(
	Effect.gen(function* () {
		const contactDiscovery = yield* ContactDiscovery
		const sql = yield* SqlClient.SqlClient
		const env = yield* EnvVars

		const systemDefaults: SystemDefaults = {
			budgetCents: env.RESEARCH_DEFAULT_BUDGET_CENTS,
			paidBudgetCents: env.RESEARCH_DEFAULT_PAID_BUDGET_CENTS,
			autoApprovePaidCents: env.RESEARCH_DEFAULT_AUTO_APPROVE_PAID_CENTS,
			paidMonthlyCapCents: env.RESEARCH_DEFAULT_PAID_MONTHLY_CAP_CENTS,
			hardCeiling: env.RESEARCH_MONTHLY_CAP_HARD_CEILING_CENTS,
		}

		return {
			discover_contacts: params =>
				Effect.gen(function* () {
					const userId = (yield* SessionContext).userId
					const orgId = (yield* CurrentOrg).id

					// Confirm before spending above the caller's auto-approve limit.
					const policy = yield* resolvePolicy({ sql, userId, systemDefaults })
					if (estimateDiscoverCostCents > policy.autoApprovePaidCents) {
						const { confirm } = yield* McpServer.elicit({
							message: `Discovering decision-maker contacts for ${params.company_name} (${params.domain}) may spend up to ~${estimateDiscoverCostCents}¢ on paid lookups, above your auto-approve limit of ${policy.autoApprovePaidCents}¢. Proceed?`,
							schema: Schema.Struct({
								confirm: Schema.Literals(['yes', 'no']),
							}),
						}).pipe(
							Effect.catchTag('ElicitationDeclined', () =>
								Effect.succeed({ confirm: 'no' as const }),
							),
						)
						if (confirm === 'no') return { status: 'cancelled' as const }
					}

					// Run outside the request's own database transaction. Discovery
					// buys data from outside vendors, and each purchase is recorded as
					// it happens: kept inside the request, those records would be
					// thrown away if the request later failed, while the vendors had
					// already charged for the calls — and the month's spending would
					// forget money that was really spent. Several purchases also run at
					// once, and only a transaction of their own keeps each one's record
					// separate and the monthly limit honest.
					return yield* contactDiscovery
						.discover({
							companyName: params.company_name,
							domain: params.domain,
							country: params.country,
							userId,
							organizationId: orgId,
							systemDefaults,
						})
						.pipe(detachFromTransaction(sql))
				}).pipe(redactDbErrors),
		}
	}),
)
