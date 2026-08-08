// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { Effect, Layer, ManagedRuntime } from 'effect'
import { afterAll, describe, expect, it } from 'vitest'

import {
	type BudgetService,
	ContactDiscovery,
	EmailVerifier,
	EnrichmentChain,
	MxResolver,
	RegistryRouter,
} from '@batuda/research'

import { PgLive } from '../db/client'

// Contact discovery for a company with no website at all — a market stall, a
// family workshop, a jobbing builder. The real ContactDiscovery layer is built
// over the live database with every outside vendor stubbed, so what this asserts
// is the money and the answer: no enrichment vendor is paid for a lookup that is
// keyed on a domain there isn't one of, and whoever the national registry names
// still comes back, address or no address.

interface VendorCall {
	readonly label: string
	readonly domain: string
}

// What each stub was asked for, reset per test so one test cannot read another's.
let vendorCalls: VendorCall[] = []
let mxCalls: string[] = []
let verifyCalls: string[] = []
let charges: string[] = []

const registryDirectors = [
	{ name: 'Dolors Puig', role: 'Administradora única' },
	{ name: 'Jordi Serra', role: 'Apoderat' },
]

// A registry that names two officers and no addresses, which is what a national
// business register actually holds.
const registryLayer = Layer.succeed(RegistryRouter)(
	RegistryRouter.of({
		lookup: () =>
			Effect.succeed({
				legalName: 'Taller Puig SL',
				directors: registryDirectors,
			}) as never,
	}),
)

// One paid vendor that would find somebody, so a test failure means the gate let
// the call through rather than that there was nothing to find.
const enrichmentLayer = Layer.succeed(EnrichmentChain)({
	mode: 'fallback' as const,
	attempts: [
		{
			label: 'hunter',
			findPeople: (input: { readonly domain: string }) =>
				Effect.sync(() => {
					vendorCalls.push({ label: 'hunter', domain: input.domain })
					return {
						people: [
							{ firstName: 'Vendor', lastName: 'Person', email: 'v@x.com' },
						],
						units: 1,
					}
				}) as never,
		},
	],
})

const mxLayer = Layer.succeed(MxResolver)(
	MxResolver.of({
		resolve: (domain: string) =>
			Effect.sync(() => {
				mxCalls.push(domain)
				return 'has_mx' as const
			}),
	}),
)

const verifierLayer = Layer.succeed(EmailVerifier)(
	EmailVerifier.of({
		verify: (input: { readonly email: string }) =>
			Effect.sync(() => {
				verifyCalls.push(input.email)
				return { result: 'deliverable' as const, score: 90 }
			}) as never,
	}),
)

// A budget that records what it was asked to pay for and never refuses, so a
// charge that should not have happened shows up as a recorded charge rather than
// as a rejection that could be mistaken for the gate working.
const budget: BudgetService = {
	chargeCheap: () => Effect.void,
	chargePaid: (provider, _cents, _tool, idempotencyKey) =>
		Effect.sync(() => {
			charges.push(`${provider}:${idempotencyKey}`)
			return true
		}),
	withPaidCharge: (provider, _cents, _tool, idempotencyKey) => call =>
		Effect.gen(function* () {
			charges.push(`${provider}:${idempotencyKey}`)
			return { _tag: 'bought' as const, value: yield* Effect.suspend(call) }
		}),
	snapshot: () => Effect.succeed({} as never),
}

const runtime = ManagedRuntime.make(
	ContactDiscovery.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				registryLayer,
				enrichmentLayer,
				mxLayer,
				verifierLayer,
				PgLive,
			),
		),
	),
)

const discover = (domain: string | null, country: string | undefined) => {
	vendorCalls = []
	mxCalls = []
	verifyCalls = []
	charges = []
	return runtime.runPromise(
		Effect.gen(function* () {
			const discovery = yield* ContactDiscovery
			return yield* discovery.discover({
				companyName: 'Taller Puig SL',
				domain,
				country,
				// Reuse a caller's run + budget, so no anchor run is written and the
				// spending this test watches is the spending discovery itself asks for.
				runContext: { researchId: 'run-no-domain', budget },
			})
		}),
	)
}

afterAll(async () => {
	await runtime.dispose()
})

describe('discover_contacts for a company with no website', () => {
	describe('when the country has a national registry', () => {
		it('should return the officers it names, with no address and no vendor paid', async () => {
			// GIVEN a Spanish company with no domain at all
			const result = await discover(null, 'ES')

			// THEN the officers the registry names come back
			expect(result.status).toBe('ok')
			const contacts = result.status === 'ok' ? result.contacts : []
			expect(contacts.map(c => c.name).sort()).toEqual([
				'Dolors Puig',
				'Jordi Serra',
			])

			// AND each carries their role but no way of reaching them — which is the
			// whole point: a name and a job title beat reporting nobody was found
			expect(contacts.every(c => c.channels.length === 0)).toBe(true)
			expect(contacts.find(c => c.name === 'Dolors Puig')?.role).toBe(
				'Administradora única',
			)

			// AND no enrichment vendor was asked or charged for a lookup keyed on a
			// domain this company does not have
			expect(vendorCalls).toEqual([])

			// AND the one thing that was paid for is the register lookup itself,
			// which bills per call however the answer is used — leaving it off the
			// bill was money the run's budget and the month's total never saw
			expect(charges).toEqual([
				'registry:run-no-domain:registry:ES:Taller Puig SL',
			])

			// AND nothing tried to resolve mail servers or verify an address, because
			// there is no domain to ask about and no address to check
			expect(mxCalls).toEqual([])
			expect(verifyCalls).toEqual([])
		})
	})

	describe('when the country has no national registry', () => {
		it('should report nobody rather than paying a vendor it cannot use', async () => {
			// GIVEN a company with no domain in a country with no register to read
			const result = await discover(null, 'BR')

			// THEN there is genuinely nothing to find, and it says so
			expect(result.status).toBe('no_reliable_contact')

			// AND no money moved on the way to that answer
			expect(vendorCalls).toEqual([])
			expect(charges).toEqual([])
		})
	})

	describe('when the same company does have a website', () => {
		it('should still pay the vendor and verify, so the gate is about the domain alone', async () => {
			// GIVEN a company with a domain but in a country with no register, so the
			// paid chain is the only way to find anyone
			const result = await discover('tallerpuig.com', 'BR')

			// THEN the vendor was asked, keyed on the real domain
			expect(vendorCalls).toEqual([
				{ label: 'hunter', domain: 'tallerpuig.com' },
			])
			// AND the lookup's idempotency key names that domain, so two different
			// companies can never share one key and read each other's charge as paid
			expect(charges).toEqual([
				'hunter-enrich:run-no-domain:hunter-enrich:tallerpuig.com',
				'hunter-verify:run-no-domain:hunter-verify:v@x.com',
			])

			// AND the vendor's address went through the mail-server gate and was
			// checked, which is the work the domain makes possible
			expect(mxCalls).toEqual(['tallerpuig.com'])
			expect(verifyCalls).toEqual(['v@x.com'])
			expect(result.status).toBe('ok')
		})
	})
})
