import { expect, test } from '@playwright/test'

// Cross-org isolation in the UI. Bob is a member of restaurant only —
// the org switcher should not surface taller, and the seed's taller-only
// data (e.g. cal-pep-fonda company) should be unreachable. This test
// signs Bob in directly rather than reusing Alice's storageState because
// the assertion is precisely "what does a user who *isn't* in taller
// see?".
//
// Selectors verified against:
//   apps/internal/src/components/layout/org-switcher.tsx
//     (org-switcher, org-switcher-option-{slug})
//   apps/internal/src/routes/login.tsx
//     (login-email, login-password, login-submit)

// Override the project's `storageState: alice.json` for this file —
// otherwise Bob's "fresh" context inherits Alice's cookies and `/login`'s
// beforeLoad bounces us straight to the dashboard before we can fill the
// form. Empty storageState forces a logged-out start.
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('cross-org isolation', () => {
	test.describe('when Bob signs in (member of restaurant only)', () => {
		// One test instead of one-per-assertion: signing in trips Better
		// Auth's per-endpoint sign-in rate limit (~3/10s) when stacked
		// against the other suites' sign-ins. The shared setup cost
		// dominates, so we group the two read-only observations into a
		// single scenario.
		test('should hide Taller from the switcher and refuse Taller-only data', async ({
			page,
		}) => {
			// GIVEN Bob signs in successfully (no Alice cookie thanks to the
			// file-scoped storageState override)
			await page.goto('/login')
			await page.getByTestId('login-email').fill('admin@restaurant.demo')
			await page.getByTestId('login-password').fill('batuda-dev-2026')
			await page.getByTestId('login-submit').click()
			await page.waitForURL(/\/$/)
			// AND the active-org indicator hydrates to "Restaurant Demo"
			// (Better Auth's auto-set-active fires for single-org users)
			await expect(page.getByTestId('active-org-name')).toContainText(
				'Restaurant Demo',
				{ timeout: 10_000 },
			)

			// THEN the switcher must NOT surface the Taller option (the
			// read-only chip renders for single-org users, no dropdown)
			await expect(page.getByTestId('org-switcher-option-taller')).toHaveCount(
				0,
			)

			// AND a direct navigation to a Taller-only company URL must not
			// render the page — RLS hides the row at the data layer and
			// the route falls through to its not-found / loading state
			await page.goto('/companies/cal-pep-fonda', { waitUntil: 'networkidle' })
			await expect(page.locator('body')).not.toContainText('Cal Pep Fonda')
		})
	})
})
