import { Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'

import { inMcpOrgScope, McpOrgScope } from './org-scope'

describe('inMcpOrgScope', () => {
	describe('when the request carries a way into the organization', () => {
		it('should run the work through it', async () => {
			// GIVEN a scope that records every piece of work it is handed
			const entered: Array<string> = []
			const scope = McpOrgScope.of({
				run: effect => {
					entered.push('scope')
					return effect as never
				},
			})

			// WHEN MCP work runs in it
			const result = await Effect.runPromise(
				inMcpOrgScope(Effect.succeed('done')).pipe(
					Effect.provideService(McpOrgScope, scope),
				),
			)

			// THEN the work ran inside the scope and gave its answer
			expect(entered).toEqual(['scope'])
			expect(result).toBe('done')
		})
	})

	describe('when nobody handed the request a scope', () => {
		it('should stop rather than run the work unscoped', async () => {
			// GIVEN no scope at all, as a request that skipped sign-in would have
			let ran = false
			const work = Effect.sync(() => {
				ran = true
			})

			// WHEN MCP work is asked to run
			const exit = await Effect.runPromiseExit(
				inMcpOrgScope(work) as Effect.Effect<void>,
			)

			// THEN it never ran, so it cannot read past row-level security
			expect(Exit.isFailure(exit)).toBe(true)
			expect(ran).toBe(false)
		})
	})
})
