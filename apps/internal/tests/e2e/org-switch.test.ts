import { expect, test } from '@playwright/test'

import { setActiveOrgBySlug } from './helpers/set-active-org'

// Org switcher in the TopBar drives the session.activeOrganizationId
// cookie via Better Auth's setActive endpoint. After the mutation the
// router cache invalidates and the page navigates back to /. Selectors
// verified against:
//   apps/internal/src/components/layout/org-switcher.tsx
//     (org-switcher, org-switcher-option-{slug}, active-org-name)
//   apps/internal/src/routes/index.tsx
//     (company-card-{slug})
//
// Auth: this test runs in the `authed` project — Alice (taller owner +
// restaurant member) is the storageState seed, so the dropdown shows
// both orgs.
//
// Seed precondition: `marisqueria-del-port` belongs to the restaurant
// org and is asserted-on by the data-scoping case below — see
// `apps/cli/src/commands/seed.ts` (Restaurant company insert after the
// Taller bulk insert).

const TALLER_ONLY_COMPANY = 'cal-pep-fonda'
const RESTAURANT_ONLY_COMPANY = 'marisqueria-del-port'

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
			// AND the seed put taller as her active org
			await page.goto('/', { waitUntil: 'networkidle' })
			await expect(page.getByTestId('active-org-name')).toContainText(
				'Taller Demo',
				{ timeout: 10_000 },
			)

			// WHEN the switcher trigger is opened
			await page.getByTestId('org-switcher').click()

			// THEN both org options should be visible
			// [components/layout/org-switcher.tsx:108-127 — dropdown render with aria-selected]
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

	test.describe('when a multi-org user picks a different org', () => {
		test('should re-scope visible data to the new org', async ({ page }) => {
			// GIVEN Alice is on / and a Taller-only company is visible
			await page.goto('/', { waitUntil: 'networkidle' })
			await expect(page.getByTestId('active-org-name')).toContainText(
				'Taller Demo',
				{ timeout: 10_000 },
			)
			await expect(
				page.getByTestId(`company-card-${TALLER_ONLY_COMPANY}`),
			).toBeVisible()

			// WHEN she switches to Restaurant
			await page.getByTestId('org-switcher').click()
			await page.getByTestId('org-switcher-option-restaurant').click()

			// THEN the active-org label re-renders to "Restaurant Demo"
			// AND a Restaurant-only company is now visible
			// AND the Taller-only company is no longer visible — proves
			// the loaders refetched against the new active-org GUC, not
			// just that the chrome label changed
			// [org-switcher.tsx:48-61 — setActive → router.invalidate → navigate]
			await expect(page.getByTestId('active-org-name')).toContainText(
				'Restaurant Demo',
				{ timeout: 10_000 },
			)
			await expect(
				page.getByTestId(`company-card-${RESTAURANT_ONLY_COMPANY}`),
			).toBeVisible({ timeout: 10_000 })
			await expect(
				page.getByTestId(`company-card-${TALLER_ONLY_COMPANY}`),
			).toHaveCount(0)
		})

		test('should land on / even when the switch was triggered from a deep route', async ({
			page,
		}) => {
			// GIVEN Alice is on a Taller-only company page
			await page.goto(`/companies/${TALLER_ONLY_COMPANY}`, {
				waitUntil: 'networkidle',
			})
			await expect(page.getByTestId('active-org-name')).toContainText(
				'Taller Demo',
				{ timeout: 10_000 },
			)

			// WHEN she opens the switcher and picks Restaurant
			await page.getByTestId('org-switcher').click()
			await page.getByTestId('org-switcher-option-restaurant').click()

			// THEN the URL becomes / (the switcher always redirects home so
			// org-scoped slugs that don't exist in the new org don't 404)
			// AND the active org reads Restaurant Demo
			// [org-switcher.tsx:60-61 — explicit navigate({ to: '/' })]
			await page.waitForURL(/\/$/)
			await expect(page).toHaveURL(/\/$/)
			await expect(page.getByTestId('active-org-name')).toContainText(
				'Restaurant Demo',
				{ timeout: 10_000 },
			)
		})

		test('should persist the new active org across a hard reload', async ({
			page,
		}) => {
			// GIVEN Alice has just switched to Restaurant. The earlier
			// cases in this file already cover the dropdown-driven flow;
			// here we only need durability across reload, so set the
			// active org through the helper (POST /auth/organization/set-active)
			// to dodge the React 19 hydration race that flakes the
			// dropdown click when the file reaches its third test.
			await page.goto('/', { waitUntil: 'networkidle' })
			await setActiveOrgBySlug(page, 'restaurant')
			await page.reload({ waitUntil: 'networkidle' })
			await expect(page.getByTestId('active-org-name')).toContainText(
				'Restaurant Demo',
				{ timeout: 10_000 },
			)

			// WHEN the browser does a full reload
			await page.reload({ waitUntil: 'networkidle' })

			// THEN the active-org label still reads Restaurant Demo —
			// proves activeOrganizationId is durable on the session row,
			// not just held in the in-memory atom registry
			// [build-better-auth-config.ts:71-99 — session.activeOrganizationId column]
			await expect(page.getByTestId('active-org-name')).toContainText(
				'Restaurant Demo',
				{ timeout: 10_000 },
			)
			await expect(
				page.getByTestId(`company-card-${RESTAURANT_ONLY_COMPANY}`),
			).toBeVisible({ timeout: 10_000 })
		})
	})

	test.describe('when a multi-org user picks the org that is already active', () => {
		test('should close the dropdown without firing setActive', async ({
			page,
		}) => {
			// GIVEN Alice is on / with Taller active and the dropdown open
			await page.goto('/', { waitUntil: 'networkidle' })
			await expect(page.getByTestId('active-org-name')).toContainText(
				'Taller Demo',
				{ timeout: 10_000 },
			)
			await page.getByTestId('org-switcher').click()
			await expect(page.getByTestId('org-switcher-option-taller')).toBeVisible()

			// WHEN she clicks the option that's already active. The
			// switcher short-circuits so no /auth/organization/set-active
			// request fires — assert by waiting briefly and confirming no
			// request matched the predicate.
			// [org-switcher.tsx:41-44 — same-org short-circuit]
			let setActiveFired = false
			page.on('request', req => {
				if (req.url().includes('/auth/organization/set-active')) {
					setActiveFired = true
				}
			})
			await page.getByTestId('org-switcher-option-taller').click()

			// THEN the dropdown closes and the active-org label is unchanged
			await expect(page.getByTestId('org-switcher-option-taller')).toHaveCount(
				0,
			)
			await expect(page.getByTestId('active-org-name')).toContainText(
				'Taller Demo',
			)
			// AND no setActive request was issued in the next 500ms — the
			// short-circuit branch is observable
			await page.waitForTimeout(500)
			expect(setActiveFired).toBe(false)
		})
	})
})
