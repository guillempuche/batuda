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

import { Config, Context, Effect, Layer, Ref } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { isRegistryCountry, type RegistryCountry } from '../domain/country'
import { EnrichmentResult, type VerificationVerdict } from '../domain/types'
import { makeBudgetLayer } from './budget'
import { guessEmails, splitPersonName } from './email-guess'
import { resolvePolicy, type SystemDefaults } from './policy'
import {
	Budget,
	type BudgetService,
	EmailVerifier,
	type EnrichmentAttempt,
	EnrichmentChain,
	type EnrichmentInput,
	type EnrichmentMode,
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

// Merge people gathered from more than one enrichment vendor into one entry per
// person (union mode). Keyed by name — so the same person from two vendors
// collapses to a single contact — with a record that carries an email winning
// over a name-only duplicate, so a vendor-found address survives the merge.
export const dedupePeople = (
	people: ReadonlyArray<SourcePerson>,
): SourcePerson[] => {
	const byPerson = new Map<string, SourcePerson>()
	for (const person of people) {
		const key =
			`${person.firstName} ${person.lastName}`.trim().toLowerCase() ||
			person.email?.toLowerCase() ||
			person.linkedin ||
			''
		const existing = byPerson.get(key)
		if (
			existing === undefined ||
			(existing.email === undefined && person.email !== undefined)
		) {
			byPerson.set(key, person)
		}
	}
	return [...byPerson.values()]
}

// Run the enrichment chain when the registry found nobody: bill each configured
// vendor (via `charge`) and call it in turn. 'fallback' stops at the first
// vendor that returns anyone (cheapest); 'union' runs every vendor and merges
// the people (more cost, more recall). A vendor error degrades to no people, so
// the next vendor is still tried. Generic over the charge's error so the budget
// rails propagate unchanged.
export const runEnrichmentChain = <E>(
	chain: {
		readonly attempts: ReadonlyArray<EnrichmentAttempt>
		readonly mode: EnrichmentMode
	},
	input: EnrichmentInput,
	charge: (label: string) => Effect.Effect<void, E>,
): Effect.Effect<ReadonlyArray<SourcePerson>, E> =>
	Effect.gen(function* () {
		const collected: SourcePerson[] = []
		for (const attempt of chain.attempts) {
			yield* charge(attempt.label)
			const found = yield* attempt.findPeople(input).pipe(
				Effect.catchTag('ProviderError', () =>
					Effect.succeed(new EnrichmentResult({ people: [], units: 0 })),
				),
				Effect.map(r => r.people),
			)
			collected.push(...found)
			if (chain.mode === 'fallback' && collected.length > 0) break
		}
		return chain.mode === 'union' ? dedupePeople(collected) : collected
	})

// Narrow a free-text country hint to a country that has a national registry.
const registryCountry = (
	hint: string | undefined,
): RegistryCountry | undefined => {
	const upper = hint?.trim().toUpperCase()
	return upper && isRegistryCountry(upper) ? upper : undefined
}

// Fixed per-call cost estimates (cents). Hunter/FullEnrich are credit-based;
// these meter the run budget + monthly cap without mirroring exact credit
// pricing. Kept per-vendor so the spend row (and the eval's cost metric) names
// the finder that actually ran.
const ENRICH_COST_CENTS = 5
const FULLENRICH_COST_CENTS = 6
const VERIFY_COST_CENTS = 1

const ENRICH_COST_BY_VENDOR: Record<string, number> = {
	hunter: ENRICH_COST_CENTS,
	fullenrich: FULLENRICH_COST_CENTS,
}
const enrichCostFor = (label: string): number =>
	ENRICH_COST_BY_VENDOR[label] ?? ENRICH_COST_CENTS

/**
 * Rough up-front cost the MCP handler compares to its auto-approve threshold.
 * Worst case: both paid finders run (a registry miss, or union mode) before a
 * few verifies — so a real run never costs more than the confirm-gate saw.
 */
export const estimateDiscoverCostCents =
	ENRICH_COST_CENTS + FULLENRICH_COST_CENTS + 5 * VERIFY_COST_CENTS

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
			// Set when the month's spending ran out partway through, so addresses
			// left unchecked are known to be unchecked for want of money rather
			// than because checking them said nothing.
			readonly verificationStopped?: 'monthly_cap_reached' | undefined
	  }
	| { readonly status: 'no_reliable_contact'; readonly researchId: string }
	| { readonly status: 'budget_exceeded'; readonly researchId: string }
	// A paid step would spend past the caller's auto-approve limit: no charge
	// was made, and the model records it as a pending paid action to approve.
	| {
			readonly status: 'approval_required'
			readonly researchId: string
			readonly tool: string
			readonly estimatedCents: number
	  }

