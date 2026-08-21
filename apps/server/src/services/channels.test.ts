import { describe, expect, it } from 'vitest'

import { clampConfidence, splitCompanyChannelFields } from './channels'

describe('clampConfidence', () => {
	describe('when the value is a 0–1 fraction (the research model scale)', () => {
		it('should scale it up to the 0–100 whole number the column stores', () => {
			// GIVEN a fractional confidence the model emits
			// THEN it becomes a rounded 0–100 score, not a coerced 0/1
			expect(clampConfidence(0.85)).toBe(85)
			expect(clampConfidence(0.5)).toBe(50)
			expect(clampConfidence(1)).toBe(100)
			expect(clampConfidence(0)).toBe(0)
		})
	})

	describe('when the value already uses the 0–100 scale (enrichment/verification)', () => {
		it('should keep it, rounded to a whole number', () => {
			// GIVEN a score a vendor already reports on 0–100
			expect(clampConfidence(90)).toBe(90)
			expect(clampConfidence(87.4)).toBe(87)
			expect(clampConfidence(87.6)).toBe(88)
		})
	})

	describe('when the value sits on the boundary between the two scales', () => {
		it('should treat exactly 1 as a full fraction and just above 1 as a score', () => {
			// GIVEN 1, the top of the fraction range
			expect(clampConfidence(1)).toBe(100)
			// GIVEN a whole-number score at the ceiling
			expect(clampConfidence(100)).toBe(100)
		})
	})

	describe('when the value falls outside 0–100', () => {
		it('should clamp it into range', () => {
			// GIVEN a score above the ceiling
			expect(clampConfidence(150)).toBe(100)
			// GIVEN a negative fraction (scaled below the floor)
			expect(clampConfidence(-0.2)).toBe(0)
		})
	})

	describe('when there is no usable number', () => {
		it('should return null so the column stays empty', () => {
			// GIVEN a missing or non-finite confidence
			expect(clampConfidence(null)).toBeNull()
			expect(clampConfidence(undefined)).toBeNull()
			expect(clampConfidence(Number.NaN)).toBeNull()
			expect(clampConfidence(Number.POSITIVE_INFINITY)).toBeNull()
			expect(clampConfidence(Number.NEGATIVE_INFINITY)).toBeNull()
		})
	})
})

describe('splitCompanyChannelFields', () => {
	describe('when the write names ways of reaching the company', () => {
		it('should take the named ones off the columns and store them as addresses', () => {
			// GIVEN a write holding a column and the mailbox that used to be one
			// WHEN split
			// THEN the column stays a column and the mailbox becomes an address, marked
			// as the one to use — it is the only email the caller gave
			const { columns, channels } = splitCompanyChannelFields({
				name: 'Acme',
				email: 'info@acme.com',
			})
			expect(columns).toEqual({ name: 'Acme' })
			expect(channels).toEqual([
				{ kind: 'email', value: 'info@acme.com', is_primary: true },
			])
		})

		it('should store each page a company keeps on a platform', () => {
			// GIVEN the list a run fills for a company with no site of its own
			// WHEN split
			// THEN each page becomes an address under its own platform, and none of
			// them lands in a column
			const { columns, channels } = splitCompanyChannelFields({
				name: 'LIPOTECH SARL',
				socialProfiles: [
					{ kind: 'facebook', value: 'https://facebook.com/LIPOTECH.SARL' },
					{ kind: 'tiktok', value: 'https://tiktok.com/@lipotech' },
				],
			})
			expect(columns).toEqual({ name: 'LIPOTECH SARL' })
			expect(channels).toEqual([
				{ kind: 'facebook', value: 'https://facebook.com/LIPOTECH.SARL' },
				{ kind: 'tiktok', value: 'https://tiktok.com/@lipotech' },
			])
		})

		it('should read the list under the name a research proposal uses', () => {
			// GIVEN the same list spelled the way a model writes it, which is how it
			// arrives on a proposal rather than from a typed client
			// WHEN split — THEN the same addresses, so which door a write came through
			// cannot change what is stored
			const { columns, channels } = splitCompanyChannelFields({
				social_profiles: [
					{ kind: 'facebook', value: 'https://facebook.com/acme' },
				],
			})
			expect(columns).toEqual({})
			expect(channels).toEqual([
				{ kind: 'facebook', value: 'https://facebook.com/acme' },
			])
		})

		it('should not mark a page as the one to use for its kind', () => {
			// GIVEN one page on a platform
			// WHEN split
			// THEN no mark is put down. A company has one page per platform, so the
			// mark says nothing — and putting it down would hand it to whichever page
			// arrived last if a company ever had two
			const { channels } = splitCompanyChannelFields({
				socialProfiles: [{ kind: 'facebook', value: 'https://facebook.com/a' }],
			})
			expect(channels[0]).not.toHaveProperty('is_primary')
		})
	})

	describe('when the list holds something that is not a page', () => {
		it('should step over an entry missing its platform or its address', () => {
			// GIVEN a list with entries that say nothing usable
			// WHEN split
			// THEN only the whole ones are stored, and the write is not refused over
			// them: these come out of a model's free-form answer, and a found address
			// is the part worth having
			const { channels } = splitCompanyChannelFields({
				socialProfiles: [
					{ kind: 'facebook' },
					{ value: 'https://facebook.com/a' },
					{ kind: '', value: 'https://facebook.com/b' },
					{ kind: 'facebook', value: '   ' },
					'not an object',
					null,
					{ kind: 'facebook', value: 'https://facebook.com/good' },
				],
			})
			expect(channels).toEqual([
				{ kind: 'facebook', value: 'https://facebook.com/good' },
			])
		})

		it('should step over a value that is not a list at all', () => {
			// GIVEN the field holding something that was never a list
			// WHEN split — THEN nothing is stored and nothing is put in a column,
			// since the field is not one the row has
			const { columns, channels } = splitCompanyChannelFields({
				socialProfiles: 'https://facebook.com/acme',
			})
			expect(columns).toEqual({})
			expect(channels).toEqual([])
		})

		it('should trim what it stores, leaving the folding to the write', () => {
			// GIVEN an entry copied with space around it and a capitalised platform
			// WHEN split
			// THEN the space is gone, because it is not part of anybody's address —
			// while the capital is left alone, since a kind is folded once where it is
			// written and doing it here as well would be a second place to keep right
			const { channels } = splitCompanyChannelFields({
				socialProfiles: [
					{ kind: '  Facebook  ', value: '  https://facebook.com/a  ' },
				],
			})
			expect(channels).toEqual([
				{ kind: 'Facebook', value: 'https://facebook.com/a' },
			])
		})
	})
})
