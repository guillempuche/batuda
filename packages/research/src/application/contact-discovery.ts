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

import type { VerificationVerdict } from '@batuda/domain'
import { decidesPurchase } from '@batuda/domain'

import { isRegistryCountry, type RegistryCountry } from '../domain/country'
import type {
	ApprovalRequired,
	BudgetExceeded,
	MonthlyCapExceeded,
} from '../domain/errors'
import { EnrichmentResult } from '../domain/types'
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
	type PaidCall,
	RegistryRouter,
} from './ports'
import {
	ENRICH_COST_CENTS,
	FULLENRICH_COST_CENTS,
	REGISTRY_LOOKUP_COST_CENTS,
	VERIFY_COST_CENTS,
} from './tool-costs'

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

/**
 * What a pass over the enrichment vendors found, and whether one turning us away
 * is why the answer is thin.
 *
 * Both flags mean "this is why we came up short", not merely "this happened". A
 * vendor whose allowance is spent while the next one answers in full cost nothing
 * — saying so would have the caller apologise for a complete list. So in fallback
 * mode, where the vendors are alternatives, a refusal only counts when nobody
 * answered; in union mode they are additive, so a refusal always cost recall.
 */
// What paying for a vendor call can go wrong with: the run is out of money, the
// company's month is spent, or the amount needs somebody's approval first.
type PaidRail = BudgetExceeded | MonthlyCapExceeded | ApprovalRequired

export interface EnrichmentChainOutcome {
	readonly people: ReadonlyArray<SourcePerson>
	/** A vendor's paid allowance is spent, and that is why people are missing. */
	readonly quotaExhausted: boolean
	/** A vendor failed for another reason — down, rate-limited, refusing the domain. */
	readonly vendorFailed: boolean
	/** A vendor was skipped because this run already paid it for this company. */
	readonly alreadyPaid: boolean
}

// Run the enrichment chain when the registry found nobody: bill each configured
// vendor (via `charge`) and call it in turn. 'fallback' stops at the first
// vendor that returns anyone (cheapest); 'union' runs every vendor and merges
// the people (more cost, more recall). A vendor error degrades to no people, so
// the next vendor is still tried. Generic over the charge's error so the budget
// rails propagate unchanged.

export const runEnrichmentChain = (
	chain: {
		readonly attempts: ReadonlyArray<EnrichmentAttempt>
		readonly mode: EnrichmentMode
	},
	input: EnrichmentInput,
	// Pays for the vendor and calls it in one step, so a vendor that fails hands
	// this run's allowance back and the vendor after it still has room to be
	// tried. `already_charged` means this run paid for that vendor before, in
	// which case the vendor is not called again — the answer would be bought a
	// second time for real money that this run's record deliberately will not
	// count twice.
	buy: (
		label: string,
	) => <A>(call: () => Effect.Effect<A>) => Effect.Effect<PaidCall<A>, PaidRail>,
): Effect.Effect<EnrichmentChainOutcome, PaidRail> =>
	Effect.gen(function* () {
		const collected: SourcePerson[] = []
		let quotaExhausted = false
		let vendorFailed = false
		let alreadyPaid = false
		for (const attempt of chain.attempts) {
			// A vendor already paid for in this run — which happens when a run is
			// resumed after a deploy — is not called again, and the shortfall is
			// reported instead.
			const outcome = yield* buy(attempt.label)(() =>
				attempt.findPeople(input).pipe(
					// A vendor that could not answer is remembered, not just swallowed.
					// "Nobody works here" and "we are out of credit" produce the same
					// empty list, and only one of them is an answer about the company.
					Effect.catchTag('ProviderError', error =>
						Effect.sync(() => {
							if (error.quotaExhausted === true) quotaExhausted = true
							else vendorFailed = true
							return new EnrichmentResult({ people: [], units: 0 })
						}),
					),
				),
			)
			if (outcome._tag === 'already_charged') {
				alreadyPaid = true
				continue
			}
			collected.push(...outcome.value.people)
			if (chain.mode === 'fallback' && collected.length > 0) break
		}
		// In fallback mode the vendors are alternatives, so a refusal only cost us
		// something when nobody answered at all. In union mode they add up, so one
		// missing vendor is missing people however many the others found.
		const refusalCostUs = chain.mode === 'union' || collected.length === 0
		return {
			people: chain.mode === 'union' ? dedupePeople(collected) : collected,
			quotaExhausted: quotaExhausted && refusalCostUs,
			vendorFailed: vendorFailed && refusalCostUs,
			alreadyPaid: alreadyPaid && refusalCostUs,
		}
	})

