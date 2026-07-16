import { describe, expect, it } from 'vitest'

import {
	SNAPSHOT_COMPANY_FIELDS,
	SNAPSHOT_CONTACT_FIELDS,
} from '@batuda/research'

import { COMPANY_FIELDS, CONTACT_FIELDS } from './research-apply'

describe('research snapshot projection', () => {
	describe('when a run is shown a company or contact it already holds', () => {
		it('should show only fields the apply path can write back', () => {
			// The research package chooses a narrow set of columns to show a run of a
			// subject on file, so it can propose a correction. Every one must be a
			// field the apply path accepts — showing a value that can never be written
			// would only invite a proposal that silently does nothing. Only apps/server
			// sees both the projection and the write allowlist, so this bridge fails if
			// an edit to one is not matched in the other.
			for (const field of SNAPSHOT_COMPANY_FIELDS) {
				expect(COMPANY_FIELDS.has(field)).toBe(true)
			}
			for (const field of SNAPSHOT_CONTACT_FIELDS) {
				expect(CONTACT_FIELDS.has(field)).toBe(true)
			}
		})
	})
})
