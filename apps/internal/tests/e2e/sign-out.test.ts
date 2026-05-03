import { expect, test } from '@playwright/test'

// Sign-out tears down the Better-Auth session and the root-route guard
// then refuses to keep us on `/profile`. Selectors verified against:
//   apps/internal/src/routes/profile/index.tsx (profile-card,
//     profile-signout — submitted via React 19 form action so the click
//     is queued through hydration)
//   apps/internal/src/routes/login.tsx (login-form for the post-redirect
//     assertion)
//
// Every test in this file signs Alice in via the form, signs her
// out, and then asserts. Self-contained so a sign-out never leaks a
// dead session into the persisted storageState that other test files
// rely on (auth.setup writes Alice's cookies once; if we sign her out
// using THAT cookie, the row is gone server-side and every subsequent
// authed test in any file fails with 401).

test.use({ storageState: { cookies: [], origins: [] } })

async function signIn(page: import('@playwright/test').Page) {
	await page.goto('/login')
	await page.getByTestId('login-email').fill('admin@taller.cat')
	await page.getByTestId('login-password').fill('batuda-dev-2026')
	await page.getByTestId('login-submit').click()
	await page.waitForURL(/\/$/)
}

async function signInAndOut(page: import('@playwright/test').Page) {
	await signIn(page)
	await page.goto('/profile')
	await expect(page.getByTestId('profile-card')).toBeVisible()
	await page.getByTestId('profile-signout').click()
	await page.waitForURL(/\/login/)
}

test.describe('sign-out', () => {
	test.describe('when an authenticated user submits the form', () => {
		test('should tear down the session and land on /login', async ({
			page,
		}) => {
			// GIVEN Alice signs in fresh (own cookie, not the persisted one)
			await signIn(page)
			await page.goto('/profile')
			await expect(page.getByTestId('profile-card')).toBeVisible()

			// WHEN she submits the sign-out form
			await page.getByTestId('profile-signout').click()

			// THEN the route guard redirects to /login and the sign-in form
			// re-renders — proves both that the cookie is gone (otherwise
			// the guard would let us back onto /profile) and that the
			// navigation actually fired (the form is mounted only on the
			// login route)
			// [routes/profile/index.tsx — profile-signout submit]
			await page.waitForURL(/\/login/)
			await expect(page).toHaveURL(/\/login/)
			await expect(page.getByTestId('login-form')).toBeVisible()
		})
	})

	test.describe('after sign-out', () => {
		// Note on the browser back button: pressing Back after sign-out
		// can show a bfcache (back-forward cache) snapshot of the authed
		// page before the route guard re-runs. The security property the
		// suite asserts is "no fresh navigation reaches an authed page
		// without a cookie" — covered by the "fresh navigation" test
		// below. Hardening bfcache (Cache-Control: no-store on authed
		// HTML, or the BroadcastChannel sign-out fan-out) is a separate
		// concern.

		test('should keep the user on /login after a hard reload', async ({
			page,
		}) => {
			// GIVEN Alice signs in then signs out
			await signInAndOut(page)

			// WHEN the browser does a full reload
			await page.reload()

			// THEN the URL stays /login (no cookie → /login's beforeLoad
			// sees no user → it lets the page render) and the form is
			// visible
			// [routes/login.tsx:60-72 — beforeLoad sees no user, lets the page render]
			await expect(page).toHaveURL(/\/login/)
			await expect(page.getByTestId('login-form')).toBeVisible()
		})

		test('should redirect a fresh navigation to a guarded route back to /login with returnTo', async ({
			page,
		}) => {
			// GIVEN Alice signs in then signs out (cookie gone)
			await signInAndOut(page)

			// WHEN she navigates directly to a guarded route
			await page.goto('/companies/cal-pep-fonda')

			// THEN the root guard intercepts and bounces to
			// /login?returnTo=%2Fcompanies%2Fcal-pep-fonda — proving the
			// returnTo carries the original destination so the user can
			// be sent back after re-authenticating
			// [__root.tsx:73-80 — redirect branch with returnTo]
			await page.waitForURL(/\/login\?/)
			await expect(page).toHaveURL(/returnTo=%2Fcompanies%2Fcal-pep-fonda/)
			await expect(page.getByTestId('login-form')).toBeVisible()
		})
	})
})
