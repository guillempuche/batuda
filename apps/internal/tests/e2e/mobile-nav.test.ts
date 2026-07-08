import { execSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

// The mobile bottom belt folds the sections into four grouped slots so it
// never overflows as sections are added. Verifies the belt stays within the
// viewport and that Research is reachable through the "Records" group.

const DATABASE_URL =
	process.env['E2E_DATABASE_URL'] ??
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

// The floating email-draft dock is fixed above the bottom belt; a seeded
// draft would sit over the nav knobs and swallow the tap. Clear drafts so the
// belt is the topmost thing at the bottom of a phone screen (the draft-flow
// tests create their own drafts, so this doesn't starve them).
test.beforeAll(() => {
	execSync(`psql "${DATABASE_URL}" -tA -c "delete from email_drafts"`, {
		encoding: 'utf8',
	})
})

test.describe('mobile navigation', () => {
	test.use({ viewport: { width: 390, height: 844 } })

	test.describe('when the app is viewed on a phone-width screen', () => {
		test('should show four grouped belt slots without horizontal overflow', async ({
			page,
		}) => {
			// GIVEN a phone-width viewport on the dashboard
			await page.goto('/', { waitUntil: 'networkidle' })

			// THEN the belt shows the grouped slots (two direct, two groups)
			await expect(page.getByTestId('nav-pipeline')).toBeVisible()
			await expect(page.getByTestId('nav-records')).toBeVisible()
			await expect(page.getByTestId('nav-comms')).toBeVisible()
			await expect(page.getByTestId('nav-settings')).toBeVisible()

			// AND the page does not scroll sideways
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - window.innerWidth,
			)
			expect(overflow).toBeLessThanOrEqual(1)
		})

		test('should reach Research through the Records group', async ({
			page,
		}) => {
			// GIVEN the dashboard on a phone
			await page.goto('/', { waitUntil: 'networkidle' })

			// WHEN the reviewer opens the Records group and taps Research
			// (retry the group tap until the popover opens — the trigger's
			// handler may attach a beat after hydration; don't re-tap while it's
			// already open, which would toggle it shut)
			const researchLink = page.getByTestId('nav-research')
			await expect(async () => {
				if (!(await researchLink.isVisible().catch(() => false))) {
					await page.getByTestId('nav-records').click()
				}
				await expect(researchLink).toBeVisible({ timeout: 1500 })
			}).toPass()
			await researchLink.click()

			// THEN the research section loads
			await page.waitForURL(/\/research$/)
		})
	})
})
