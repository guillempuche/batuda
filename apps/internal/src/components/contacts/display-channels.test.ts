import { describe, expect, it } from 'vitest'

import {
	channelHref,
	type DisplayChannel,
	narrowChannels,
	primaryEmailChannel,
} from './display-channels'

const channel = (over: Partial<Record<string, unknown>> = {}) => ({
	id: 'c1',
	kind: 'email',
	value: 'a@b.com',
	verification: 'deliverable',
	is_primary: true,
	status: 'unknown',
	status_reason: null,
	...over,
})

describe('narrowChannels', () => {
	describe('when given the json_agg channel array', () => {
		it('should map snake_case json keys to a typed channel', () => {
			// GIVEN one email channel with snake_case keys (is_primary, status_reason)
			// WHEN narrowed
			// THEN it reads the snake_case keys into camelCase fields
			const [c] = narrowChannels([
				channel({
					id: 'x',
					kind: 'email',
					value: 'pep@calpepfonda.cat',
					is_primary: true,
					status: 'bounced',
					status_reason: 'Permanent',
				}),
			])
			expect(c).toEqual<DisplayChannel>({
				id: 'x',
				kind: 'email',
				value: 'pep@calpepfonda.cat',
				verification: 'deliverable',
				isPrimary: true,
				status: 'bounced',
				statusReason: 'Permanent',
			})
		})

		it('should narrow an unrecognized status to unknown', () => {
			// GIVEN a channel whose status is not a known suppression value
			// THEN it falls back to 'unknown'
			const [c] = narrowChannels([channel({ status: 'weird' })])
			expect(c?.status).toBe('unknown')
		})

		it('should default missing optional fields', () => {
			// GIVEN a phone channel with no verification / status / status_reason
			// THEN verification + statusReason are null and status is unknown
			const [c] = narrowChannels([
				{ id: 'p', kind: 'phone', value: '+34 600', is_primary: false },
			])
			expect(c).toMatchObject({
				kind: 'phone',
				verification: null,
				isPrimary: false,
				status: 'unknown',
				statusReason: null,
			})
		})
	})

	describe('when given malformed input', () => {
		it('should return an empty list for a non-array', () => {
			// GIVEN the channels field is null (contact with no channels)
			// THEN narrowing yields an empty list, not a throw
			expect(narrowChannels(null)).toEqual([])
			expect(narrowChannels(undefined)).toEqual([])
			expect(narrowChannels('[]')).toEqual([])
		})

		it('should skip entries missing id / kind / value', () => {
			// GIVEN an array with a null, a non-object, and a row missing value
			// THEN only the well-formed rows survive
			const out = narrowChannels([
				null,
				42,
				{ id: 'a', kind: 'email' },
				channel({ id: 'ok' }),
			])
			expect(out).toHaveLength(1)
			expect(out[0]?.id).toBe('ok')
		})
	})
})

describe('primaryEmailChannel', () => {
	describe('when picking the send address', () => {
		it('should prefer the primary email channel', () => {
			// GIVEN two email channels, one flagged primary
			// THEN the primary one is chosen
			const channels = narrowChannels([
				channel({ id: 'a', value: 'second@x.com', is_primary: false }),
				channel({ id: 'b', value: 'primary@x.com', is_primary: true }),
			])
			expect(primaryEmailChannel(channels)?.value).toBe('primary@x.com')
		})

		it('should fall back to the first email when none is primary', () => {
			// GIVEN email channels with none marked primary
			// THEN the first email is chosen
			const channels = narrowChannels([
				channel({ id: 'a', value: 'first@x.com', is_primary: false }),
				channel({ id: 'b', value: 'second@x.com', is_primary: false }),
			])
			expect(primaryEmailChannel(channels)?.value).toBe('first@x.com')
		})

		it('should return undefined when there is no email channel', () => {
			// GIVEN only a phone channel
			// THEN there is no send address
			const channels = narrowChannels([
				channel({ id: 'p', kind: 'phone', value: '+34 600' }),
			])
			expect(primaryEmailChannel(channels)).toBeUndefined()
		})
	})
})

describe('channelHref', () => {
	describe('when the channel opens in the same tab', () => {
		it('should build a mailto link for email', () => {
			// GIVEN an email channel
			// THEN it links via mailto and stays on-page
			expect(channelHref('email', 'a@b.com')).toEqual({
				href: 'mailto:a@b.com',
				external: false,
			})
		})

		it('should build a tel link for phone', () => {
			// GIVEN a phone channel
			// THEN it links via tel and stays on-page
			expect(channelHref('phone', '+34 600 123')).toEqual({
				href: 'tel:+34 600 123',
				external: false,
			})
		})
	})

	describe('when the channel is a social handle', () => {
		it('should strip non-digits for a whatsapp wa.me link', () => {
			// GIVEN a whatsapp number with spaces and a +
			// THEN only the digits reach the wa.me path
			expect(channelHref('whatsapp', '+34 638 123 456').href).toBe(
				'https://wa.me/34638123456',
			)
		})

		it('should expand a bare x handle, dropping a leading @', () => {
			// GIVEN an x handle written as @name
			// THEN it expands to the profile URL without the @
			expect(channelHref('x', '@batuda').href).toBe('https://x.com/batuda')
		})

		it('should expand a bare instagram handle', () => {
			expect(channelHref('instagram', '@batuda').href).toBe(
				'https://instagram.com/batuda',
			)
		})

		it('should expand a bare linkedin handle to /in/', () => {
			expect(channelHref('linkedin', 'jane-doe').href).toBe(
				'https://www.linkedin.com/in/jane-doe',
			)
		})
	})

	describe('when the value is already a URL or an unknown kind', () => {
		it('should pass a full URL through for a known platform', () => {
			// GIVEN a linkedin value that is already a full URL
			// THEN it is used as-is, not double-prefixed
			expect(channelHref('linkedin', 'https://linkedin.com/in/x').href).toBe(
				'https://linkedin.com/in/x',
			)
		})

		it('should https-prefix a bare value for an unknown kind', () => {
			// GIVEN a website/bluesky/other channel with a bare host
			// THEN it becomes an external https link
			expect(channelHref('website', 'acme.com')).toEqual({
				href: 'https://acme.com',
				external: true,
			})
		})
	})
})
