import { expect, test } from '@playwright/test'

import { setActiveOrgBySlug } from './helpers/set-active-org'

// Cross-org / superadmin coverage for two personas the seed mints
// (apps/cli/src/commands/seed.ts):
//
//   boss@batuda.dev          role=admin, member=admin in BOTH orgs
//                            (cross-org reach via memberships).
//   superadmin@batuda.dev    role=app_service, NO memberships
//                            (cross-org reach via the BA admin
//                            plugin's adminRoles + roles config in
//                            apps/server/src/lib/auth.ts).
//
// The OrgSwitcher today lists memberships only — the boss persona
// works end-to-end because the membership rows give the switcher
// something to render. The app_service persona has no membership
// rows; the switcher renders the read-only "No active organization"
// chip. The cross-org switching UX for app_service is a follow-up
// (a separate API surface that lists all orgs would have to land
// first); the test here pins the current behaviour and documents
// what should change once that lands.
//
// Selectors verified against:
//   apps/internal/src/components/layout/org-switcher.tsx
//     (org-switcher, org-switcher-option-{slug}, active-org-name)
//   apps/internal/src/routes/index.tsx
//     (company-card-{slug})
//   apps/internal/src/routes/login.tsx
//     (login-form, login-email, login-password, login-submit)

test.use({ storageState: { cookies: [], origins: [] } })

const TALLER_ONLY_COMPANY = 'cal-pep-fonda'
const RESTAURANT_ONLY_COMPANY = 'marisqueria-del-port'

async function signIn(
	page: import('@playwright/test').Page,
	email: string,
): Promise<void> {
	await page.goto('/login')
	await page.getByTestId('login-email').fill(email)
	await page.getByTestId('login-password').fill('batuda-dev-2026')
	await page.getByTestId('login-submit').click()
	await page.waitForURL(/\/$/)
}

test.describe('superadmin', () => {
	test.describe('when the boss persona signs in (admin role + member of every org)', () => {
		test('should land on / and expose every seeded org in the switcher', async ({
			page,
		}) => {
			// GIVEN /login is open
			// WHEN the boss submits valid creds
			await signIn(page, 'boss@batuda.dev')

			// AND lands on /
			// AND opens the switcher
			// (The active-org indicator may not be set yet — BA's auto-set-
			// active hook only fires for users with exactly one membership;
			// the boss has two, so activeOrganizationId starts as null.)
			await page.getByTestId('org-switcher').click()

			// THEN both seeded orgs are listed
			// [components/layout/org-switcher.tsx:108-127 — useListOrganizations]
			await expect(page.getByTestId('org-switcher-option-taller')).toBeVisible()
			await expect(
				page.getByTestId('org-switcher-option-restaurant'),
			).toBeVisible()
		})

		test('should re-scope visible data after switching from Taller to Restaurant', async ({
			page,
		}) => {
			// GIVEN the boss is signed in and Taller is the active org
			await signIn(page, 'boss@batuda.dev')
			await setActiveOrgBySlug(page, 'taller')
			await page.goto('/', { waitUntil: 'networkidle' })
			await expect(page.getByTestId('active-org-name')).toContainText(
				'Taller Demo',
				{ timeout: 10_000 },
			)
			await expect(
				page.getByTestId(`company-card-${TALLER_ONLY_COMPANY}`),
			).toBeVisible()

			// WHEN she switches to Restaurant via the dropdown
			await page.getByTestId('org-switcher').click()
			await page.getByTestId('org-switcher-option-restaurant').click()

			// THEN the active-org label updates AND the dashboard shows
			// the Restaurant-only company AND the Taller-only company is
			// no longer visible — same data-vs-label contract org-switch
			// asserts for Alice
			// [org-switcher.tsx:38-67 — setActive then hard-navigate]
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

		test('should keep the chosen org across a hard reload', async ({
			page,
		}) => {
			// GIVEN the boss has switched to Restaurant
			await signIn(page, 'boss@batuda.dev')
			await setActiveOrgBySlug(page, 'restaurant')
			await page.goto('/', { waitUntil: 'networkidle' })
			await expect(page.getByTestId('active-org-name')).toContainText(
				'Restaurant Demo',
				{ timeout: 10_000 },
			)

			// WHEN she hard-reloads
			await page.reload({ waitUntil: 'networkidle' })

			// THEN the active org is still Restaurant — proves the session
			// row's activeOrganizationId persists across the SSR gate +
			// atom rehydration for any role, not just for Alice
			await expect(page.getByTestId('active-org-name')).toContainText(
				'Restaurant Demo',
				{ timeout: 10_000 },
			)
		})
	})

	test.describe('when the superadmin persona signs in (app_service role, no memberships)', () => {
		test('should sign in successfully — the app_service role is accepted', async ({
			page,
		}) => {
			// GIVEN /login is open and no cookie is present
			// WHEN superadmin@batuda.dev submits valid creds
			await signIn(page, 'superadmin@batuda.dev')

			// THEN URL becomes / and login-form is gone — Better Auth's
			// admin plugin recognises `app_service` as an admin role
			// (apps/server/src/lib/auth.ts adminRoles + roles config),
			// so the password sign-in succeeds end-to-end
			await expect(page).toHaveURL(/\/$/)
			await expect(page.getByTestId('login-form')).toHaveCount(0)
		})

		test('should render the read-only "No active organization" chip', async ({
			page,
		}) => {
			// GIVEN the superadmin is signed in (no memberships)
			await signIn(page, 'superadmin@batuda.dev')

			// THEN the active-org indicator reads "No active organization"
			// because authClient.useListOrganizations is membership-scoped
			// and returns []. This is the documented current behaviour:
			// the switcher does NOT yet expose a cross-org list for
			// app_service users — see the TODO at the top of this file.
			// When that lands, this assertion should flip to expecting
			// every seeded org slug to be visible.
			// [org-switcher.tsx:71-84 — single-membership chip path]
			await expect(page.getByTestId('active-org-name')).toContainText(
				'No active organization',
				{ timeout: 10_000 },
			)
		})

		test('should NOT yet be able to setActive any org (membership-gated)', async ({
			page,
		}) => {
			// GIVEN the superadmin is signed in (no memberships)
			await signIn(page, 'superadmin@batuda.dev')

			// WHEN POSTing /auth/organization/set-active for the taller org
			const result = await page.evaluate(async () => {
				const res = await fetch('/auth/organization/set-active', {
					method: 'POST',
					credentials: 'include',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ organizationSlug: 'taller' }),
				})
				return {
					status: res.status,
					body: (await res.text()).slice(0, 200),
				}
			})

			// THEN BA's org plugin refuses with 403 USER_IS_NOT_A_MEMBER_
			// OF_THE_ORGANIZATION — set-active is membership-gated for
			// every role, including app_service. This pins the current
			// constraint so a future fix that grants app_service users
			// cross-org reach (either by extending BA's org plugin or by
			// adding a Batuda-specific endpoint) flips this test red and
			// forces a deliberate replacement.
			// [BA org plugin set-active checks user_organization membership]
			expect(result.status).toBe(403)
			expect(result.body).toContain('USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION')
		})
	})
})
