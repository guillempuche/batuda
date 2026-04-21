import { Cause, ConfigProvider, Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { BookingProvider } from '../application/ports/booking-provider'
import { BookingProviderLive } from './live'

// Build a one-shot program that materializes the live layer under a specific
// env snapshot and hands back the booking provider for inspection.
const withEnv = <A, E>(
	env: Record<string, string>,
	program: (provider: BookingProvider['Service']) => Effect.Effect<A, E>,
) =>
	Effect.runPromiseExit(
		Effect.gen(function* () {
			const provider = yield* BookingProvider
			return yield* program(provider)
		}).pipe(
			Effect.provide(BookingProviderLive),
			Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
		) as Effect.Effect<A, E, never>,
	)

describe('BookingProviderLive env dispatch', () => {
	it('should select the stub adapter when CALENDAR_PROVIDER=stub', async () => {
		// GIVEN CALENDAR_PROVIDER=stub
		// WHEN a caller yields BookingProvider and invokes listEventTypes
		// THEN the call succeeds (the stub's in-memory store returns an empty list)
		const exit = await withEnv({ CALENDAR_PROVIDER: 'stub' }, p =>
			p.listEventTypes(),
		)
		expect(exit._tag).toBe('Success')
		if (exit._tag === 'Success') {
			expect(Array.isArray(exit.value)).toBe(true)
		}
	})

	it('should wire a fail-fast stand-in when CALENDAR_PROVIDER=calcom (adapter not yet live)', async () => {
		// GIVEN CALENDAR_PROVIDER=calcom and no CalcomLive adapter wired in PR #1
		// WHEN a caller invokes listEventTypes
		// THEN the call fails with BookingFailed{reason='calcom_adapter_not_yet_wired'}
		// AND `recoverable=false` so retries don't mask the wiring gap
		const exit = await withEnv({ CALENDAR_PROVIDER: 'calcom' }, p =>
			p.listEventTypes(),
		)
		expect(exit._tag).toBe('Failure')
		if (exit._tag === 'Failure') {
			const failReason = exit.cause.reasons.find(Cause.isFailReason)
			expect(failReason).toBeDefined()
			const failure = failReason?.error
			expect(failure?._tag).toBe('BookingFailed')
			if (failure?._tag === 'BookingFailed') {
				expect(failure.reason).toBe('calcom_adapter_not_yet_wired')
				expect(failure.recoverable).toBe(false)
			}
		}
	})

	it('should reject unknown CALENDAR_PROVIDER values at boot', async () => {
		// GIVEN CALENDAR_PROVIDER='sap' (not one of the Schema.Literals the
		// config reads)
		// WHEN the layer attempts to build
		// THEN the whole program fails — we never spin up a misconfigured
		// provider silently
		const exit = await withEnv({ CALENDAR_PROVIDER: 'sap' }, p =>
			p.listEventTypes(),
		)
		expect(exit._tag).toBe('Failure')
	})

	it('should fail when CALENDAR_PROVIDER is absent', async () => {
		// GIVEN an env snapshot that does not set CALENDAR_PROVIDER
		// WHEN the layer attempts to build
		// THEN the boot fails — the variable is required (no silent default,
		// per memory `feedback_explicit_env_vars`)
		const exit = await withEnv({}, p => p.listEventTypes())
		expect(exit._tag).toBe('Failure')
	})
})
