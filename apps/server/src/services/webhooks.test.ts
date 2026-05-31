import { describe, expect, it } from 'vitest'

import { matchingEndpoints, type WebhookEndpoint } from './webhooks'

const endpoint = (
	url: string,
	events: ReadonlyArray<string>,
): WebhookEndpoint => ({ url, secret: null, events })

describe('matchingEndpoints', () => {
	describe('when an endpoint subscribed to the event', () => {
		it('should include it', () => {
			// GIVEN an endpoint subscribed to the fired event
			// [webhooks.ts — endpoints.filter(ep => ep.events.includes(event))]
			const endpoints = [endpoint('https://a', ['recording.uploaded'])]

			// WHEN matching that event
			const result = matchingEndpoints(endpoints, 'recording.uploaded')

			// THEN the endpoint is returned
			expect(result).toEqual(endpoints)
		})

		it('should include an endpoint subscribed to several events', () => {
			// GIVEN an endpoint subscribed to multiple events including the target
			const ep = endpoint('https://a', [
				'research.succeeded',
				'recording.uploaded',
			])

			// WHEN matching one of them
			const result = matchingEndpoints([ep], 'recording.uploaded')

			// THEN it is returned
			expect(result).toEqual([ep])
		})
	})

	describe('when an endpoint is not subscribed to the event', () => {
		it('should exclude an endpoint subscribed only to other events', () => {
			// GIVEN an endpoint subscribed to a different event
			const endpoints = [endpoint('https://a', ['research.succeeded'])]

			// WHEN matching an unsubscribed event
			const result = matchingEndpoints(endpoints, 'recording.uploaded')

			// THEN nothing is returned
			expect(result).toEqual([])
		})

		it('should exclude an endpoint with an empty subscription list', () => {
			// GIVEN an endpoint subscribed to nothing — an empty events array
			const endpoints = [endpoint('https://a', [])]

			// WHEN matching any event
			const result = matchingEndpoints(endpoints, 'recording.uploaded')

			// THEN it is excluded
			expect(result).toEqual([])
		})
	})

	describe('when several endpoints have mixed subscriptions', () => {
		it('should return only the subscribed ones, preserving order', () => {
			// GIVEN three endpoints, two of them subscribed to the target event
			const subscribedA = endpoint('https://a', ['recording.uploaded'])
			const unsubscribed = endpoint('https://b', ['research.failed'])
			const subscribedC = endpoint('https://c', ['x', 'recording.uploaded'])

			// WHEN matching the event
			const result = matchingEndpoints(
				[subscribedA, unsubscribed, subscribedC],
				'recording.uploaded',
			)

			// THEN only the subscribed endpoints come back, in input order
			expect(result).toEqual([subscribedA, subscribedC])
		})

		it('should return empty for an empty endpoint list', () => {
			// GIVEN no endpoints at all
			// WHEN matching any event
			const result = matchingEndpoints([], 'recording.uploaded')

			// THEN the result is empty
			expect(result).toEqual([])
		})
	})
})
