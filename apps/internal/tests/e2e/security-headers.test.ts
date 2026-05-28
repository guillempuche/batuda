import { expect, test } from '@playwright/test'

// The app-wide frame-deny guard (src/start.ts) has to ride on every rendered
// document, so no other site can frame a Batuda page and trick a signed-in
// person into a click. The OAuth consent screen is the highest-value target —
// assert there, on a route that renders standalone without an active org.

test.describe('security headers', () => {
	test('should forbid other sites from framing a rendered page', async ({
		page,
	}) => {
		// GIVEN any rendered document (the consent screen, a prime clickjacking
		// target)
		// WHEN it loads
		const response = await page.goto('/oauth/consent', { waitUntil: 'commit' })

		// THEN the response refuses framing from anywhere, via both the new and old headers
		const headers = response?.headers() ?? {}
		expect(headers['content-security-policy']).toContain(
			"frame-ancestors 'none'",
		)
		expect(headers['x-frame-options']).toBe('DENY')
	})
})
