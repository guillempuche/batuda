import { Atom } from 'effect/unstable/reactivity'
import { describe, expect, it } from 'vitest'

import { companyIndustriesAtom } from './company-industries-atoms'

describe('company industries atom', () => {
	describe('when the signed-in layout hands its value from the server to the browser', () => {
		it('should be serializable, so the handover does not throw', () => {
			// GIVEN the atom every company card reads for its trade label
			// WHEN it is checked for a serialization key
			// THEN it has one — without it the layout loader throws on the
			// handover and every signed-in page comes up broken
			expect(Atom.isSerializable(companyIndustriesAtom)).toBe(true)
		})

		it('should keep its key through being kept alive', () => {
			// GIVEN the atom is wrapped to stay alive across screens
			// WHEN its key is read
			// THEN it is the query's own key, not lost in the wrapping
			expect(
				Atom.isSerializable(companyIndustriesAtom) &&
					companyIndustriesAtom[Atom.SerializableTypeId].key,
			).toContain('companyIndustries:list')
		})
	})
})
