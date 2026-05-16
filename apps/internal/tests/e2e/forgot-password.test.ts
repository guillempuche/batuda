import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

// End-to-end forgot-password flow. The flow under test:
//
//   1. Visitor clicks "Forgot password?" on /login → lands on /forgot-password.
//   2. Submits the email → frontend calls authClient.requestPasswordReset
//      with redirectTo=`${origin}/reset-password`.
//   3. Better Auth opaque-succeeds and writes a .md to .dev-inbox/
//      with `labels: password-reset`. The .md carries a URL like
//      ${apiHost}/auth/reset-password/${token}?callbackURL=${redirectTo}.
//   4. Visitor opens that URL → BA's reset-password/:token callback
//      origin-checks and redirects to `${redirectTo}?token=${token}`.
//   5. /reset-password renders, the visitor types a new password,
//      authClient.resetPassword({ newPassword, token }) updates the row.
//   6. Sign-in with the new password succeeds.
//
// Selectors verified against:
//   apps/internal/src/routes/forgot-password.tsx
//   apps/internal/src/routes/reset-password.tsx
//   apps/server/src/services/local-transactional-provider.ts (label key)

const INBOX_DIR = join(process.cwd(), '..', 'server', '.dev-inbox')

interface ResetMail {
	readonly file: string
	readonly url: string
}

// Polls .dev-inbox/ for a `password-reset`-labelled .md whose filename
// contains the recipient slug, then extracts the reset URL. Same shape
// as invite.test.ts's helper — the file appears asynchronously after
// the API responds.
async function pollResetMail(
	recipient: string,
	timeoutMs: number,
): Promise<ResetMail> {
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
				if (!body.includes('labels:') || !body.includes('password-reset')) {
					await new Promise(r => {
						setTimeout(r, 200)
					})
					continue
				}
				const urlMatch = body.match(
					/https?:\/\/[^\s]*\/auth\/reset-password\/[^\s]*/,
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
		`password-reset .md for ${recipient} did not appear within ${timeoutMs}ms (last error: ${String(lastErr)})`,
	)
}

test.describe('forgot-password end-to-end', () => {
	test.describe('when a registered user requests a reset', () => {
		test('should email a link, accept a new password via /reset-password, and let her sign back in', async ({
			page,
		}) => {
			// GIVEN Alice (admin@taller.cat is in the seed) opens /forgot-password
			//   [forgot-password.tsx — form branch]
			const recipient = 'admin@taller.cat'
			const newPassword = `reset-pwd-${Date.now()}`

			await page.goto('/forgot-password', { waitUntil: 'networkidle' })
			await expect(page.getByTestId('forgot-password-form')).toBeVisible()

			// WHEN she submits her email
			await page.getByTestId('forgot-password-email').fill(recipient)
			const requestResponse = page.waitForResponse(
				resp =>
					resp.url().includes('/auth/request-password-reset') &&
					resp.request().method() === 'POST',
				{ timeout: 5_000 },
			)
			await page.getByTestId('forgot-password-submit').click()
			const reqRes = await requestResponse
			expect(reqRes.status()).toBe(200)

			// THEN the success panel renders (opaque, even on unknown email)
			await expect(page.getByTestId('forgot-password-sent')).toBeVisible({
				timeout: 10_000,
			})

			// AND a .md should land in .dev-inbox/ with the reset URL
			//   [local-transactional-provider.ts — label: 'password-reset']
			const mail = await pollResetMail(recipient, 5_000)
			expect(mail.url).toContain('/auth/reset-password/')

			// WHEN she opens the URL — BA bounces to /reset-password?token=...
			//   [password.ts:152 — requestPasswordResetCallback redirect]
			await page.goto(mail.url, { waitUntil: 'networkidle' })
			await expect(page.getByTestId('reset-password-form')).toBeVisible({
				timeout: 10_000,
			})

			// AND she submits a new password
			//   [reset-password.tsx — submit branch]
			await page.getByTestId('reset-password-new').fill(newPassword)
			await page.getByTestId('reset-password-confirm').fill(newPassword)
			const resetResponse = page.waitForResponse(
				resp =>
					resp.url().includes('/auth/reset-password') &&
					resp.request().method() === 'POST',
				{ timeout: 5_000 },
			)
			await page.getByTestId('reset-password-submit').click()
			const resetRes = await resetResponse
			expect(
				resetRes.status(),
				`POST /auth/reset-password returned ${resetRes.status()}`,
			).toBe(200)

			// THEN the success panel renders
			await expect(page.getByTestId('reset-password-success')).toBeVisible({
				timeout: 10_000,
			})

			// AND she can sign in with the new password.
			await page.goto('/login', { waitUntil: 'networkidle' })
			await page.getByTestId('login-email').fill(recipient)
			await page.getByTestId('login-password').fill(newPassword)
			await page.getByTestId('login-submit').click()
			await page.waitForURL(/\/$/, { timeout: 10_000 })
			await expect(page.getByTestId('login-form')).toHaveCount(0)

			// Restore the seed password so auth.setup.ts's
			// `batuda-dev-2026` keeps the rest of the suite green.
			const restoreRes = await page.evaluate(
				async ({ current, restore }) => {
					const res = await fetch('/auth/change-password', {
						method: 'POST',
						credentials: 'include',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({
							currentPassword: current,
							newPassword: restore,
							revokeOtherSessions: false,
						}),
					})
					return res.ok
				},
				{ current: newPassword, restore: 'batuda-dev-2026' },
			)
			expect(restoreRes, 'failed to restore Alice seed password').toBe(true)
		})
	})

	test.describe('when an unregistered email is submitted', () => {
		test('should still render the opaque "check your inbox" panel (no enumeration)', async ({
			page,
		}) => {
			// GIVEN /forgot-password
			//   [password.ts:104 — silent-success branch]
			await page.goto('/forgot-password', { waitUntil: 'networkidle' })

			// WHEN an email that is not in `user` is submitted
			await page
				.getByTestId('forgot-password-email')
				.fill(`noone-${Date.now()}@example.invalid`)
			const response = page.waitForResponse(
				resp =>
					resp.url().includes('/auth/request-password-reset') &&
					resp.request().method() === 'POST',
				{ timeout: 5_000 },
			)
			await page.getByTestId('forgot-password-submit').click()

			// THEN the API still returns 200 and the same success panel renders
			const res = await response
			expect(res.status()).toBe(200)
			await expect(page.getByTestId('forgot-password-sent')).toBeVisible({
				timeout: 10_000,
			})
		})
	})

	test.describe('when the user lands on /reset-password without a token', () => {
		test('should render the invalid-link recovery state with a CTA back to /forgot-password', async ({
			page,
		}) => {
			// GIVEN no token (e.g. user copied a stale URL or hit the route directly)
			//   [reset-password.tsx — missing-token branch]
			await page.goto('/reset-password', { waitUntil: 'networkidle' })

			// THEN the form should NOT render, the error state should
			await expect(page.getByTestId('reset-password-form')).toHaveCount(0)
			await expect(page.getByTestId('reset-password-token-error')).toBeVisible({
				timeout: 10_000,
			})
			await expect(page.getByTestId('reset-password-request-new')).toBeVisible()
		})
	})
})
