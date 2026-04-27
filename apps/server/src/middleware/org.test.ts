import { describe, expect, it } from 'vitest'

import { OrgMiddlewareLive } from './org'

describe('OrgMiddlewareLive', () => {
	it('should be a Layer ready to provide OrgMiddleware', () => {
		// Sanity check that the module compiles and exports the expected
		// binding. End-to-end behaviour (Unauthorized / Forbidden / CurrentOrg
		// provision) is exercised by the Playwright golden-path suite once
		// the dev stack is signed in as alice/bob — that's where a regression
		// surfaces visibly, not in unit space.
		expect(OrgMiddlewareLive).toBeDefined()
		expect(typeof OrgMiddlewareLive).toBe('object')
	})
})
