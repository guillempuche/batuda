import { describe, expect, it } from 'vitest'

import { MAX_LOGGED_ASK_CHARS, whatTheCallAsked } from './tool-log-asked'

describe('whatTheCallAsked', () => {
	describe('when the call was a search', () => {
		it('should keep the words it searched', () => {
			// GIVEN a search call with its other parameters
			const params = {
				query: 'instal·ladors elèctrics Girona',
				limit: 10,
				recency_days: null,
				country: 'ES',
			}

			// THEN only the query is kept
			expect(whatTheCallAsked('web_search', params)).toEqual({
				query: 'instal·ladors elèctrics Girona',
			})
		})

		it('should cut a very long query', () => {
			// GIVEN a query far past the log's limit
			const query = 'gremi '.repeat(100)

			// WHEN read
			const asked = whatTheCallAsked('web_search', { query })

			// THEN it is cut and marked as cut
			expect(asked.query).toHaveLength(MAX_LOGGED_ASK_CHARS + 1)
			expect(asked.query?.endsWith('…')).toBe(true)
		})
	})

	describe('when the call opened a page', () => {
		it('should keep the address', () => {
			expect(
				whatTheCallAsked('scrape_page', { url: 'https://elgremi.example/' }),
			).toEqual({ url: 'https://elgremi.example/' })
		})
	})

	describe('when the call names a company or a person', () => {
		it('should keep nothing', () => {
			// GIVEN the two paid lookups
			expect(
				whatTheCallAsked('registry_lookup', { name: 'Acme SL', country: 'ES' }),
			).toEqual({})
			expect(
				whatTheCallAsked('discover_contacts', { domain: 'acme.example' }),
			).toEqual({})
		})
	})

	describe('when the parameters are not what the tool takes', () => {
		it('should keep nothing', () => {
			// GIVEN a missing, blank, mistyped and shapeless ask
			expect(whatTheCallAsked('web_search', {})).toEqual({})
			expect(whatTheCallAsked('web_search', { query: '   ' })).toEqual({})
			expect(whatTheCallAsked('web_search', { query: 7 })).toEqual({})
			expect(whatTheCallAsked('scrape_page', null)).toEqual({})
			expect(whatTheCallAsked('scrape_page', 'https://x.example')).toEqual({})
		})
	})
})
