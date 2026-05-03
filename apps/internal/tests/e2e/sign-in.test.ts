import { expect, test } from '@playwright/test'

// Sign-in golden path. Selectors are verified against
// apps/internal/src/routes/login.tsx (login-form, login-email,
// login-password, login-submit, login-error). Personas come from
// `pnpm cli db reset`'s DEMO_USERS seed (alice@taller.cat).
//
// The form uses React 19's `<form action={fn}>` pattern, so React queues
// the submit even before hydration — no `requestSubmit()` workaround or
// `networkidle` wait needed; a plain click is enough.
//
// Note: this file runs in the `unauth` Playwright project (no
// storageState injected). Cases that exercise the "already
// authenticated" branch of `/login`'s `beforeLoad` live in
// `session-persistence.test.ts` instead, where storageState is in
// scope.

test.describe('sign-in', () => {
	test.describe('with seeded credentials and no returnTo', () => {
		test('should land Alice on / and drop the login form', async ({ page }) => {
			// GIVEN the dev stack is up and the seed has provisioned alice
			// AND the browser is at /login with the form rendered
			await page.goto('/login')
			await expect(page.getByTestId('login-form')).toBeVisible()

			// WHEN Alice fills the form and clicks submit
			await page.getByTestId('login-email').fill('admin@taller.cat')
			await page.getByTestId('login-password').fill('batuda-dev-2026')
			await page.getByTestId('login-submit').click()

			// THEN the action navigates to / (login.tsx — useActionState
			// resolves with no error and calls navigate({ href: '/' }) when
			// no returnTo is set), and the login form leaves the DOM (proves
			// the redirect actually happened, not just the URL bar updated)
			// [routes/login.tsx:120-124 — useActionState success branch with no returnTo]
			await page.waitForURL(/\/$/)
			await expect(page).toHaveURL(/\/$/)
			await expect(page.getByTestId('login-form')).toHaveCount(0)
		})
	})

	test.describe('with seeded credentials and a safe returnTo', () => {
		test('should land Alice on the original deep route', async ({ page }) => {
			// GIVEN /login?returnTo=/profile is open (the gate redirected
			// here from a guarded route). /profile is chosen because it's
			// user-scoped — no active-org dependency, so the assertion
			// doesn't race the org-picker for multi-org Alice.
			await page.goto('/login?returnTo=%2Fprofile')
			await expect(page.getByTestId('login-form')).toBeVisible()

			// WHEN Alice submits valid creds
			await page.getByTestId('login-email').fill('admin@taller.cat')
			await page.getByTestId('login-password').fill('batuda-dev-2026')
			await page.getByTestId('login-submit').click()

			// THEN the URL becomes /profile, not /
			// [routes/login.tsx:121-124 — isSafeReturnTo true branch]
			await page.waitForURL(/\/profile/)
			await expect(page).toHaveURL(/\/profile$/)
			await expect(page.getByTestId('login-form')).toHaveCount(0)
		})
	})

	test.describe('with seeded credentials and an unsafe returnTo', () => {
		test('should ignore the returnTo and land on /', async ({ page }) => {
			// GIVEN /login?returnTo=//evil.example/ is open. The leading `//`
			// makes it a protocol-relative URL — a same-origin nav helper
			// that wasn't validated would happily send the user to
			// https://evil.example/.
			await page.goto('/login?returnTo=%2F%2Fevil.example%2F')
			await expect(page.getByTestId('login-form')).toBeVisible()

			// WHEN Alice submits valid creds
			await page.getByTestId('login-email').fill('admin@taller.cat')
			await page.getByTestId('login-password').fill('batuda-dev-2026')
			await page.getByTestId('login-submit').click()

			// THEN the URL becomes / (NOT //evil.example/) — the open-redirect
			// vector is closed
			// [routes/login.tsx:20-22 — isSafeReturnTo rejects protocol-relative]
			await page.waitForURL(/\/$/)
			await expect(page).toHaveURL(/^https:\/\/batuda\.localhost\/$/)
			await expect(page.getByTestId('login-form')).toHaveCount(0)
		})
	})

	test.describe('with a wrong password', () => {
		test('should keep the URL on /login and surface login-error', async ({
			page,
		}) => {
			// GIVEN the browser is at /login
			await page.goto('/login')

			// WHEN Alice submits with the wrong password
			await page.getByTestId('login-email').fill('admin@taller.cat')
			await page.getByTestId('login-password').fill('wrong-password')
			await page.getByTestId('login-submit').click()

			// THEN login-error is visible (Better Auth's 401 maps to the
			// alert role in login.tsx) and the URL stays on /login —
			// no redirect happens on auth failure
			// [routes/login.tsx:107-116 — useActionState error branch, BA 401]
			await expect(page.getByTestId('login-error')).toBeVisible()
			await expect(page).toHaveURL(/\/login/)
		})
	})

	test.describe('with a non-existent email', () => {
		test('should surface login-error without enumerating accounts', async ({
			page,
		}) => {
			// GIVEN /login is open
			await page.goto('/login')

			// WHEN she submits credentials for an email that has no account
			await page.getByTestId('login-email').fill('ghost@nowhere.test')
			await page.getByTestId('login-password').fill('whatever')
			await page.getByTestId('login-submit').click()

			// THEN login-error is visible and the URL stays on /login. Better
			// Auth returns the same 401 shape for "no such user" and "wrong
			// password" by design (no account enumeration), so the user-facing
			// message is identical to the wrong-password path.
			// [routes/login.tsx:107-116 — same error branch as wrong password]
			await expect(page.getByTestId('login-error')).toBeVisible()
			await expect(page).toHaveURL(/\/login/)
		})
	})
})
