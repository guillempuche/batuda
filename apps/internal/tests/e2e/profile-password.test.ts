import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { type BrowserContext, expect, type Page, test } from '@playwright/test'

import { setActiveOrgBySlug } from './helpers/set-active-org'

// End-to-end set/change password from /profile. The flow under test:
//
//   1. Alice invites a fresh user → org plugin's sendInvitationEmail
//      pre-creates them without a password and ships a magic-link
//      sign-in URL to apps/server/.dev-inbox/.
//   2. A fresh browser context opens the URL: BA's magic-link verify
//      signs the new user in. Their `account` table has no credential
//      row, so `fetchSecurityState` derives `hasPassword: false`.
//   3. /profile renders the "Set a password" form (the three-state card's
//      `!hasPassword && !passwordOptOut` branch).
//   4. Submitting the form hits POST /auth/set-password (the thin BA
//      plugin route at apps/server/src/plugins/set-password-route.ts).
//   5. After router.invalidate(), the card flips to "Change password"
//      because the loader re-fetches hasPassword and gets true.
//   6. The opt-out path POSTs { passwordOptOut: true } to
//      /auth/update-user — the card collapses to the passwordless-only
//      confirmed state with an undo affordance.
//
// Selectors and branches verified against:
//   apps/internal/src/routes/profile/index.tsx
//   apps/server/src/plugins/set-password-route.ts
//   apps/internal/src/lib/security-state.ts

const INBOX_DIR = join(process.cwd(), '..', 'server', '.dev-inbox')

const NEW_PASSWORD = 'first-real-password-1234'

interface InvitationMail {
	readonly file: string
	readonly url: string
}

// Polls .dev-inbox/ for an `invitation`-labelled .md whose filename
// contains the recipient slug, then extracts the magic-link URL. Same
// pattern as invite.test.ts:44-89 — the file appears asynchronously
// after the API responds.
async function pollInvitationMail(
	recipient: string,
	timeoutMs: number,
): Promise<InvitationMail> {
	const slug = recipient.split('@')[0]!
	const deadline = Date.now() + timeoutMs
	let lastErr: unknown
	while (Date.now() < deadline) {
		try {
			const files = await readdir(INBOX_DIR)
			const match = files
				.filter(name => name.includes(slug) && name.endsWith('.md'))
				.sort()
				.pop()
			if (match) {
				const body = await readFile(join(INBOX_DIR, match), 'utf8')
				if (!body.includes('labels:') || !body.includes('invitation')) {
					await new Promise(r => {
						setTimeout(r, 200)
					})
					continue
				}
				const urlMatch = body.match(
					/https?:\/\/[^\s]*\/auth\/magic-link\/verify[^\s]*/,
				)
				if (urlMatch) return { file: match, url: urlMatch[0] }
			}
		} catch (e) {
			lastErr = e
		}
		await new Promise(r => {
			setTimeout(r, 200)
		})
	}
	throw new Error(
		`invitation .md for ${recipient} did not appear within ${timeoutMs}ms (last error: ${String(lastErr)})`,
	)
}

// Mints a fresh passwordless user via the invitation flow and returns a
// BrowserContext + Page authenticated as that user. Two contexts are
// required: Alice's session sends the invite, and a separate context
// follows the magic link so we end up authed as the invitee, not Alice.
async function bootPasswordlessInvitee(
	alicePage: Page,
	browser: import('@playwright/test').Browser,
	emailHint: string,
): Promise<{
	email: string
	context: BrowserContext
	page: Page
}> {
	const email = `${emailHint}-${Date.now()}@example.com`

	await alicePage.goto('/settings/organization/invite', {
		waitUntil: 'networkidle',
	})
	await alicePage.getByTestId('invite-email').fill(email)
	await alicePage.getByTestId('invite-role').selectOption('member')
	await alicePage.getByTestId('invite-submit').click()
	await expect(alicePage.getByTestId('invite-success')).toBeVisible({
		timeout: 10_000,
	})

	const mail = await pollInvitationMail(email, 5_000)
	const inviteeContext = await browser.newContext({ ignoreHTTPSErrors: true })
	const inviteePage = await inviteeContext.newPage()
	await inviteePage.goto(mail.url, { waitUntil: 'networkidle' })
	await expect(
		inviteePage.getByTestId('accept-invitation-success'),
	).toBeVisible({ timeout: 15_000 })

	return { email, context: inviteeContext, page: inviteePage }
}

