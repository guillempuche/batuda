import { expect, test } from '@playwright/test'

// Sign-out tears down the Better-Auth session and the root-route guard
// then refuses to keep us on `/profile`. Selectors verified against:
//   apps/internal/src/routes/profile/index.tsx (profile-card,
//     profile-signout — submitted via React 19 form action so the click
//     is queued through hydration)
//   apps/internal/src/routes/login.tsx (login-form for the post-redirect
//     assertion)
//
// Auth: this test runs in the `authed` project and inherits Alice's
// session cookie from the `setup` project's storageState. The test
// drops that cookie as the assertion.

test.describe('sign-out', () => {
	test.describe('when an authenticated user submits the form', () => {
		test('the session is torn down and the user lands on /login', async ({
			page,
		}) => {
			// GIVEN Alice is on the profile page (cookie injected by setup)
			await page.goto('/profile')
			await expect(page.getByTestId('profile-card')).toBeVisible()

			// WHEN she submits the sign-out form
			await page.getByTestId('profile-signout').click()

			// THEN the route guard redirects to /login
			// AND the sign-in form re-renders — proves both that the cookie
			// is gone (otherwise the guard would let us back onto /profile)
			// and that the navigation actually fired (the form is mounted
			// only on the login route)
			await page.waitForURL(/\/login/)
			await expect(page).toHaveURL(/\/login/)
			await expect(page.getByTestId('login-form')).toBeVisible()
		})
	})
})
