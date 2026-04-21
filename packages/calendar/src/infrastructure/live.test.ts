import { Cause, ConfigProvider, Effect, Layer } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { describe, expect, it } from 'vitest'

import { BookingProvider } from '../application/ports/booking-provider'
import { BookingProviderLive } from './live'

// Build a one-shot program that materializes the live layer under a specific
// env snapshot and hands back the booking provider for inspection. Every
// branch of `BookingProviderLive` needs `HttpClient` upstream (the calcom
// adapter actually uses it; the stub ignores the extra dependency), so we
// always provide `FetchHttpClient.layer` — env snapshot alone decides which
// branch builds.
const withEnv = <A, E>(
	env: Record<string, string>,
	program: (provider: BookingProvider['Service']) => Effect.Effect<A, E>,
) =>
	Effect.runPromiseExit(
		Effect.gen(function* () {
			const provider = yield* BookingProvider
			return yield* program(provider)
		}).pipe(
			Effect.provide(
				BookingProviderLive.pipe(Layer.provide(FetchHttpClient.layer)),
			),
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

	it('should require CALENDAR_API_KEY when CALENDAR_PROVIDER=calcom', async () => {
		// GIVEN CALENDAR_PROVIDER=calcom but no CALENDAR_API_KEY in the env
		// WHEN the layer attempts to build the live cal.com adapter
		// THEN the boot fails with ConfigError — no silent fallback to a
		// placeholder or an unauthenticated client (memory
		// `feedback_explicit_env_vars`)
		const exit = await withEnv({ CALENDAR_PROVIDER: 'calcom' }, p =>
			p.listEventTypes(),
		)
		expect(exit._tag).toBe('Failure')
		if (exit._tag === 'Failure') {
			const failReason = exit.cause.reasons.find(Cause.isFailReason)
			expect(failReason).toBeDefined()
			const failure = failReason?.error as { _tag?: string } | undefined
			expect(failure?._tag).toBe('ConfigError')
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
