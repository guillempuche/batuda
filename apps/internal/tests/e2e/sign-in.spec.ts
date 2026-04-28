import { expect, test } from '@playwright/test'

// Sign-in golden path. Selectors are verified against
// apps/internal/src/routes/login.tsx (login-form, login-email,
// login-password, login-submit, login-error). Personas come from
// `pnpm cli db reset`'s DEMO_USERS seed (alice@taller.cat).

test.describe('sign-in', () => {
	test.describe('with seeded credentials', () => {
		test('Alice lands on the dashboard after submit', async ({ page }) => {
			// GIVEN the dev stack is up and the seed has provisioned alice
			// AND the browser is at /login with the form rendered
			await page.goto('/login')
			await expect(page.getByTestId('login-form')).toBeVisible()

			// WHEN Alice fills the form and clicks submit
			await page.getByTestId('login-email').fill('admin@taller.cat')
			await page.getByTestId('login-password').fill('batuda-dev-2026')
			await page.getByTestId('login-submit').click()

			// THEN the router client-navigates to / (login.tsx — handleSubmit
			// awaits navigate({ href: target }), where target='/' when no
			// returnTo is set), and the login form leaves the DOM (proves the
			// redirect actually happened, not just that the URL bar updated)
			await page.waitForURL(/\/$/)
			await expect(page).toHaveURL(/\/$/)
			await expect(page.getByTestId('login-form')).toHaveCount(0)
		})
	})

	test.describe('with a wrong password', () => {
		test('the URL stays on /login and login-error surfaces', async ({
			page,
		}) => {
			// GIVEN the browser is at /login
			await page.goto('/login')

			// WHEN Alice submits with the wrong password
			await page.getByTestId('login-email').fill('admin@taller.cat')
			await page.getByTestId('login-password').fill('wrong-password')
			await page.getByTestId('login-submit').click()

			// THEN login-error is visible (Better Auth's 401 maps to the
			// error-text role in login.tsx) and the URL stays on /login —
			// no redirect happens on auth failure
			await expect(page.getByTestId('login-error')).toBeVisible()
			await expect(page).toHaveURL(/\/login/)
		})
	})
})
