import { describe, expect, it } from 'vitest'

import {
	displayValue,
	fieldChanges,
	humanizeFieldKey,
	proposedChannels,
} from './field-diff'

describe('fieldChanges', () => {
	describe('when the record already holds a value for a proposed field', () => {
		it('should pair the proposed value with the current one', () => {
			// GIVEN a change proposing a new industry
			// WHEN the record already records an industry
			const changes = fieldChanges(
				{ industry: 'restaurants' },
				{ industry: 'hospitality' },
			)
			// THEN both sides travel together so the reader sees the replacement
			expect(changes).toEqual([
				{
					key: 'industry',
					from: 'hospitality',
					to: 'restaurants',
					unchanged: false,
				},
			])
		})
	})

	describe('when the record holds nothing for a proposed field', () => {
		it('should report the change as an addition', () => {
			// GIVEN a record with nothing on file for the field
			const changes = fieldChanges({ industry: 'restaurants' }, {})
			// THEN there is no previous value to show
			expect(changes[0]?.from).toBeNull()
			expect(changes[0]?.unchanged).toBe(false)
		})

		it('should treat a missing current record as an addition', () => {
			// GIVEN a change that would create a brand-new record
			const changes = fieldChanges({ industry: 'restaurants' }, null)
			expect(changes[0]?.from).toBeNull()
		})
	})

	describe('when the field name is written the other way round', () => {
		it('should still find the value the record holds', () => {
			// GIVEN a change naming the field in one style
			// WHEN the record names the same field in the other
			const changes = fieldChanges(
				{ currentTools: 'Notion' },
				{ current_tools: 'Excel' },
			)
			// THEN the previous value is found rather than reported as absent,
			// because both spellings are accepted when the change is applied
			expect(changes[0]?.from).toBe('Excel')
		})
	})

	describe('when the proposed value matches what is already there', () => {
		it('should mark it as no change', () => {
			const changes = fieldChanges({ country: 'ES' }, { country: 'ES' })
			expect(changes[0]?.unchanged).toBe(true)
		})
	})

	describe('when a value arrives wrapped with the page it came from', () => {
		it('should read the value out of the wrapper', () => {
			// GIVEN a value stored alongside its source
			const changes = fieldChanges(
				{ industry: { value: 'restaurants', source_id: 'src_1' } },
				{},
			)
			// THEN the reader sees the value, not the wrapper
			expect(changes[0]?.to).toBe('restaurants')
		})
	})

	describe('when fields are handled elsewhere on the row', () => {
		it('should leave out the name, contact points and owning company', () => {
			const changes = fieldChanges(
				{
					name: 'Rosa',
					channels: [{ kind: 'email', value: 'r@x.cat' }],
					company_id: 'abc',
					companyId: 'abc',
					industry: 'restaurants',
				},
				{},
			)
			expect(changes.map(c => c.key)).toEqual(['industry'])
		})
	})

	describe('when a proposed value is empty', () => {
		it('should skip it rather than show a blank change', () => {
			// GIVEN values that amount to nothing
			const changes = fieldChanges(
				{ a: null, b: undefined, c: '   ', d: [], e: {} },
				{},
			)
			// THEN none of them is offered as a change
			expect(changes).toEqual([])
		})
	})

	describe('when given something that is not a set of fields', () => {
		it('should return nothing', () => {
			// GIVEN shapes the server should never send
			for (const bad of [null, undefined, 'x', 3, []]) {
				expect(fieldChanges(bad, {})).toEqual([])
			}
		})
	})
})

describe('displayValue', () => {
	describe('when given a list', () => {
		it('should read it out as one line', () => {
			expect(displayValue(['a', 'b'])).toBe('a, b')
		})
	})

	describe('when given a number or a yes/no', () => {
		it('should show it rather than dropping it', () => {
			expect(displayValue(0)).toBe('0')
			expect(displayValue(false)).toBe('false')
		})
	})
})

describe('proposedChannels', () => {
	describe('when a change proposes ways to reach someone', () => {
		it('should list each with its checked status', () => {
			const channels = proposedChannels({
				channels: [
					{ kind: 'email', value: 'a@x.cat', verification: 'deliverable' },
					{ kind: 'phone', value: '+34 900' },
				],
			})
			expect(channels).toEqual([
				{ kind: 'email', value: 'a@x.cat', verification: 'deliverable' },
				{ kind: 'phone', value: '+34 900', verification: null },
			])
		})
	})

	describe('when an entry is malformed', () => {
		it('should skip it and keep the rest', () => {
			const channels = proposedChannels({
				channels: [null, { kind: 'email' }, { value: 'x@y.cat' }, 'nope', 3],
			})
			expect(channels).toEqual([])
		})
	})

	describe('when there are no contact points at all', () => {
		it('should return nothing', () => {
			expect(proposedChannels({})).toEqual([])
			expect(proposedChannels(null)).toEqual([])
			expect(proposedChannels({ channels: 'not a list' })).toEqual([])
		})
	})
})

describe('humanizeFieldKey', () => {
	describe('when a field name comes off the wire', () => {
		it('should read it as words however it was spelled', () => {
			expect(humanizeFieldKey('sizeRange')).toBe('Size range')
			expect(humanizeFieldKey('size_range')).toBe('Size range')
			expect(humanizeFieldKey('painPoints')).toBe('Pain points')
			expect(humanizeFieldKey('country')).toBe('Country')
		})
	})
})
