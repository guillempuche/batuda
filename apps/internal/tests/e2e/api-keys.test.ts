import { expect, test } from '@playwright/test'

import { setActiveOrgBySlug } from './helpers/set-active-org'

// Org-owned API key management under /settings/api-keys. The flow exercises
// the full lifecycle against the live stack: minting a key returns the
// plaintext secret exactly once (the reveal dialog), the redacted row then
// appears in the list, and deleting it removes the row. The clipboard
// assertion needs the headless context to grant clipboard-write, granted
// per-test below.

// Reset Alice to Taller before every scenario — sibling files (org-switch)
// flip her active org, and the API-key endpoints resolve the active org
// from the session, so without this the list would belong to the wrong
// workspace. We navigate to / first because page.evaluate on about:blank
// can't issue a same-origin-cookie'd fetch to the API host.
test.beforeEach(async ({ page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write'])
	await page.goto('/', { waitUntil: 'commit' })
	await setActiveOrgBySlug(page, 'taller')
})

test.describe('settings — API keys', () => {
	test.describe('when an org member mints and revokes a key', () => {
		test('should reveal the secret once, list the key, then delete it', async ({
			page,
		}) => {
			// GIVEN Alice opens the Settings hub, which lands on the profile
			// page, and follows the API-keys link
			await page.goto('/settings', { waitUntil: 'networkidle' })
			await expect(page).toHaveURL(/\/settings\/profile$/)
			await page.getByTestId('settings-nav-api-keys').click()
			await expect(page).toHaveURL(/\/settings\/api-keys$/)

			// AND a uniquely-named key so parallel seed data can't collide
			const keyName = `e2e-key-${Date.now()}`

			// WHEN she fills the create form and submits
			await page.getByTestId('api-key-name').fill(keyName)
			await page.getByTestId('create-api-key').click()

			// THEN the one-time reveal dialog surfaces the full plaintext secret
			await expect(page.getByTestId('api-key-reveal')).toBeVisible({
				timeout: 10_000,
			})
			const secret = await page.getByTestId('api-key-secret').innerText()
			expect(
				secret.length,
				'the reveal dialog should show a non-empty plaintext key',
			).toBeGreaterThan(0)

			// WHEN she copies the secret to the clipboard
			await page.getByTestId('api-key-copy').click()

			// THEN the copy button confirms the copy happened
			await expect(page.getByTestId('api-key-copy')).toContainText(/copied/i)

			// AND the clipboard holds the exact secret
			const clipboard = await page.evaluate(() =>
				navigator.clipboard.readText(),
			)
			expect(clipboard).toBe(secret)

			// WHEN she closes the reveal dialog
			await page.getByTestId('api-key-reveal-close').click()

			// THEN the dialog is gone — the secret is no longer on screen
			await expect(page.getByTestId('api-key-reveal')).toHaveCount(0)

			// AND the newly-minted key appears in the list (redacted)
			const newRow = page
				.getByTestId('api-key-row')
				.filter({ hasText: keyName })
			await expect(newRow).toBeVisible({ timeout: 10_000 })
			await expect(newRow).not.toContainText(secret)

			// WHEN she clicks delete, the confirm dialog appears, and she
			// cancels — the key is left untouched
			await newRow.getByRole('button', { name: /delete/i }).click()
			await expect(page.getByTestId('api-key-delete-dialog')).toBeVisible()
			await page.getByTestId('api-key-delete-cancel').click()
			await expect(page.getByTestId('api-key-delete-dialog')).toHaveCount(0)
			await expect(newRow).toBeVisible()

			// WHEN she deletes it again and confirms in the dialog
			await newRow.getByRole('button', { name: /delete/i }).click()
			await page.getByTestId('api-key-delete-confirm').click()

			// THEN the row disappears from the list
			await expect(
				page.getByTestId('api-key-row').filter({ hasText: keyName }),
			).toHaveCount(0, { timeout: 10_000 })
		})
	})

	test.describe('when the legacy /profile URL is visited', () => {
		test('should redirect to /settings/profile', async ({ page }) => {
			// GIVEN the old top-level profile path
			// WHEN Alice navigates there directly
			await page.goto('/profile', { waitUntil: 'networkidle' })

			// THEN the route guard rewrites it to the settings location and
			// the profile card renders there
			await expect(page).toHaveURL(/\/settings\/profile$/)
			await expect(page.getByTestId('profile-card')).toBeVisible()
		})
	})
})
