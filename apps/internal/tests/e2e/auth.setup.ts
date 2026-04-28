import { expect, test as setup } from '@playwright/test'

// Authenticate once for the suite. Tests that depend on a signed-in
// session reuse the storageState file produced here, so we don't
// hammer Better Auth's per-endpoint rate limit on `/sign-in/email`
// (defaults to ~3 attempts per 10s) every time we add a new test.
//
// Tests that are about sign-in itself (sign-in.test.ts) opt out by
// declaring a separate Playwright project that does NOT load this
// state — they need a fresh, unauthenticated context.

const AUTH_FILE = 'tests/e2e/.auth/alice.json'

setup('sign in as Alice and persist storage state', async ({ page }) => {
	// GIVEN the dev stack is up and the seed has provisioned alice
	await page.goto('/login')
	await expect(page.getByTestId('login-form')).toBeVisible()

	// WHEN Alice signs in with seeded credentials
	await page.getByTestId('login-email').fill('admin@taller.cat')
	await page.getByTestId('login-password').fill('batuda-dev-2026')
	await page.getByTestId('login-submit').click()

	// THEN the dashboard route renders (proves the cookie is set)
	await page.waitForURL(/\/$/)
	await expect(page.getByTestId('login-form')).toHaveCount(0)

	// AND we persist the resulting cookies for downstream tests
	await page.context().storageState({ path: AUTH_FILE })
})
