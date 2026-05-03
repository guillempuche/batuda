import { expect, test } from '@playwright/test'

// Sign-out tears down the Better-Auth session and the root-route guard
// then refuses to keep us on `/profile`. Selectors verified against:
//   apps/internal/src/routes/profile/index.tsx (profile-card,
//     profile-signout — submitted via React 19 form action so the click
//     is queued through hydration)
//   apps/internal/src/routes/login.tsx (login-form for the post-redirect
//     assertion)
//
// The first test runs in the `authed` project and inherits Alice's
// storageState. Sign-out invalidates that session row server-side, so
// every subsequent test in this file uses a fresh empty storageState
// and signs Alice back in via the form before exercising its scenario.
// Keeps tests independent without leaking dead-session cookies.

test.describe('sign-out', () => {
	test.describe('when an authenticated user submits the form', () => {
		test('should tear down the session and land on /login', async ({
			page,
		}) => {
			// GIVEN Alice is on the profile page (cookie injected by setup)
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
		// Skip storageState: each test signs Alice in via the form, signs
		// her out, and then asserts. Self-contained so a sign-out in one
		// test never leaks a dead session into the next.
		test.use({ storageState: { cookies: [], origins: [] } })

		async function signInAndOut(page: import('@playwright/test').Page) {
			await page.goto('/login')
			await page.getByTestId('login-email').fill('admin@taller.cat')
			await page.getByTestId('login-password').fill('batuda-dev-2026')
			await page.getByTestId('login-submit').click()
			await page.waitForURL(/\/$/)
			await page.goto('/profile')
			await expect(page.getByTestId('profile-card')).toBeVisible()
			await page.getByTestId('profile-signout').click()
			await page.waitForURL(/\/login/)
		}

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
