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
import { canElicit } from './_elicit'
import { redactDbErrors } from './_research-shared'

// ── discover_contacts ──

const DiscoverContacts = Tool.make('discover_contacts', {
	description:
		'Find decision-maker contacts for a company. Returns ranked candidates, each with a buying_role saying what part they play in a purchase (economic_buyer holds the budget, champion argues for it inside, gatekeeper controls access, technical_evaluator judges whether it works, user lives with it; null when the title does not say) and, where an address was found, a deliverability verdict (email_verification) — or an explicit no_reliable_contact result, never an unverified blast list. Pass domain:null for a company with no website at all (a market stall, a family workshop, a jobbing builder): no address can be guessed and no enrichment vendor is paid, so what comes back is names and job titles from the national registry, which is still worth having — say plainly that those people have no address rather than implying one. Result is one of: {status:"ok", contacts:[...]}, {status:"no_reliable_contact"}, {status:"budget_exceeded"}, {status:"cancelled"} (somebody was asked to approve the spending and said no), or {status:"confirmation_required"} (the spending needs approval and this client has no way to ask for it — the result carries the estimate, the current limit and what to do about it; relay that instead of retrying, since retrying gives the same answer). An "ok" result may also carry verificationStopped:"monthly_cap_reached", meaning the organization spent its monthly research budget partway through: the contacts are real, but any email_verification of "unknown" was left unchecked for lack of budget rather than checked and found doubtful — say so rather than presenting those addresses as verified. Paid lookups are metered against the research budget; spend above the auto-approve threshold asks for confirmation first.',
	parameters: Schema.Struct({
		company_name: Schema.String,
		// Required + nullable, never optional: a nullable field inside `optionalKey`
		// becomes a nested anyOf that a strict provider rejects outright.
		domain: Schema.NullOr(Schema.String).annotate({
			description:
				'Company web domain, e.g. "acme.com" (no scheme, no @); null when the company has no website.',
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
						// A client with no way to put the question is not somebody
						// saying no. Say what the spending would be and how to allow
						// it, so the lookup can still be had — reading the refusal as a
						// decision left this unapprovable from any client that cannot ask.
						if (!(yield* canElicit)) {
							return {
								status: 'confirmation_required' as const,
								estimatedCostCents: estimateDiscoverCostCents,
								autoApproveLimitCents: policy.autoApprovePaidCents,
								nextStep: `This lookup may spend up to ~${estimateDiscoverCostCents}¢, above your auto-approve limit of ${policy.autoApprovePaidCents}¢, and this client has no way to ask you to approve it. Say the amount out loud to whoever is reading, and if they agree, raise the limit with research_policy(action:"set", auto_approve_paid_cents:${estimateDiscoverCostCents}) — or from Research budget under organization settings — then ask again.`,
							}
						}
						const { confirm } = yield* McpServer.elicit({
							// A company with no website is named on its own — writing the
							// domain in regardless would put the word "null" in front of
							// whoever is being asked to approve the spending.
							message: `Discovering decision-maker contacts for ${params.company_name}${params.domain === null ? '' : ` (${params.domain})`} may spend up to ~${estimateDiscoverCostCents}¢ on paid lookups, above your auto-approve limit of ${policy.autoApprovePaidCents}¢. Proceed?`,
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
