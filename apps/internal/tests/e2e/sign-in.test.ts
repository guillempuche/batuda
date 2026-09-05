import { expect, test } from '@playwright/test'

import { waitForInteractive } from './helpers/hydration'

// Sign-in golden path. Selectors are verified against
// apps/internal/src/routes/login.tsx (login-form, login-email,
// login-password, login-submit, login-error). Personas come from
// `pnpm cli seed`'s DEMO_USERS (alice@taller.cat).
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
		test('should land Alice on / and drop the login form', {
			tag: '@smoke',
		}, async ({ page }) => {
			// GIVEN the dev stack is up and the seed has provisioned alice
			// AND the browser is at /login with the form rendered
			await page.goto('/login')
			await expect(page.getByTestId('login-form')).toBeVisible()

			// WHEN Alice fills the form and clicks submit
			await page.getByTestId('login-email').fill('admin@taller.cat')
			await page.getByTestId('login-password').fill('batuda-dev-2026')
			// The form submits through a handler that only exists once the page
			// is live; before then, clicking quietly does nothing.
			await waitForInteractive(page, 'login-submit')
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

	test.describe('however the styles reach the page', () => {
		test('should paint the form, not just lay it out', {
			tag: '@smoke',
		}, async ({ page }) => {
			/* An unstyled page still has every element, every test id and every
			 * bit of text, so the rest of this suite passes on one. The styles
			 * are prepared while the app is built now, and a build that quietly
			 * stops producing them — a transform that no longer runs, a
			 * stylesheet the document forgets to ask for — looks exactly like a
			 * working app to every other check here.
			 *
			 * So read the paint back off the page. Each of these comes only from
			 * a component's own styles, never from the reset or the tokens. */

			// GIVEN the sign-in page
			await page.goto('/login')
			const submit = page.getByTestId('login-submit')
			await expect(submit).toBeVisible()

			// WHEN the button's painted style is read back
			const button = await submit.evaluate(el => {
				const s = window.getComputedStyle(el)
				return {
					backgroundImage: s.backgroundImage,
					textTransform: s.textTransform,
					borderRadius: s.borderRadius,
				}
			})

			// THEN it carries the brushed-metal plate, not a bare button
			expect(button.backgroundImage).toContain('gradient')
			expect(button.textTransform).toBe('uppercase')
			expect(button.borderRadius).not.toBe('0px')

			// AND the card behind it is a surface rather than the page showing
			// through, which is what a dropped stylesheet would leave
			const card = await page.getByTestId('login-form').evaluate(el => {
				const parent = el.parentElement
				if (!parent) throw new Error('login-form has no parent to paint')
				return window.getComputedStyle(parent).backgroundColor
			})
			expect(card).not.toBe('rgba(0, 0, 0, 0)')
			expect(card).not.toBe('transparent')
		})
	})

	test.describe('with seeded credentials and a safe returnTo', () => {
		test('should land Alice on the original deep route', async ({ page }) => {
			// GIVEN /login?returnTo=/settings/profile is open (the gate
			// redirected here from a guarded route). The profile page is
			// chosen because it's user-scoped — no active-org dependency, so
			// the assertion doesn't race the org-picker for multi-org Alice.
			await page.goto('/login?returnTo=%2Fsettings%2Fprofile')
			await expect(page.getByTestId('login-form')).toBeVisible()

			// WHEN Alice submits valid creds
			await page.getByTestId('login-email').fill('admin@taller.cat')
			await page.getByTestId('login-password').fill('batuda-dev-2026')
			// The form submits through a handler that only exists once the page
			// is live; before then, clicking quietly does nothing.
			await waitForInteractive(page, 'login-submit')
			await page.getByTestId('login-submit').click()

			// THEN the URL becomes /settings/profile, not /
			await page.waitForURL(/\/settings\/profile$/)
			await expect(page).toHaveURL(/\/settings\/profile$/)
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
			// The form submits through a handler that only exists once the page
			// is live; before then, clicking quietly does nothing.
			await waitForInteractive(page, 'login-submit')
			await page.getByTestId('login-submit').click()

			// THEN the URL becomes / (NOT //evil.example/) — the open-redirect
			// vector is closed. The host must be batuda.localhost; the optional
			// leading label tolerates a worktree's `<label>.batuda.localhost`, and
			// the optional port portless's non-443 dev port, without weakening the
			// check that an evil host is rejected.
			// [routes/login.tsx:20-22 — isSafeReturnTo rejects protocol-relative]
			await page.waitForURL(/\/$/)
			await expect(page).toHaveURL(
				/^https:\/\/(?:[a-z0-9-]+\.)?batuda\.localhost(:\d+)?\/$/,
			)
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
			// The form submits through a handler that only exists once the page
			// is live; before then, clicking quietly does nothing.
			await waitForInteractive(page, 'login-submit')
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
			// The form submits through a handler that only exists once the page
			// is live; before then, clicking quietly does nothing.
			await waitForInteractive(page, 'login-submit')
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
