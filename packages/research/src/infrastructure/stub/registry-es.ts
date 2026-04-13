/**
 * Stub Spanish registry provider — returns a deterministic fake company record.
 *
 * Pattern: Layer.succeed (no dependencies, no I/O, no cost).
 * Matches the RegistryRecord schema with Acme Corp S.L. data.
 */

import { Effect, Layer } from 'effect'

import { RegistryRouter } from '../../application/ports'
import { RegistryRecord } from '../../domain/types'

export const StubRegistryEsProvider = Layer.succeed(RegistryRouter)(
	RegistryRouter.of({
		lookup: _input =>
			Effect.succeed(
				new RegistryRecord({
					legalName: 'ACME CORP S.L.',
					taxId: 'B12345678',
					status: 'Activa',
					incorporationDate: '2005-03-15',
					capital: '60.000 EUR',
					address: 'CARRER DE LA INDÚSTRIA 42, 08025 BARCELONA (BARCELONA)',
					directors: [
						{
							name: 'GARCIA LOPEZ, MARIA',
							role: 'Administradora Única',
							since: '2005-03-15',
						},
					],
					units: 0,
				}),
			),
	}),
)
