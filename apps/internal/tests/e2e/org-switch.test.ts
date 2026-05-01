import { expect, test } from '@playwright/test'

import { setActiveOrgBySlug } from './helpers/set-active-org'

// Org switcher in the TopBar drives the session.activeOrganizationId
// cookie via Better Auth's setActive endpoint. After the mutation the
// router cache invalidates and the page navigates back to /. Selectors
// verified against:
//   apps/internal/src/components/layout/org-switcher.tsx
//     (org-switcher, org-switcher-option-{slug}, active-org-name)
//
// Auth: this test runs in the `authed` project — Alice (taller owner +
// restaurant member) is the storageState seed, so the dropdown shows
// both orgs.

// `setActive` mutates `session.activeOrganizationId` on the DB row that
// the storageState cookie points at — so a test that flips Alice to
// Restaurant leaks that state to the next file in the run. Reset to
// Taller after every test so downstream tests (and quick-capture, which
// only has companies seeded under Taller) start from a known active org.
test.afterEach(async ({ page }) => {
	if (!page.url().startsWith('http')) return
	await setActiveOrgBySlug(page, 'taller')
})

test.describe('org switcher', () => {
	test.describe('when a multi-org user opens the switcher', () => {
		test('should list every membership with the active one marked', async ({
			page,
		}) => {
			// GIVEN Alice is on the dashboard and belongs to two orgs
			// AND the seed put taller as her active org (org plugin auto-set)
			await page.goto('/', { waitUntil: 'networkidle' })
			// AND the org-switcher has hydrated with the active-org name —
			// otherwise we'd race the BA atoms and click while the read-only
			// chip path is still showing "No active organization", which has
			// no popover to open.
			await expect(page.getByTestId('active-org-name')).toContainText(
				'Taller Demo',
				{ timeout: 10_000 },
			)

			// WHEN the switcher trigger is opened
			await page.getByTestId('org-switcher').click()

			// THEN both org options should be visible
			await expect(page.getByTestId('org-switcher-option-taller')).toBeVisible()
			await expect(
				page.getByTestId('org-switcher-option-restaurant'),
			).toBeVisible()
			// AND the active-org label should read "Taller Demo"
			await expect(page.getByTestId('active-org-name')).toContainText(
				'Taller Demo',
			)
		})
	})

	test.describe('when the user picks a different org', () => {
		test('should update the active-org indicator to the chosen name', async ({
			page,
		}) => {
			// GIVEN the switcher dropdown is open
			await page.goto('/', { waitUntil: 'networkidle' })
			await expect(page.getByTestId('active-org-name')).toContainText(
				'Taller Demo',
				{ timeout: 10_000 },
			)
			await page.getByTestId('org-switcher').click()

			// WHEN Alice clicks the restaurant option
			await page.getByTestId('org-switcher-option-restaurant').click()

			// THEN the active-org label should re-render to "Restaurant Demo"
			// (Better Auth's setActive succeeded, the router invalidated, the
			// useActiveOrganization atom refetched against the new cookie)
			await expect(page.getByTestId('active-org-name')).toContainText(
				'Restaurant Demo',
				{ timeout: 10_000 },
			)
		})
	})
})
