/**
 * Contact-discovery orchestration — turns a company (name + domain) into ranked,
 * verified decision-maker email candidates. The universal path uses the
 * enrichment provider (Hunter) for names + emails; a free MX pre-gate and the
 * email verifier establish a deliverability verdict before anything is returned.
 *
 * The service owns its research-table writes (an anchor `research_runs` row +
 * paid-spend metering) but never touches CRM tables — it returns candidates
 * inline and the caller decides what to persist. Per-call budget is built here
 * (`makeBudgetLayer`) and provided to the steps, so the MCP handler stays a thin
 * transport with no budget plumbing of its own.
 */

import { Config, Effect, Layer, ServiceMap } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { type Country, SUPPORTED_COUNTRIES } from '../domain/country'
import { EnrichmentResult, type VerificationVerdict } from '../domain/types'
import { makeBudgetLayer } from './budget'
import { guessEmails, splitPersonName } from './email-guess'
import { resolvePolicy, type SystemDefaults } from './policy'
import {
	Budget,
	EmailVerifier,
	EnrichmentProvider,
	MxResolver,
	RegistryRouter,
} from './ports'

// A person from either name source (registry directors or the enrichment
// vendor). Registry directors arrive with just a name + role; enrichment adds
// emails, seniority, and other channels. Only the fields the pipeline reads.
interface SourcePerson {
	readonly firstName: string
	readonly lastName: string
	readonly position?: string | undefined
	readonly seniority?: string | undefined
	readonly email?: string | undefined
	readonly emailConfidence?: number | undefined
	readonly verification?: VerificationVerdict | undefined
	readonly linkedin?: string | undefined
	readonly x?: string | undefined
	readonly phone?: string | undefined
}

// Narrow a free-text country hint to a country that has a national registry.
const registryCountry = (hint: string | undefined): Country | undefined => {
	const upper = hint?.trim().toUpperCase()
	return upper && (SUPPORTED_COUNTRIES as readonly string[]).includes(upper)
		? (upper as Country)
		: undefined
}

// Fixed per-call cost estimates (cents). Hunter is credit-based; these meter the
// run budget + monthly cap without trying to mirror exact credit pricing.
const ENRICH_COST_CENTS = 5
const VERIFY_COST_CENTS = 1

/** Rough up-front cost the MCP handler compares to the auto-approve threshold. */
export const estimateDiscoverCostCents =
	ENRICH_COST_CENTS + 5 * VERIFY_COST_CENTS

// Lower is better — deliverable first, undeliverable last (and then dropped).
const VERDICT_RANK: Record<VerificationVerdict, number> = {
	deliverable: 0,
	risky: 1,
	catch_all: 2,
	unknown: 3,
	undeliverable: 4,
}

const DECISION_MAKER_TITLE =
	/director|head|chief|c[a-z]o|founder|owner|partner|managing|president|\bvp\b/i

export const isDecisionMaker = (
	role: string | undefined,
	seniority: string | undefined,
): boolean => {
	if (seniority && /executive|owner|founder/i.test(seniority)) return true
	if (role && DECISION_MAKER_TITLE.test(role)) return true
	return false
}

/**
 * One reachable channel for a contact. `kind` is open (`email`, `phone`,
 * `linkedin`, `x`, `website`, `bluesky`, …) so a new channel needs no schema
 * change. Only `email` carries a deliverability `verification` today.
 */
export interface ContactChannel {
	readonly kind: string
	readonly value: string
	readonly verification?: VerificationVerdict | undefined
	readonly confidence?: number | undefined
	readonly is_primary?: boolean | undefined
}

export interface DiscoveredContact {
	readonly name: string
	readonly role?: string | undefined
	readonly is_decision_maker: boolean
	readonly channels: ReadonlyArray<ContactChannel>
}

export type DiscoverContactsOutcome =
	| {
			readonly status: 'ok'
			readonly researchId: string
			readonly contacts: ReadonlyArray<DiscoveredContact>
	  }
	| { readonly status: 'no_reliable_contact'; readonly researchId: string }
	| { readonly status: 'budget_exceeded'; readonly researchId: string }

