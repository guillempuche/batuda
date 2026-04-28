import { expect, test } from '@playwright/test'

// GIVEN the dev stack is up and `pnpm cli db reset` has seeded the
//       DEMO_USERS persona table (alice@taller.cat / batuda-dev-2026)
// WHEN  Alice fills the login form and submits
// THEN  the browser lands at the dashboard `/` and the session cookie
//       carries her sign-in
//
// Selectors come from apps/internal/src/routes/login.tsx — login-form,
// login-email, login-password, login-submit, login-error are stable.

test.describe('sign-in', () => {
	test('Alice signs in with seeded credentials and lands on the dashboard', async ({
		page,
	}) => {
		await page.goto('/login')
		await expect(page.getByTestId('login-form')).toBeVisible()

		await page.getByTestId('login-email').fill('admin@taller.cat')
		await page.getByTestId('login-password').fill('batuda-dev-2026')
		await page.getByTestId('login-submit').click()

		// The router client-navigates to `/` after a successful sign-in
		// (login.tsx — `await navigate({ href: target })` with target='/'
		// when no returnTo is set). Wait for the URL change instead of a
		// timing-based sleep.
		await page.waitForURL(/\/$/)
		await expect(page).toHaveURL(/\/$/)
		// The login form must no longer be in the DOM — proves the
		// redirect happened, not just that the URL bar updated.
		await expect(page.getByTestId('login-form')).toHaveCount(0)
	})

	test('rejects a wrong password with login-error visible', async ({
		page,
	}) => {
		await page.goto('/login')
		await page.getByTestId('login-email').fill('admin@taller.cat')
		await page.getByTestId('login-password').fill('wrong-password')
		await page.getByTestId('login-submit').click()

		await expect(page.getByTestId('login-error')).toBeVisible()
		// Stayed on /login — no redirect on auth failure.
		await expect(page).toHaveURL(/\/login/)
	})
})