export interface DiscoverContactsInput {
	readonly companyName: string
	readonly domain: string
	readonly country?: string | undefined
	// Standalone path: discover builds its own anchor run + per-call budget.
	readonly userId?: string | undefined
	readonly organizationId?: string | undefined
	readonly systemDefaults?: SystemDefaults | undefined
	// In-loop path: reuse the calling research run's id + budget, so the paid
	// spend lands on that run and its cap still applies. Mutually exclusive with
	// the standalone fields above.
	readonly runContext?:
		| { readonly researchId: string; readonly budget: BudgetService }
		| undefined
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

export class ContactDiscovery extends Context.Service<ContactDiscovery>()(
	'ContactDiscovery',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const enrichment = yield* EnrichmentChain
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
					// Two paths. Called standalone, discover builds its own anchor run
					// and a per-call budget; called inside a research run, it reuses
					// that run's id and budget so the paid spend lands on the run and
					// the run's cap still applies.
					let researchId: string
					let budgetLayer: Layer.Layer<Budget>
					if (input.runContext) {
						researchId = input.runContext.researchId
						budgetLayer = Layer.succeed(Budget)(input.runContext.budget)
					} else {
						if (
							input.userId === undefined ||
							input.organizationId === undefined ||
							input.systemDefaults === undefined
						) {
							return yield* Effect.die(
								new Error(
									'discover requires userId, organizationId and systemDefaults, or a runContext',
								),
							)
						}
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
						researchId = anchor[0]!.id

						// Per-call budget, with the captured sql supplied so the layer
						// requires nothing from the caller's context.
						budgetLayer = makeBudgetLayer({
							organizationId: input.organizationId,
							userId: input.userId,
							researchId,
							policy,
							defaultCapCents: input.systemDefaults.paidMonthlyCapCents,
							systemCeiling: input.systemDefaults.hardCeiling,
						}).pipe(Layer.provide(Layer.succeed(SqlClient.SqlClient)(sql)))
					}

					// Raised the moment the company's month runs out mid-verification,
					// so the answer can say the addresses left over went unchecked for
					// want of money.
					const verificationStopped = yield* Ref.make(false)

					const core = Effect.gen(function* () {
						const budget = yield* Budget

						// Names: registry-first where a national registry exists
						// (free/cheap, authoritative officers), else the universal
						// enrichment vendor. Registry directors carry no email, so
						// they flow through the same guess + verify below.
						const countryWithRegistry = registryCountry(input.country)
						let people: ReadonlyArray<SourcePerson> = []
						if (countryWithRegistry) {
							const record = yield* registry
								.lookup({
									country: countryWithRegistry,
									query: input.companyName,
								})
								.pipe(
									// Registry is best-effort here; any miss (provider failure
									// or a country with no registry) falls through to enrichment.
									Effect.catchTags({
										ProviderError: () => Effect.succeed(null),
										NoRegistry: () => Effect.succeed(null),
									}),
								)
							people = (record?.directors ?? []).map(d => {
								const { firstName, lastName } = splitPersonName(d.name)
								return { firstName, lastName, position: d.role }
							})
						}
						// Universal fallback (paid) when no registry hit. runEnrichmentChain
						// bills + calls each configured vendor; the idempotency key names the
						// vendor so a resumed run re-charges it as a DB no-op, not a re-pay.
						if (people.length === 0) {
							people = yield* runEnrichmentChain(
								enrichment,
								{
									domain: input.domain,
									companyName: input.companyName,
									country: input.country,
								},
								label =>
									budget.chargePaid(
										`${label}-enrich`,
										enrichCostFor(label),
										'discover_contacts',
										`${researchId}:${label}-enrich:${input.domain}`,
									),
							)
						}

						const mxOutcome = yield* mx.resolve(input.domain)

						// Verify one address. Any failure (provider or budget) degrades
						// to 'unknown' so a hit cap returns what was gathered.
						const verifyEmail = (email: string) =>
							Effect.gen(function* () {
								yield* budget.chargePaid(
									'hunter-verify',
									VERIFY_COST_CENTS,
									'discover_contacts',
									// Idempotency key so a resumed run does not re-pay to
									// verify the same address.
									`${researchId}:hunter-verify:${email}`,
								)
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
									// The company's month is spent, so no address after this
									// one can be checked either. Remember why, or every
									// remaining address comes back looking merely unverifiable
									// and nobody learns the money ran out.
									MonthlyCapExceeded: () =>
										Effect.gen(function* () {
											yield* Ref.set(verificationStopped, true)
											return {
												verdict: 'unknown' as VerificationVerdict,
												confidence: undefined as number | undefined,
											}
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
										// A guessed address (no vendor-provided email) is only
										// asserted when the verifier positively confirms it. An
										// 'unknown' (verify failed or budget ran out), 'catch_all'
										// (domain accepts anything, so the specific mailbox is
										// unconfirmed), or 'undeliverable' guess is not evidence
										// the mailbox exists, so it is dropped rather than invented.
										// A vendor-provided address keeps the softer bar (drop only
										// 'undeliverable') since the vendor found that exact address.
										const wasGuessed = person.email !== chosen
										const guessedConfirmed =
											verdict === 'deliverable' || verdict === 'risky'
										if (
											verdict !== 'undeliverable' &&
											(!wasGuessed || guessedConfirmed)
										) {
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

						const stopped = yield* Ref.get(verificationStopped)
						return contacts.length === 0
							? ({ status: 'no_reliable_contact', researchId } as const)
							: ({
									status: 'ok',
									researchId,
									contacts,
									...(stopped
										? { verificationStopped: 'monthly_cap_reached' as const }
										: {}),
								} as const)
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
							// A paid step over the auto-approve limit (in-run budgets only):
							// return the gate as an outcome so the run keeps its findings
							// and the model can propose the action for approval.
							ApprovalRequired: e =>
								Effect.succeed({
									status: 'approval_required' as const,
									researchId,
									tool: e.tool,
									estimatedCents: e.estimatedCents,
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
