import { describe, expect, it } from 'vitest'

import { COMPANY_INDUSTRIES, COMPANY_SIZE_RANGES } from '@batuda/domain'
import { CRM_INDUSTRIES, CRM_SIZE_RANGES } from '@batuda/research'

describe('CRM vocabulary', () => {
	describe('when the research package mirrors the domain company vocabulary', () => {
		it('should hold identical industry and size codes', () => {
			// The research vocabulary guard keeps its own copy of the CRM codes to
			// preserve the package's zero-workspace-dependency boundary. This bridges
			// the two packages (only apps/server sees both) and fails if an edit to
			// one is not mirrored in the other.
			expect([...CRM_INDUSTRIES].sort()).toEqual([...COMPANY_INDUSTRIES].sort())
			expect([...CRM_SIZE_RANGES].sort()).toEqual(
				[...COMPANY_SIZE_RANGES].sort(),
			)
		})
	})
})
