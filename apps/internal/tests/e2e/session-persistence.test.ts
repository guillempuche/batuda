import { expect, test } from '@playwright/test'

// Hard-reload + cross-tab durability of Better Auth's session cookie.
// The original regression these cases pin: a hard reload at the
// frontend origin runs SSR `beforeLoad` (apps/internal/src/routes/__root.tsx:55-83)
// which forwards the incoming Cookie header to /auth/get-session
// (session-check.ts:39-71). If the auth cookie isn't on the frontend
// origin's cookie jar, SSR sees no cookie and bounces to /login —
// reproducing as "reload after login logs you out".
//
// Selectors verified against:
//   apps/internal/src/routes/__root.tsx (root beforeLoad)
//   apps/internal/src/routes/login.tsx (login-form, beforeLoad redirect
//     when an authenticated user visits /login)
//   apps/internal/src/components/layout/org-switcher.tsx (active-org-name)
//   apps/internal/src/routes/companies/$slug.tsx (company name in <Name>)
//
// Auth: runs in the `authed` Playwright project so Alice's cookies are
// injected from `setup`'s storageState.

test.describe('session persistence', () => {
	test.describe('after a successful login on the dashboard', () => {
		test('should keep Alice signed in across a hard reload', async ({
			page,
		}) => {
			// GIVEN Alice is on / with the storageState cookie injected
			await page.goto('/')
			await expect(page.getByTestId('active-org-name')).toContainText(
				'Taller Demo',
				{ timeout: 10_000 },
			)

			// WHEN the browser does a full reload
			await page.reload()

			// THEN the URL stays / (SSR beforeLoad accepted the cookie and
			// did not redirect), login-form is absent, and the active-org
			// indicator hydrates back to the same value
			// [__root.tsx:55-83 — SSR beforeLoad with valid cookie]
			// [build-better-auth-config.ts:30-41 — cookie-domain derivation]
			await expect(page).toHaveURL(/\/$/)
			await expect(page.getByTestId('login-form')).toHaveCount(0)
			await expect(page.getByTestId('active-org-name')).toContainText(
				'Taller Demo',
				{ timeout: 10_000 },
			)
		})
	})

	test.describe('after a successful login on a deep route', () => {
		test('should keep Alice signed in across a reload of /companies/cal-pep-fonda', async ({
			page,
		}) => {
			// GIVEN Alice navigates to a deep, org-scoped route
			await page.goto('/companies/cal-pep-fonda', { waitUntil: 'networkidle' })
			await expect(page.locator('body')).toContainText('Cal Pep Fonda')

			// WHEN the browser does a full reload
			await page.reload({ waitUntil: 'networkidle' })

			// THEN the URL stays on the same deep route, login-form is
			// absent, and the company header re-renders — proving the SSR
			// session check + the company loader both saw the cookie
			// [__root.tsx:55-83 — SSR beforeLoad on a non-root URL]
			await expect(page).toHaveURL(/\/companies\/cal-pep-fonda/)
			await expect(page.getByTestId('login-form')).toHaveCount(0)
			await expect(page.locator('body')).toContainText('Cal Pep Fonda')
		})
	})

	test.describe('with the session cookie wiped between actions', () => {
		test('should bounce a guarded reload back to /login with returnTo', async ({
			page,
			context,
		}) => {
			// GIVEN Alice is on a deep, org-scoped route
			await page.goto('/companies/cal-pep-fonda', { waitUntil: 'networkidle' })
			await expect(page.locator('body')).toContainText('Cal Pep Fonda')

			// WHEN every cookie is dropped from the context, then the page
			// is reloaded
			await context.clearCookies()
			await page.reload()

			// THEN the SSR guard sees no cookie and redirects to
			// /login?returnTo=%2Fcompanies%2Fcal-pep-fonda — the returnTo
			// carries the original destination intact
			// [__root.tsx:73-80 — redirect with returnTo]
			await page.waitForURL(/\/login\?/)
			await expect(page).toHaveURL(/returnTo=%2Fcompanies%2Fcal-pep-fonda/)
			await expect(page.getByTestId('login-form')).toBeVisible()
		})
	})

	test.describe('with a second tab opened after login', () => {
		test('should attach the cookie to the new tab and skip /login', async ({
			page,
			context,
		}) => {
			// GIVEN Alice's main tab is on /
			await page.goto('/')
			await expect(page.getByTestId('active-org-name')).toContainText(
				'Taller Demo',
				{ timeout: 10_000 },
			)

			// WHEN the browser context opens a brand-new tab and navigates
			// to /
			const tab2 = await context.newPage()
			await tab2.goto('/')

			// THEN the new tab's URL stays / (the shared cookie jar carried
			// the auth cookie into the second tab) and the login form is
			// absent — proves real cookie-jar persistence, not just the
			// storageState injection that seeded the first tab
			// [browser cookie-jar persistence; same SSR path as a hard reload]
			await expect(tab2).toHaveURL(/\/$/)
			await expect(tab2.getByTestId('login-form')).toHaveCount(0)
			await tab2.close()
		})
	})

	test.describe('when an already-authenticated user visits /login', () => {
		test('should bounce to / without showing the form', async ({ page }) => {
			// GIVEN Alice's session cookie is present (storageState)
			// WHEN she navigates to /login
			await page.goto('/login')

			// THEN /login's beforeLoad detects the session and throws a
			// redirect to / — the form is never rendered
			// [routes/login.tsx:60-72 — beforeLoad redirect when fetchSession returns a user]
			await page.waitForURL(/\/$/)
			await expect(page).toHaveURL(/\/$/)
			await expect(page.getByTestId('login-form')).toHaveCount(0)
		})
	})

	test.describe('when an already-authenticated user visits /login?returnTo=...', () => {
		test('should honor returnTo on the bounce', async ({ page }) => {
			// GIVEN Alice's cookie is present
			// WHEN she navigates to /login?returnTo=/profile
			await page.goto('/login?returnTo=%2Fprofile')

			// THEN the bounce sends her to /profile, not /
			// [routes/login.tsx:67-71 — same branch, returnTo path]
			await page.waitForURL(/\/profile/)
			await expect(page).toHaveURL(/\/profile$/)
			await expect(page.getByTestId('login-form')).toHaveCount(0)
		})
	})
})