export interface DiscoverContactsInput {
	readonly companyName: string
	readonly domain: string
	readonly country?: string | undefined
	readonly userId: string
	readonly organizationId: string
	readonly systemDefaults: SystemDefaults
}

/** The email channel (when present) carries the deliverability signal we rank on. */
export const emailChannel = (
	c: DiscoveredContact,
): ContactChannel | undefined => c.channels.find(ch => ch.kind === 'email')

export const compareContacts = (
	a: DiscoveredContact,
	b: DiscoveredContact,
): number => {
	if (a.is_decision_maker !== b.is_decision_maker) {
		return a.is_decision_maker ? -1 : 1
	}
	const emailA = emailChannel(a)
	const emailB = emailChannel(b)
	const rankA = VERDICT_RANK[emailA?.verification ?? 'unknown']
	const rankB = VERDICT_RANK[emailB?.verification ?? 'unknown']
	if (rankA !== rankB) return rankA - rankB
	return (emailB?.confidence ?? 0) - (emailA?.confidence ?? 0)
}

export class ContactDiscovery extends ServiceMap.Service<ContactDiscovery>()(
	'ContactDiscovery',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const enrichment = yield* EnrichmentProvider
			const verifier = yield* EmailVerifier
			const registry = yield* RegistryRouter
			const mx = yield* MxResolver
			const fanout = yield* Config.int('RESEARCH_MAX_CONCURRENCY_FANOUT').pipe(
				Config.withDefault(3),
			)

			const discover = (
				input: DiscoverContactsInput,
			): Effect.Effect<DiscoverContactsOutcome> =>
				Effect.gen(function* () {
					const policy = yield* resolvePolicy({
						sql,
						userId: input.userId,
						systemDefaults: input.systemDefaults,
					})

					// Anchor row: a 'discover'-mode run satisfies the
					// research_paid_spend FK and records provenance. Reuses the
					// existing `kind='leaf'` (the kind CHECK forbids new values).
					const anchor = yield* sql<{ id: string }>`
						INSERT INTO research_runs (
							organization_id, query, mode, schema_name, status, context,
							budget_cents, paid_budget_cents, paid_policy, created_by,
							template_ids, template_names, template_fingerprint,
							started_at, completed_at
						) VALUES (
							${input.organizationId},
							${`discover_contacts: ${input.companyName} (${input.domain})`},
							'discover',
							'contact_discovery_v1',
							'succeeded',
							${JSON.stringify({
								company: {
									name: input.companyName,
									domain: input.domain,
									country: input.country ?? null,
								},
							})},
							${policy.budgetCents},
							${policy.paidBudgetCents},
							${JSON.stringify(policy)},
							${input.userId},
							${JSON.stringify([])}, ${JSON.stringify([])}, ${''},
							now(), now()
						) RETURNING id
					`
					const researchId = anchor[0]!.id

					// Per-call budget, with the captured sql supplied so the layer
					// requires nothing from the caller's context.
					const budgetLayer = makeBudgetLayer({
						userId: input.userId,
						researchId,
						policy,
						systemCeiling: input.systemDefaults.hardCeiling,
					}).pipe(Layer.provide(Layer.succeed(SqlClient.SqlClient)(sql)))

					const core = Effect.gen(function* () {
						const budget = yield* Budget

						// Names: registry-first where a national registry exists
						// (free/cheap, authoritative officers), else the universal
						// enrichment vendor. Registry directors carry no email, so
						// they flow through the same guess + verify below.
						const supportedCountry = registryCountry(input.country)
						let people: ReadonlyArray<SourcePerson> = []
						if (supportedCountry) {
							const record = yield* registry
								.lookup({
									country: supportedCountry,
									query: input.companyName,
								})
								.pipe(
									Effect.catchTag('ProviderError', () => Effect.succeed(null)),
								)
							people = (record?.directors ?? []).map(d => {
								const { firstName, lastName } = splitPersonName(d.name)
								return { firstName, lastName, position: d.role }
							})
						}
						// Universal fallback (paid) when no registry hit.
						if (people.length === 0) {
							yield* budget.chargePaid('hunter-enrich', ENRICH_COST_CENTS)
							people = yield* enrichment
								.findPeople({
									domain: input.domain,
									companyName: input.companyName,
									country: input.country,
								})
								.pipe(
									Effect.catchTag('ProviderError', () =>
										Effect.succeed(
											new EnrichmentResult({ people: [], units: 0 }),
										),
									),
									Effect.map(r => r.people),
								)
						}

						const mxOutcome = yield* mx.resolve(input.domain)

						// Verify one address. Any failure (provider or budget) degrades
						// to 'unknown' so a hit cap returns what was gathered.
						const verifyEmail = (email: string) =>
							Effect.gen(function* () {
								yield* budget.chargePaid('hunter-verify', VERIFY_COST_CENTS)
								const v = yield* verifier.verify({ email })
								return {
									verdict: v.result,
									confidence: v.score as number | undefined,
								}
							}).pipe(
								Effect.catchTag('ProviderError', () =>
									Effect.succeed({
										verdict: 'unknown' as VerificationVerdict,
										confidence: undefined as number | undefined,
									}),
								),
								Effect.catchTags({
									BudgetExceeded: () =>
										Effect.succeed({
											verdict: 'unknown' as VerificationVerdict,
											confidence: undefined as number | undefined,
										}),
									MonthlyCapExceeded: () =>
										Effect.succeed({
											verdict: 'unknown' as VerificationVerdict,
											confidence: undefined as number | undefined,
										}),
								}),
							)

						const built = yield* Effect.forEach(
							people,
							person =>
								Effect.gen(function* () {
									const channels: ContactChannel[] = []

									// Email channel: guess (if needed) → MX gate → verify.
									// Included only when actually sendable.
									const chosen =
										person.email ??
										guessEmails({
											firstName: person.firstName,
											lastName: person.lastName,
											domain: input.domain,
										})[0]
									if (chosen) {
										let verdict: VerificationVerdict
										let confidence: number | undefined
										if (mxOutcome === 'no_mx') {
											verdict = 'undeliverable'
											confidence = person.emailConfidence
										} else if (
											person.verification !== undefined &&
											person.email === chosen
										) {
											// Vendor already established a fresh verdict — skip
											// paying for a redundant verification call.
											verdict = person.verification
											confidence = person.emailConfidence
										} else {
											const r = yield* verifyEmail(chosen)
											verdict = r.verdict
											confidence = r.confidence ?? person.emailConfidence
										}
										if (verdict !== 'undeliverable') {
											channels.push({
												kind: 'email',
												value: chosen,
												verification: verdict,
												confidence,
												is_primary: true,
											})
										}
									}

									// Other channels the vendor returned (data-only).
									if (person.linkedin) {
										channels.push({ kind: 'linkedin', value: person.linkedin })
									}
									if (person.x) {
										channels.push({ kind: 'x', value: person.x })
									}
									if (person.phone) {
										channels.push({ kind: 'phone', value: person.phone })
									}

									if (channels.length === 0) return null

									const contact: DiscoveredContact = {
										name: `${person.firstName} ${person.lastName}`.trim(),
										role: person.position,
										is_decision_maker: isDecisionMaker(
											person.position,
											person.seniority,
										),
										channels,
									}
									return contact
								}),
							{ concurrency: fanout },
						)

						const contacts = built
							.filter((c): c is DiscoveredContact => c !== null)
							.sort(compareContacts)

						return contacts.length === 0
							? ({ status: 'no_reliable_contact', researchId } as const)
							: ({ status: 'ok', researchId, contacts } as const)
					})

					return yield* core.pipe(
						Effect.provide(budgetLayer),
						Effect.catchTags({
							BudgetExceeded: () =>
								Effect.succeed({
									status: 'budget_exceeded' as const,
									researchId,
								}),
							MonthlyCapExceeded: () =>
								Effect.succeed({
									status: 'budget_exceeded' as const,
									researchId,
								}),
						}),
					)
				}).pipe(Effect.orDie)

			return { discover }
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