test.describe('setting a first password from /profile', () => {
	test.beforeEach(async ({ page }) => {
		// Sibling tests may have flipped Alice's active org; reset before
		// each scenario so /settings/organization/invite resolves to taller.
		await page.goto('/', { waitUntil: 'commit' })
		await setActiveOrgBySlug(page, 'taller')
	})

	test.describe('when a passwordless user opens /profile', () => {
		test('should render the set-password form, accept a new password, and flip to change-password', async ({
			page,
			browser,
		}) => {
			// GIVEN a freshly invited user with no credential row
			//   [profile/index.tsx — `!hasPassword && !passwordOptOut` branch]
			const bob = await bootPasswordlessInvitee(page, browser, 'pwd-set')

			// WHEN Bob opens the settings profile page
			await bob.page.goto('/settings/profile', { waitUntil: 'networkidle' })

			// THEN the set-password form should render — not the change-password
			// form, and not the opted-out confirmed state.
			await expect(bob.page.getByTestId('set-password-form')).toBeVisible({
				timeout: 10_000,
			})
			await expect(bob.page.getByTestId('change-password-form')).toHaveCount(0)
			await expect(
				bob.page.getByTestId('profile-password-card-opted-out'),
			).toHaveCount(0)

			// WHEN Bob fills both password fields and submits
			//   [set-password-route.ts — credential row written branch]
			await bob.page.getByTestId('set-password-new').fill(NEW_PASSWORD)
			await bob.page.getByTestId('set-password-confirm').fill(NEW_PASSWORD)

			// Diagnostic: confirm fill() actually landed in the DOM input
			// (the form reads via FormData on submit, not React state).
			const newInputValue = await bob.page
				.getByTestId('set-password-new')
				.inputValue()
			expect(
				newInputValue,
				'fill() should have written into the password input',
			).toBe(NEW_PASSWORD)

			// Capture the set-password response so we can diagnose 401/200.
			const setPasswordResponse = bob.page.waitForResponse(
				resp =>
					resp.url().includes('/auth/set-password') &&
					resp.request().method() === 'POST',
				{ timeout: 5_000 },
			)
			await bob.page.getByTestId('set-password-submit').click()
			const resp = await setPasswordResponse
			expect(
				resp.status(),
				`POST /auth/set-password returned ${resp.status()} — body=${await resp.text()}`,
			).toBe(200)

			// THEN the loader re-invalidates and the card flips to the
			// change-password form (proving the credential row now exists).
			await expect(bob.page.getByTestId('change-password-form')).toBeVisible({
				timeout: 10_000,
			})
			await expect(bob.page.getByTestId('set-password-form')).toHaveCount(0)

			await bob.context.close()
		})
	})

	test.describe('when a passwordless user opts out from the profile card', () => {
		test('should swap to the passwordless-only confirmed state and offer an undo', async ({
			page,
			browser,
		}) => {
			// GIVEN a passwordless invitee on /profile
			//   [profile/index.tsx — `passwordless-only-toggle` button]
			const bob = await bootPasswordlessInvitee(page, browser, 'pwd-optout')
			await bob.page.goto('/settings/profile', { waitUntil: 'networkidle' })
			await expect(bob.page.getByTestId('set-password-form')).toBeVisible({
				timeout: 10_000,
			})

			// WHEN Bob clicks "I prefer passwordless"
			//   [security-state.ts — setPasswordOptOut(true)]
			await bob.page.getByTestId('passwordless-only-toggle').click()

			// THEN the opted-out card replaces the set-password form.
			await expect(
				bob.page.getByTestId('profile-password-card-opted-out'),
			).toBeVisible({ timeout: 10_000 })
			await expect(bob.page.getByTestId('set-password-form')).toHaveCount(0)

			// WHEN Bob undoes via the "Change my mind" link
			//   [security-state.ts — setPasswordOptOut(false)]
			await bob.page.getByTestId('passwordless-only-undo').click()

			// THEN the set-password form returns, proving the flag flipped
			// back and the loader re-fetched.
			await expect(bob.page.getByTestId('set-password-form')).toBeVisible({
				timeout: 10_000,
			})
			await expect(
				bob.page.getByTestId('profile-password-card-opted-out'),
			).toHaveCount(0)

			await bob.context.close()
		})
	})

	test.describe('when a password user (Alice) opens /profile', () => {
		test('should render the change-password form and reject a wrong current password', async ({
			page,
		}) => {
			// GIVEN Alice, who already has a credential row from the seed
			//   [profile/index.tsx — `hasPassword === true` branch]
			await page.goto('/settings/profile', { waitUntil: 'networkidle' })

			// THEN the change-password form should render, not the set form.
			await expect(page.getByTestId('change-password-form')).toBeVisible({
				timeout: 10_000,
			})
			await expect(page.getByTestId('set-password-form')).toHaveCount(0)

			// WHEN Alice submits with a wrong current password
			//   [profile/index.tsx — `INVALID_PASSWORD` branch on changePassword]
			await page
				.getByTestId('change-password-current')
				.fill('this-is-not-her-current-password')
			await page
				.getByTestId('change-password-new')
				.fill('would-be-the-new-password-123')
			await page
				.getByTestId('change-password-confirm')
				.fill('would-be-the-new-password-123')
			await page.getByTestId('change-password-submit').click()

			// THEN the wrong-current error region surfaces. We do NOT proceed
			// to actually change Alice's password — sibling tests rely on the
			// seed credentials for auth.setup. Cleaning that up across the
			// suite is out of scope for this test.
			await expect(page.getByTestId('change-password-error')).toBeVisible({
				timeout: 10_000,
			})
		})
	})
})
