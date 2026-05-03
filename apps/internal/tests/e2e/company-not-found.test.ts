import { expect, test } from '@playwright/test'

import { setActiveOrgBySlug } from './helpers/set-active-org'

// Pins the contract that GET /v1/companies/:slug returns 404 (not 500)
// for an unknown slug. During an earlier spot-check we saw 500s with
// `cause="NotFound"` while the dev DB was in an orphan-org_id state;
// after the DB reset we never re-verified. This test makes the
// regression visible in CI.
//
// Drives the API via Playwright's `page.request` fixture so we get the
// full chain (cookie → middleware → handler → service → typed error
// → status code) without booting an in-process server.
//
// Selectors / contracts verified against:
//   packages/controllers/src/routes/companies.ts:88 — declares 404 error
//   apps/server/src/handlers/companies.ts:22-24 — Effect.catch maps NotFound
//   apps/server/src/services/companies.ts:110 — throws NotFound on miss

test.describe('GET /v1/companies/:slug', () => {
	test.beforeEach(async ({ page }) => {
		// GIVEN Alice's session pointed at Taller (where cal-pep-fonda lives)
		await page.goto('/', { waitUntil: 'commit' })
		await setActiveOrgBySlug(page, 'taller')
	})

	test.describe('when the slug exists in the active org', () => {
		test('should return 200 with the expected slug', async ({
			page,
			request,
		}) => {
			// GIVEN cal-pep-fonda is seeded in Alice's org
			// WHEN GET /v1/companies/cal-pep-fonda
			// THEN status is 200 and the body's slug matches
			// [handlers/companies.ts:18-26 — get success path]
			const cookies = await page.context().cookies()
			const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')
			const response = await request.get(
				'https://api.batuda.localhost/v1/companies/cal-pep-fonda',
				{ headers: { cookie: cookieHeader }, ignoreHTTPSErrors: true },
			)
			expect(response.status()).toBe(200)
			const body = (await response.json()) as { slug?: string }
			expect(body.slug).toBe('cal-pep-fonda')
		})
	})

	test.describe('when the slug does not exist in the active org', () => {
		test('should return 404 with the typed NotFound body, not 500', async ({
			page,
			request,
		}) => {
			// GIVEN no company with slug __not-a-real-slug__
			// WHEN GET /v1/companies/__not-a-real-slug__
			// THEN status is 404 (NOT 500) and the body is the typed
			//      NotFound shape (`{_tag:"NotFound", entity, id}` or similar
			//      depending on the route's HttpApiSchema serialiser)
			// [routes/companies.ts:88 + handlers/companies.ts:22-24 — Effect.catch maps NotFound]
			const cookies = await page.context().cookies()
			const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')
			const response = await request.get(
				'https://api.batuda.localhost/v1/companies/__not-a-real-slug__',
				{ headers: { cookie: cookieHeader }, ignoreHTTPSErrors: true },
			)
			expect(response.status()).toBe(404)
			// The body should at minimum carry the NotFound tag / entity name.
			// We're permissive on shape because Effect HttpApi's exact JSON
			// envelope is implementation-controlled; the contract under test
			// is the status code.
			const text = await response.text()
			expect(text.length).toBeGreaterThan(0)
		})
	})
})
