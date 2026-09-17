import { describe, expect, it } from 'vitest'

import { mergePerFieldSearch } from './per-field-search'
import { runWordsOf } from './run-words'

const noRunWords = runWordsOf([])
const COMPANY = '11111111-1111-4111-8111-111111111111'
const update = (id: string, fields: Record<string, unknown>) => ({
	id,
	status: 'pending',
	subject_table: 'companies',
	operation: 'update',
	subject_id: COMPANY,
	fields,
	citations: [{ source_id: 'https://acme.es', quote: 'Acme, Terrassa' }],
})
const proposals = (findings: unknown): ReadonlyArray<string> =>
	(
		findings as { proposed_updates: Array<{ id: string }> }
	).proposed_updates.map(proposal => proposal.id)

describe('mergePerFieldSearch, when a wider read hands back news for the CRM', () => {
	it('should carry a proposal the round made onto the list, and leave one the list already says', () => {
		// GIVEN a first pass that proposed a location, and a round that filled
		// the email, proposed the same location under a fresh id and the email
		// as well
		const findings = {
			enrichment: { location: 'Terrassa' },
			proposed_updates: [update('first-location', { location: 'Terrassa' })],
		}
		const refreshed = {
			enrichment: { location: 'Terrassa', email: 'info@acme.es' },
			proposed_updates: [
				update('round-location', { location: 'Terrassa' }),
				update('round-email', { email: 'info@acme.es' }),
			],
			pending_paid_actions: [
				{
					id: 'a1',
					status: 'pending',
					tool: 'discover_contacts',
					args: 'acme',
				},
			],
		}
		// WHEN folded
		const result = mergePerFieldSearch(
			findings,
			refreshed,
			'company_enrichment_v1',
			noRunWords,
		)
		// THEN the email's proposal rides with the email, the location's is not
		// doubled, and the paid follow-up the round asked for is there to approve
		expect(proposals(result.findings)).toEqual([
			'first-location',
			'round-email',
		])
		expect(
			(
				result.findings as { pending_paid_actions: Array<{ tool: string }> }
			).pending_paid_actions.map(action => action.tool),
		).toEqual(['discover_contacts'])
	})

	it('should carry the news even when the round filled no field', () => {
		// GIVEN a round that read nothing new for the profile but proposed a write
		const findings = { enrichment: { location: 'Terrassa' } }
		const refreshed = {
			enrichment: { location: 'Terrassa' },
			proposed_updates: [update('round-email', { email: 'info@acme.es' })],
		}
		// WHEN folded
		const result = mergePerFieldSearch(
			findings,
			refreshed,
			'company_enrichment_v1',
			noRunWords,
		)
		// THEN the proposal is on the list
		expect(proposals(result.findings)).toEqual(['round-email'])
	})

	it('should hand the findings back as they were when the round brought no news', () => {
		// GIVEN a round that repeats what the list holds
		const findings = {
			enrichment: { location: 'Terrassa' },
			proposed_updates: [update('first-location', { location: 'Terrassa' })],
		}
		const refreshed = {
			enrichment: { location: 'Terrassa' },
			proposed_updates: [update('again', { location: 'Terrassa' })],
		}
		// WHEN folded
		const result = mergePerFieldSearch(
			findings,
			refreshed,
			'company_enrichment_v1',
			noRunWords,
		)
		// THEN the same object comes back
		expect(result.findings).toBe(findings)
	})

	it('should keep two people a round proposes as new, who share every field name', () => {
		// GIVEN a round that offers two new contacts, each with a name and a
		// title and no subject of their own
		const create = (id: string, full_name: string) => ({
			id,
			status: 'pending',
			subject_table: 'contacts',
			operation: 'create',
			fields: { full_name, job_title: 'Gerente' },
			citations: [{ source_id: 'https://acme.es/equipo', quote: full_name }],
		})
		const findings = { enrichment: { location: 'Terrassa' } }
		const refreshed = {
			enrichment: { location: 'Terrassa' },
			proposed_updates: [
				create('one', 'Ana Puig'),
				create('two', 'Marc Vidal'),
			],
		}
		// WHEN folded
		const result = mergePerFieldSearch(
			findings,
			refreshed,
			'company_enrichment_v1',
			noRunWords,
		)
		// THEN both are on the list
		expect(proposals(result.findings)).toEqual(['one', 'two'])
	})
})
