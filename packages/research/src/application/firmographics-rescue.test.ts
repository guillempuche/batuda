import { describe, expect, it } from 'vitest'

import {
	mergeFirmographics,
	needsFirmographicsRescue,
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
