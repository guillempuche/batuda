import { describe, expect, it } from 'vitest'

import { normalizePaidActionTool } from './paid-action-tool'

describe('normalizePaidActionTool', () => {
	describe('when the tool is already a real paid tool', () => {
		it('should pass a canonical name through unchanged', () => {
			// GIVEN the two tools a follow-up can actually run
			// WHEN each is normalized
			// THEN it is returned unchanged
			expect(normalizePaidActionTool('registry_lookup')).toBe('registry_lookup')
			expect(normalizePaidActionTool('discover_contacts')).toBe(
				'discover_contacts',
			)
		})

		it('should accept a name with stray case or whitespace', () => {
			// GIVEN a real name the model wrote with different case or padding
			// WHEN it is normalized
			// THEN it resolves to the canonical lowercase name
			expect(normalizePaidActionTool('  Discover_Contacts ')).toBe(
				'discover_contacts',
			)
			expect(normalizePaidActionTool('REGISTRY_LOOKUP')).toBe('registry_lookup')
		})
	})

	describe('when the model invents a name for a real capability', () => {
		it('should coerce a contact-finding alias to discover_contacts', () => {
			// GIVEN the hallucinated names seen in practice for contact discovery —
			// email_finder is the one that shipped the bug this fixes
			// WHEN each is normalized
			// THEN it maps onto the real contact-discovery tool
			for (const alias of [
				'email_finder',
				'email_verifier',
				'contact_finder',
				'find_contacts',
				'hunter',
				'fullenrich',
				'enrichment',
			]) {
				expect(normalizePaidActionTool(alias)).toBe('discover_contacts')
			}
		})

		it('should coerce a registry alias to registry_lookup', () => {
			// GIVEN names the model uses for the registry lookup
			// WHEN each is normalized
			// THEN it maps onto the real registry tool
			for (const alias of ['registry', 'registry_search', 'company_registry']) {
				expect(normalizePaidActionTool(alias)).toBe('registry_lookup')
			}
		})
	})

	describe('when the tool matches nothing real', () => {
		it('should return null so the caller can reject it', () => {
			// GIVEN a name that names no real tool, or is not even a string
			// WHEN it is normalized
			// THEN there is no tool to run and it returns null
			expect(normalizePaidActionTool('teleport')).toBeNull()
			expect(normalizePaidActionTool('')).toBeNull()
			expect(normalizePaidActionTool(undefined)).toBeNull()
			expect(normalizePaidActionTool(null)).toBeNull()
			expect(normalizePaidActionTool(42)).toBeNull()
		})
	})
})
