/**
 * Stub UK registry provider — deterministic fake Companies House record with a
 * couple of active officers, so the registry-first contact path can be
 * exercised without a key. Names use the "SURNAME, Forename" shape Companies
 * House returns, to drive the name-split + guess path.
 */

import { Effect, Layer } from 'effect'

import { RegistryRouter } from '../../application/ports'
import { RegistryRecord } from '../../domain/types'

export const StubRegistryGbProviderInstance = RegistryRouter.of({
	lookup: _input =>
		Effect.succeed(
			new RegistryRecord({
				legalName: 'ACME WIDGETS LTD',
				taxId: '12345678',
				status: 'active',
				incorporationDate: '2014-06-02',
				address: '20 OFFICE ROW, LONDON, EC1A 1BB, ENGLAND',
				directors: [
					{ name: 'SMITH, Jane', role: 'director', since: '2014-06-02' },
					{ name: 'PATEL, Arjun', role: 'director', since: '2018-01-10' },
				],
				units: 0,
			}),
		),
})

export const StubRegistryGbProvider = Layer.succeed(RegistryRouter)(
	StubRegistryGbProviderInstance,
)