// Narrow a free-text country hint to a country that has a national registry.
const registryCountry = (
	hint: string | undefined,
): RegistryCountry | undefined => {
	const upper = hint?.trim().toUpperCase()
	return upper && isRegistryCountry(upper) ? upper : undefined
}

const ENRICH_COST_BY_VENDOR: Record<string, number> = {
	hunter: ENRICH_COST_CENTS,
	fullenrich: FULLENRICH_COST_CENTS,
}
const enrichCostFor = (label: string): number =>
	ENRICH_COST_BY_VENDOR[label] ?? ENRICH_COST_CENTS

/**
 * How many addresses one call will pay to check.
 *
 * Both paid finders return about ten people, so ten covers them — but a national
 * registry can name more directors than that, and every one of them needs a
 * guessed address checked. Without a ceiling the spend follows the company's board
 * size, which is nobody's intention and nothing the caller was quoted.
 */
export const MAX_VERIFICATIONS = 10

/**
 * The most one call can spend, for the gate that asks a person before it does.
 *
 * Worked out per request rather than as one figure for every company, because
 * what a call can reach differs: a country with a national register pays for
 * that lookup and one without cannot, and a company with no website never
 * reaches the paid finders at all, since every one of them is keyed on the
 * domain. Quoting a flat figure asks somebody to approve money that could not
 * be spent, and hides the register's price behind an answer that never named it.
 *
 * A real call usually costs less: a register hit skips the finders, and
 * `fallback` mode stops at the first vendor that finds anybody. The ceiling on
 * verifications is what keeps this a ceiling rather than a hope.
 */
export const estimateDiscoverCostCents = (input: {
	readonly country?: string | undefined
	readonly domain: string | null
}): number =>
	(registryCountry(input.country) ? REGISTRY_LOOKUP_COST_CENTS : 0) +
	(input.domain === null ? 0 : ENRICH_COST_CENTS + FULLENRICH_COST_CENTS) +
	MAX_VERIFICATIONS * VERIFY_COST_CENTS

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

/**
 * What part a person's title suggests they play in a purchase.
 *
 * Only one part is ever guessed: somebody senior enough to hold a budget is the
 * economic buyer. Everything else is left unsaid.
 *
 * That is deliberate, and it is narrower than it might look. Whether somebody is
 * a champion depends on what they want, which no title reveals. And a title that
 * names the buying itself — head of procurement — is just as often the person who
 * signs as the person a request passes through, so calling it a gate would quietly
 * demote half of them and drop them out of "who is worth reaching".
 *
 * The value of naming the parts is in what a person or a run with real evidence
 * can record, not in what a pattern over job titles can infer. This keeps the
 * guess exactly as wide as the yes/no it replaces, so nothing measured against it
 * shifts underfoot.
 */
export const buyingRoleFromTitle = (
	role: string | undefined,
	seniority: string | undefined,
): string | null => {
	if (seniority && /executive|owner|founder/i.test(seniority))
		return 'economic_buyer'
	if (role && DECISION_MAKER_TITLE.test(role)) return 'economic_buyer'
	return null
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
	/** What part they play in a purchase; null when the title does not say. */
	readonly buying_role: string | null
	readonly channels: ReadonlyArray<ContactChannel>
}

