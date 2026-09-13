import { describe, expect, it } from 'vitest'

import {
	hasHeadcountSignal,
	mergeSizeRescue,
	needsSizeRescue,
	sizeRescuePrompt,
} from './size-rescue'

const sized = (value: string) => ({
	value,
	source_id: 'https://acme.com',
	confidence: null,
})

describe('needsSizeRescue', () => {
	describe('when the size band is missing or blanked', () => {
		it('should rescue', () => {
			// GIVEN no enrichment at all, an empty one, and a band a guard blanked
			expect(needsSizeRescue({})).toBe(true)
			expect(needsSizeRescue({ enrichment: {} })).toBe(true)
			expect(
				needsSizeRescue({ enrichment: { size_range: { value: null } } }),
			).toBe(true)
			// AND other fields present do not stand in for the band
			expect(
				needsSizeRescue({ enrichment: { industry: sized('logistics') } }),
			).toBe(true)
		})
	})

	describe('when the size band is present', () => {
		it('should not rescue', () => {
			expect(
				needsSizeRescue({ enrichment: { size_range: sized('51-200') } }),
			).toBe(false)
		})
	})
})

describe('mergeSizeRescue', () => {
	describe('when the broad pass left the band empty', () => {
		it('should fill it from the rescue and leave the other fields alone', () => {
			// GIVEN a grounded industry and no band
			const findings = { enrichment: { industry: sized('logistics') } }

			// WHEN merged with a rescued band
			const result = mergeSizeRescue(findings, {
				size_range: sized('501-1000'),
			})

			// THEN the band is filled beside the industry
			const enrichment = (
				result.findings as { enrichment: Record<string, { value: unknown }> }
			).enrichment
			expect(enrichment['size_range']?.value).toBe('501-1000')
			expect(enrichment['industry']?.value).toBe('logistics')
			expect(result.filled).toBe(1)
		})
	})

	describe('when the broad pass already grounded a band', () => {
		it('should keep it and count nothing filled', () => {
			// GIVEN a band the broad pass found
			const findings = { enrichment: { size_range: sized('51-200') } }

			// WHEN merged with a rescue that says otherwise
			const result = mergeSizeRescue(findings, { size_range: sized('9-9') })

			// THEN the findings come back untouched
			expect(result.filled).toBe(0)
			expect(result.findings).toBe(findings)
		})
	})

	describe('when the rescue found nothing, or there is nothing to merge into', () => {
		it('should return the findings unchanged', () => {
			// GIVEN an empty rescue, a blanked rescue, and findings with no enrichment
			const findings = { enrichment: {} }
			expect(mergeSizeRescue(findings, {}).filled).toBe(0)
			expect(mergeSizeRescue(findings, undefined).filled).toBe(0)
			expect(
				mergeSizeRescue(findings, { size_range: { value: null } }).filled,
			).toBe(0)
			expect(mergeSizeRescue({}, { size_range: sized('10') }).findings).toEqual(
				{},
			)
		})
	})
})

describe('hasHeadcountSignal', () => {
	describe('when the text states a headcount', () => {
		it('should detect a number next to an employee word', () => {
			expect(hasHeadcountSignal('The company has 624 employees.')).toBe(true)
			expect(hasHeadcountSignal('We employ over 500 people worldwide')).toBe(
				true,
			)
			expect(hasHeadcountSignal('a team of 250 across three sites')).toBe(true)
		})

		it('should detect it in Spanish and Catalan phrasing', () => {
			expect(hasHeadcountSignal('cuenta con 80 empleados')).toBe(true)
			expect(hasHeadcountSignal('una plantilla de 120 persones')).toBe(true)
		})
	})

	describe('when a number is present but is not a headcount', () => {
		it('should ignore carrier, customer, and equipment counts', () => {
			expect(hasHeadcountSignal('300 strategic carriers')).toBe(false)
			expect(hasHeadcountSignal('serving 5,000 customers')).toBe(false)
			expect(hasHeadcountSignal('75 power units and 200 trailers')).toBe(false)
		})
	})

	describe('when no number sits near an employee word', () => {
		it('should return false for prose and empty text', () => {
			expect(hasHeadcountSignal('our dedicated employees deliver')).toBe(false)
			expect(hasHeadcountSignal('')).toBe(false)
		})
	})
})

describe('sizeRescuePrompt', () => {
	const target = { name: 'Acme', domain: 'acme.com' }

	describe('when a source manifest is supplied', () => {
		it('should ask for the headcount alone and list the exact URLs to cite', () => {
			const prompt = sizeRescuePrompt(
				target,
				'evidence here',
				'https://acme.com/\nhttps://linkedin.com/company/acme',
			)
			expect(prompt).toContain('how many people it employs')
			expect(prompt).toContain('size_range')
			expect(prompt).toContain('https://linkedin.com/company/acme')
			expect(prompt).toContain('copied verbatim')
			expect(prompt).toContain('evidence here')
			expect(prompt).toContain('official site acme.com')
		})
	})

	describe('when no source manifest is supplied', () => {
		it('should fall back to a generic citation instruction and steer off the homepage', () => {
			const prompt = sizeRescuePrompt({ name: 'Acme' }, 'evidence here')
			expect(prompt).toContain('the exact source URL it came from')
			expect(prompt).toContain('third-party')
			expect(prompt).not.toContain('official site')
		})
	})
})
