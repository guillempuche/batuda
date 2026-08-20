import { Effect, Schema } from 'effect'
import { McpSchema, Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg, SessionContext } from '@batuda/controllers'
import {
	ContactDiscovery,
	estimateDiscoverCostCents,
	resolvePolicy,
} from '@batuda/research'

import { ResearchDefaults } from '../../lib/research-defaults'
import { detachFromTransaction } from '../../middleware/org'
import { requireApproval } from './_elicit'
import { redactDbErrors } from './_research-shared'

// ── discover_contacts ──

const DiscoverContacts = Tool.make('discover_contacts', {
	description:
		'Find decision-maker contacts for a company. Returns ranked candidates, each with a buying_role saying what part they play in a purchase (economic_buyer holds the budget, champion argues for it inside, gatekeeper controls access, technical_evaluator judges whether it works, user lives with it; null when the title does not say) and, where an address was found, a deliverability verdict on its email channel (channels[].verification) — or an explicit no_reliable_contact result, never an unverified blast list. Pass domain:null for a company with no website at all (a market stall, a family workshop, a jobbing builder): no address can be guessed and no enrichment vendor is paid, so what comes back is names and job titles from the national registry, which is still worth having — say plainly that those people have no address rather than implying one. Result is one of: {status:"ok", contacts:[...]}, {status:"no_reliable_contact"}, {status:"budget_exceeded"}, {status:"cancelled"} (somebody was asked to approve the spending and said no), or {status:"confirmation_required"} (the spending needs approval and this client has no way to ask for it — the result carries the estimate, the current limit and what to do about it; relay that instead of retrying, since retrying gives the same answer). A result may also carry degraded, saying why the search came up short: "monthly_cap_reached" (the organization spent its monthly research budget partway through), "vendor_quota_exhausted" (the contact vendor has no paid allowance left this month), or "vendor_unavailable" (it could not be reached); "verification_limit_reached" (the call hit its ceiling on how many addresses it pays to check); or "already_paid_this_run" (the run was resumed and had already paid for that step, so it was skipped rather than bought twice). All three mean a thin or empty list is a fact about us, not about the company — say so rather than reporting that the company has nobody to find. Under "monthly_cap_reached" specifically, verification stopped partway, so a verification of "unknown" was left unchecked for want of budget rather than checked and found doubtful; under the other two, verification ran normally. Paid lookups are metered against the research budget. What one costs depends on what is asked for — a national register lookup where the country has one, the enrichment vendors only where there is a domain for them to work from, and a capped number of address checks — and the most it can come to is well under the usual auto-approve limit, so being asked to confirm is the exception rather than the rule.',
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
		const systemDefaults = yield* ResearchDefaults

		return {
			discover_contacts: params =>
				Effect.gen(function* () {
					const userId = (yield* SessionContext).userId
					const orgId = (yield* CurrentOrg).id

					// Confirm before spending above the caller's auto-approve limit.
					// What this particular lookup can cost, not a flat figure: a
					// company with no website cannot reach the paid finders at all,
					// and a country with no national register cannot pay for one.
					const ceiling = estimateDiscoverCostCents({
						country: params.country,
						domain: params.domain,
					})
					const policy = yield* resolvePolicy({ sql, userId, systemDefaults })
					if (ceiling > policy.autoApprovePaidCents) {
						// A company with no website is named on its own — writing the
						// domain in regardless would put the word "null" in front of
						// whoever is being asked to approve the spending.
						const answer = yield* requireApproval(
							`Discovering decision-maker contacts for ${params.company_name}${params.domain === null ? '' : ` (${params.domain})`} may spend up to ~${ceiling}¢ on paid lookups, above your auto-approve limit of ${policy.autoApprovePaidCents}¢. Proceed?`,
						)
						// A client with no way to put the question is not somebody
						// saying no. Say what the spending would be and where a person
						// can allow it, so the lookup can still be had.
						//
						// Where deliberately means the app, not this tool's sibling: the
						// limit can be raised over MCP too, and pointing the model at
						// that turns the gate into a step it routes around by itself.
						if (answer === 'unaskable') {
							return {
								status: 'confirmation_required' as const,
								estimatedCostCents: ceiling,
								autoApproveLimitCents: policy.autoApprovePaidCents,
								nextStep: `This lookup may spend up to ~${ceiling}¢, above your auto-approve limit of ${policy.autoApprovePaidCents}¢, and this client has no way to ask you to approve it. Say the amount out loud to whoever is reading; if they agree, they can raise the limit under Research budget in organization settings, and then you can ask again.`,
							}
						}
						if (answer === 'declined') return { status: 'cancelled' as const }
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