export type DiscoverContactsOutcome =
	| {
			readonly status: 'ok'
			readonly researchId: string
			readonly contacts: ReadonlyArray<DiscoveredContact>
			// Why the search came up short, when it did. Without this a thin list
			// reads as a fact about the company, and three of these are facts about
			// us instead: our own month's spending ran out, the vendor's paid
			// allowance ran out, or the vendor could not be reached. Only silence
			// here means the company really has little to find.
			readonly degraded?:
				| 'monthly_cap_reached'
				| 'vendor_quota_exhausted'
				| 'vendor_unavailable'
				| 'verification_limit_reached'
				| 'already_paid_this_run'
				| undefined
	  }
	| {
			readonly status: 'no_reliable_contact'
			readonly researchId: string
			readonly degraded?:
				| 'monthly_cap_reached'
				| 'vendor_quota_exhausted'
				| 'vendor_unavailable'
				| 'verification_limit_reached'
				| 'already_paid_this_run'
				| undefined
	  }
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
	/**
	 * The company's web domain, or null when it has no website at all — a market
	 * stall, a family workshop, a jobbing builder. Without one nothing can be
	 * guessed and no enrichment vendor can be asked, so the answer is whoever the
	 * national registry names, with no address.
	 */
	readonly domain: string | null
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
	// Whoever can carry a purchase forward comes first. A gatekeeper and an
	// evaluator matter, but neither moves a deal on their own, so they rank with
	// everyone else rather than above them.
	const aDecides = decidesPurchase(a.buying_role)
	const bDecides = decidesPurchase(b.buying_role)
	if (aDecides !== bDecides) return aDecides ? -1 : 1
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
					// Raised when a vendor turned us away rather than answering: its own
					// allowance spent, or it could not be reached at all. The verifier's
					// two are Refs because addresses are checked concurrently.
					let enrichmentQuotaSpent = false
					let enrichmentUnavailable = false
					const verifierQuotaSpent = yield* Ref.make(false)
					const verifierUnavailable = yield* Ref.make(false)
					// Addresses checked so far, against the ceiling the caller was quoted.
					// A Ref because the people are worked through concurrently.
					const verificationsSpent = yield* Ref.make(0)
					const verificationsCapped = yield* Ref.make(false)
					// Work this run already paid for, skipped rather than bought again.
					const verifierAlreadyPaid = yield* Ref.make(false)
					let enrichmentAlreadyPaid = false


					const core = Effect.gen(function* () {
						const budget = yield* Budget

						// Names: registry-first where a national registry exists
						// (free/cheap, authoritative officers), else the universal
						// enrichment vendor. Registry directors carry no email, so
						// they flow through the same guess + verify below.
						const countryWithRegistry = registryCountry(input.country)
						let people: ReadonlyArray<SourcePerson> = []
						if (countryWithRegistry) {
							// The register bills per lookup, the same as it does for the
							// agent's own registry_lookup tool. Left uncharged, a discovery
							// spent real money that neither the run's budget nor the
							// month's total ever saw.
							const looked = yield* budget.withPaidCharge(
								'registry',
								REGISTRY_LOOKUP_COST_CENTS,
								'discover_contacts',
								`${researchId}:registry:${countryWithRegistry}:${input.companyName}`,
							)(() =>
								registry
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
									),
							)
							const record =
								looked._tag === 'already_charged' ? null : looked.value
							people = (record?.directors ?? []).map(d => {
								const { firstName, lastName } = splitPersonName(d.name)
								return { firstName, lastName, position: d.role }
							})
						}
						// Universal fallback (paid) when no registry hit. runEnrichmentChain
						// bills + calls each configured vendor; the idempotency key names the
						// vendor so a resumed run re-charges it as a DB no-op, not a re-pay.
						//
						// A company with no website is skipped here rather than asked about:
						// every vendor is keyed on the domain, so the call could only come
						// back empty, and it would still be charged for. Its idempotency key
						// is built from the domain too, so a domain-less call would share one
						// key with every other domain-less company and the second such run
						// would read the first one's charge as its own.
						const domain = input.domain
						if (people.length === 0 && domain !== null) {
							people = yield* runEnrichmentChain(
								enrichment,
								{
									domain,
									companyName: input.companyName,
									country: input.country,
								},
								label =>
									budget.withPaidCharge(
										`${label}-enrich`,
										enrichCostFor(label),
										'discover_contacts',
										`${researchId}:${label}-enrich:${domain}`,
									),
							).pipe(
								Effect.map(outcome => {
									if (outcome.quotaExhausted) enrichmentQuotaSpent = true
									else if (outcome.vendorFailed) enrichmentUnavailable = true
									if (outcome.alreadyPaid) enrichmentAlreadyPaid = true
									return outcome.people
								}),
							)
						}

						// Whether the company's domain accepts mail at all. With no domain
						// there is nothing to ask, and nothing will be guessed against it
						// either, so the question never arises.
						const mxOutcome = domain === null ? null : yield* mx.resolve(domain)

						// Verify one address. Any failure (provider or budget) degrades
						// to 'unknown' so a hit cap returns what was gathered.
						const verifyEmail = (email: string) =>
							Effect.gen(function* () {
								// This address was already checked and paid for earlier in the
								// run — a resume after a deploy. Buying the same answer twice
								// costs real money for nothing, so the check is skipped. The
								// verdict is left unknown, which for a guessed address means
								// it is dropped rather than asserted on a check we did not do.
								const checked = yield* budget.withPaidCharge(
									'hunter-verify',
									VERIFY_COST_CENTS,
									'discover_contacts',
									`${researchId}:hunter-verify:${email}`,
								)(() => verifier.verify({ email }))
								if (checked._tag === 'already_charged') {
									yield* Ref.set(verifierAlreadyPaid, true)
									return {
										verdict: 'unknown' as VerificationVerdict,
										confidence: undefined as number | undefined,
									}
								}
								const v = checked.value
								return {
									verdict: v.result,
									confidence: v.score as number | undefined,
								}
							}).pipe(
								// The verifier turning us away is the case that hides worst. A
								// guessed address survives only on a positive verdict, so an
								// unchecked one is dropped and the person comes back with no way
								// to reach them — which reads as "this company publishes no
								// address" when the truth is that our verifications ran out.
								Effect.catchTag('ProviderError', error =>
									Effect.gen(function* () {
										yield* Ref.set(
											error.quotaExhausted === true
												? verifierQuotaSpent
												: verifierUnavailable,
											true,
										)
										return {
											verdict: 'unknown' as VerificationVerdict,
											confidence: undefined as number | undefined,
										}
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
									// Included only when actually sendable. Nothing can be
									// guessed without a domain, so a person the registry named
									// keeps whatever address they arrived with, which is none.
									const chosen =
										person.email ??
										(domain === null
											? undefined
											: guessEmails({
													firstName: person.firstName,
													lastName: person.lastName,
													domain,
												})[0])
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
										} else if (
											(yield* Ref.getAndUpdate(
												verificationsSpent,
												n => n + 1,
											)) < MAX_VERIFICATIONS
										) {
											const r = yield* verifyEmail(chosen)
											verdict = r.verdict
											confidence = r.confidence ?? person.emailConfidence
										} else {
											// The call's allowance for checking addresses is spent.
											// Left unchecked rather than asserted: a guessed address
											// is only ever claimed when a check backs it, so this
											// person comes back without one.
											yield* Ref.set(verificationsCapped, true)
											verdict = 'unknown'
											confidence = person.emailConfidence
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

									// A person with no way of reaching them is still worth handing
									// back: the name and the job title are the useful part, and
									// for a company with no website they are all there is to
									// find. Better than reporting nobody was found while the
									// registry plainly names the director. What is worthless is a
									// row with neither a name nor a way to reach anyone, so that
									// is what gets dropped.
									const name = `${person.firstName} ${person.lastName}`.trim()
									if (name === '' && channels.length === 0) return null

									const contact: DiscoveredContact = {
										name,
										role: person.position,
										buying_role: buyingRoleFromTitle(
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
						const verifyQuota = yield* Ref.get(verifierQuotaSpent)
						const verifyDown = yield* Ref.get(verifierUnavailable)
						// Our own month runs out first in the telling: it is the one the
						// caller can do something about today. A spent allowance comes next,
						// since it is a bill somebody can pay, and an unreachable vendor
						// last, since it usually fixes itself.
						const capped = yield* Ref.get(verificationsCapped)
						const alreadyPaidSomething =
							enrichmentAlreadyPaid || (yield* Ref.get(verifierAlreadyPaid))
						const degraded = stopped
							? ('monthly_cap_reached' as const)
							: enrichmentQuotaSpent || verifyQuota
								? ('vendor_quota_exhausted' as const)
								: enrichmentUnavailable || verifyDown
									? ('vendor_unavailable' as const)
									: capped
										? ('verification_limit_reached' as const)
										: alreadyPaidSomething
											? ('already_paid_this_run' as const)
											: undefined
						return contacts.length === 0
							? ({
									status: 'no_reliable_contact',
									researchId,
									...(degraded ? { degraded } : {}),
								} as const)
							: ({
									status: 'ok',
									researchId,
									contacts,
									...(degraded ? { degraded } : {}),
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
