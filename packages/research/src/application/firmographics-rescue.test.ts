import { describe, expect, it } from 'vitest'

import {
	firmographicsRescuePrompt,
	hasHeadcountSignal,
	mergeFirmographics,
	needsFirmographicsRescue,
	needsSizeRescue,
	sizeRescuePrompt,
} from './firmographics-rescue'

const sized = (value: string) => ({
	value,
	source_id: 'https://acme.com',
	confidence: null,
})

describe('needsFirmographicsRescue', () => {
	describe('when a firmographic field is empty', () => {
		it('should rescue when both are missing', () => {
			expect(needsFirmographicsRescue({ enrichment: {} })).toBe(true)
			expect(needsFirmographicsRescue({})).toBe(true)
		})

		it('should rescue when only one is present', () => {
			// GIVEN size present but tools missing
			expect(
				needsFirmographicsRescue({
					enrichment: { size_range: sized('51-200') },
				}),
			).toBe(true)
		})

		it('should treat a blanked value as still missing', () => {
			// GIVEN a value a guard blanked to null
			expect(
				needsFirmographicsRescue({
					enrichment: {
						size_range: sized('51-200'),
						current_tools: { value: null },
					},
				}),
			).toBe(true)
		})
	})

	describe('when both firmographics are present', () => {
		it('should not rescue', () => {
			expect(
				needsFirmographicsRescue({
					enrichment: {
						size_range: sized('51-200'),
						current_tools: sized('SAP TMS'),
					},
				}),
			).toBe(false)
		})
	})
})

describe('mergeFirmographics', () => {
	describe('when the broad pass left a field empty', () => {
		it('should fill it from the rescue without overwriting a grounded value', () => {
			// GIVEN the broad pass grounded tools but not size
			const findings = {
				enrichment: { current_tools: sized('TransportPro') },
			}
			const rescued = {
				size_range: sized('501-1000'),
				current_tools: sized('SomethingElse'),
			}

			// WHEN merged
			const result = mergeFirmographics(findings, rescued)

			// THEN size is filled; the already-grounded tools value is kept
			const enrichment = (
				result.findings as {
					enrichment: Record<string, { value: unknown }>
				}
			).enrichment
			expect(enrichment['size_range']?.value).toBe('501-1000')
			expect(enrichment['current_tools']?.value).toBe('TransportPro')
			expect(result.filled).toBe(1)
		})
	})

	describe('when the rescue found nothing new', () => {
		it('should return the findings unchanged', () => {
			// GIVEN both already present
			const findings = {
				enrichment: {
					size_range: sized('51-200'),
					current_tools: sized('SAP'),
				},
			}

			// WHEN merged with a rescue that only repeats them
			const result = mergeFirmographics(findings, { size_range: sized('9-9') })

			// THEN nothing filled
			expect(result.filled).toBe(0)
			expect(result.findings).toBe(findings)
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

describe('firmographicsRescuePrompt', () => {
	const target = { name: 'Acme', domain: 'acme.com' }

	describe('when a source manifest is supplied', () => {
		it('should list the exact URLs for the model to cite', () => {
			const prompt = firmographicsRescuePrompt(
				target,
				'evidence here',
				'https://acme.com/\nhttps://linkedin.com/company/acme',
			)
			expect(prompt).toContain('https://linkedin.com/company/acme')
			expect(prompt).toContain('copied verbatim')
			expect(prompt).toContain('evidence here')
			expect(prompt).toContain('size_range')
		})
	})

	describe('when no source manifest is supplied', () => {
		it('should fall back to a generic citation instruction and steer off-homepage', () => {
			const prompt = firmographicsRescuePrompt(target, 'evidence here')
			expect(prompt).toContain('the exact source URL it came from')
			expect(prompt).toContain('third-party')
		})
	})
})

describe('needsSizeRescue', () => {
	describe('when the size band is missing or blanked', () => {
		it('should rescue', () => {
			expect(needsSizeRescue({ enrichment: {} })).toBe(true)
			expect(needsSizeRescue({})).toBe(true)
			expect(
				needsSizeRescue({ enrichment: { size_range: { value: null } } }),
			).toBe(true)
			// tools present but size missing still needs the focused size pass
			expect(
				needsSizeRescue({ enrichment: { current_tools: sized('SAP TMS') } }),
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

describe('sizeRescuePrompt', () => {
	const target = { name: 'Acme', domain: 'acme.com' }

	describe('when building the size-only prompt', () => {
		it('should ask for the headcount alone and cite the manifest', () => {
			const prompt = sizeRescuePrompt(
				target,
				'evidence here',
				'https://acme.com/\nhttps://linkedin.com/company/acme',
			)
			expect(prompt).toContain('how many people it employs')
			expect(prompt).toContain('size_range')
			expect(prompt).toContain('https://linkedin.com/company/acme')
			expect(prompt).toContain('evidence here')
			// single-purpose: it must NOT ask for tools
			expect(prompt).not.toContain('current_tools')
		})

		it('should fall back to a generic citation without a manifest', () => {
			const prompt = sizeRescuePrompt(target, 'evidence here')
			expect(prompt).toContain('the exact source URL it came from')
		})
	})
})
