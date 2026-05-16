import { expect, test } from '@playwright/test'

import { findLatestEmail } from './helpers/dev-inbox'

// Magic-link sign-in golden + recovery paths. Selectors are verified
// against apps/internal/src/routes/login.tsx and apps/server/src/lib/auth.ts
// (the `magicLink({ disableSignUp: true, sendMagicLink })` block).
//
// This file runs in the `unauth` Playwright project (no storageState).
// The dev server must be running with EMAIL_PROVIDER=local so the
// transactional provider writes .md files to apps/server/.dev-inbox/.

const SEED_USER_EMAIL = 'admin@taller.cat'

test.describe('magic-link sign-in from /login', () => {
	test.describe('when a registered user requests a sign-in link', () => {
		test('should swap the form for the inbox panel and sign her in on click', async ({
			browser,
			page,
		}) => {
			// GIVEN the dev stack is up and Alice's account exists in the seed
			// AND /login is open in a fresh context with no session cookie
			const requestStartedAt = Date.now()
			await page.goto('/login')
			await expect(page.getByTestId('login-form')).toBeVisible()

			// WHEN Alice types her email and clicks "Email me a sign-in link"
			// [routes/login.tsx — magic-link trigger fires requestMagicLink()]
			await page.getByTestId('login-email').fill(SEED_USER_EMAIL)
			await page.getByTestId('login-magic-link-trigger').click()

			// THEN the form unmounts and the inbox panel renders with the
			// captured email shown back to the user
			// [routes/login.tsx — magicLinkStatus.kind === 'sent' branch]
			await expect(page.getByTestId('magic-link-sent-panel')).toBeVisible({
				timeout: 10_000,
			})
			await expect(page.getByTestId('magic-link-sent-email')).toHaveText(
				SEED_USER_EMAIL,
			)
			await expect(page.getByTestId('login-form')).toHaveCount(0)

			// AND the local transactional provider wrote the magic-link .md
			// file with the verify URL inside
			// [apps/server/src/lib/auth.ts — sendMagicLink callback]
			const email = await findLatestEmail({
				recipient: SEED_USER_EMAIL,
				label: 'magic-link',
				sinceMs: requestStartedAt,
				maxWaitMs: 10_000,
			})
			expect(email.url).toMatch(/\/auth\/magic-link\/verify\?token=/)

			// WHEN we open the captured URL in a fresh browser context
			// (the real user clicks the link in their email client)
			const verifyContext = await browser.newContext()
			const verifyPage = await verifyContext.newPage()
			await verifyPage.goto(email.url)

			// THEN Better-Auth's verify endpoint sets the session cookie and
			// redirects to / (callbackURL defaults to / via login.tsx)
			// [routes/login.tsx — sendMagicLink builds callbackURL from returnTo or '/']
			await verifyPage.waitForURL(/\/$/)
			await expect(verifyPage).toHaveURL(/\/$/)

			await verifyContext.close()
		})
	})

	test.describe('when an unregistered email requests a sign-in link', () => {
		test('should render the inbox panel without writing an email (no enumeration)', async ({
			page,
		}) => {
			// GIVEN /login is open
			// AND an email at .invalid that has never existed in our system
			// (RFC 2606 reserves .invalid so this cannot collide with a real seed)
			const requestStartedAt = Date.now()
			const unknownEmail = `noone-${Date.now()}@example.invalid`
			await page.goto('/login')

			// WHEN the user submits the magic-link request
			// [apps/server/src/lib/auth.ts — sendMagicLink existence pre-check]
			await page.getByTestId('login-email').fill(unknownEmail)
			await page.getByTestId('login-magic-link-trigger').click()

			// THEN the UI shows the same inbox panel — the response shape
			// stays opaque so an attacker cannot tell registered apart from
			// unregistered. Same UX, no information leak.
			await expect(page.getByTestId('magic-link-sent-panel')).toBeVisible({
				timeout: 10_000,
			})

			// AND the dev-inbox does NOT receive a .md for this recipient —
			// the existence pre-check inside sendMagicLink silently no-ops
			// for unknown emails.
			let caught = false
			try {
				await findLatestEmail({
					recipient: unknownEmail,
					label: 'magic-link',
					sinceMs: requestStartedAt,
					maxWaitMs: 2_000,
				})
			} catch {
				caught = true
			}
			expect(caught, 'no magic-link .md should be written').toBe(true)
		})
	})

	test.describe('when the user toggles back to password from the inbox panel', () => {
		test('should restore the password form intact', async ({ page }) => {
			// GIVEN the inbox panel is rendered after a successful magic-link send
			await page.goto('/login')
			await page.getByTestId('login-email').fill(SEED_USER_EMAIL)
			await page.getByTestId('login-magic-link-trigger').click()
			await expect(page.getByTestId('magic-link-sent-panel')).toBeVisible({
				timeout: 10_000,
			})

			// WHEN the user clicks "Use password instead"
			// [routes/login.tsx — usePasswordInstead()]
			await page.getByTestId('magic-link-use-password').click()

			// THEN the form returns and remains submittable
			await expect(page.getByTestId('login-form')).toBeVisible()
			await expect(page.getByTestId('login-email')).toBeVisible()
			await expect(page.getByTestId('login-password')).toBeVisible()
			await expect(page.getByTestId('login-submit')).toBeVisible()
		})
	})

	test.describe('when /login renders with a magic-link verify error in the URL', () => {
		test('should surface the localized error message above the form', async ({
			page,
		}) => {
			// GIVEN Better-Auth's verify endpoint redirected back here with
			// `?error=<code>` appended to the errorCallbackURL we passed.
			// new_user_signup_disabled fires when an unknown email verifies.
			// [apps/server/src/lib/auth.ts — disableSignUp: true on magicLink]
			await page.goto('/login?error=new_user_signup_disabled')

			// THEN the inline error panel renders alongside the form so the
			// user knows why they bounced back
			await expect(page.getByTestId('login-magic-link-error')).toBeVisible()
			await expect(page.getByTestId('login-form')).toBeVisible()
		})
	})
})
