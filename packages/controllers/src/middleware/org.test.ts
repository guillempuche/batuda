import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { CurrentOrg, OrgMiddleware } from './org'

describe('CurrentOrg', () => {
	it('should expose a stable identifier so HTTP and MCP middlewares share one tag', () => {
		// GIVEN the CurrentOrg ServiceMap.Service tag
		// WHEN the static key is read
		// THEN it is the literal string "CurrentOrg"
		// AND distinct providers in different processes (HTTP vs MCP) collide on
		// the same identity, so service-layer reads do not need to know which
		// transport answered the request
		expect(CurrentOrg.key).toBe('CurrentOrg')
	})

	it('should round-trip the { id, name, slug } shape through Layer.succeed', () =>
		Effect.runPromise(
			Effect.gen(function* () {
				// GIVEN a Layer.succeed(CurrentOrg, { id, name, slug })
				// WHEN an Effect yields the tag
				// THEN the resolved value preserves every field verbatim
				const org = yield* CurrentOrg
				expect(org).toEqual({
					id: 'org_alpha',
					name: 'Alpha',
					slug: 'alpha',
				})
			}).pipe(
				Effect.provide(
					Layer.succeed(CurrentOrg, {
						id: 'org_alpha',
						name: 'Alpha',
						slug: 'alpha',
					}),
				),
			),
		))
})

describe('OrgMiddleware', () => {
	it('should expose a stable identifier so it can be referenced from route groups', () => {
		// GIVEN the OrgMiddleware HttpApiMiddleware.Service tag
		// WHEN the static key is read
		// THEN it is the literal string "OrgMiddleware"
		// AND route groups in @batuda/controllers can chain `.middleware(OrgMiddleware)`
		// without importing the apps/server runtime that implements it
		expect(OrgMiddleware.key).toBe('OrgMiddleware')
	})
})
