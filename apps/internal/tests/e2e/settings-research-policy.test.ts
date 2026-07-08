import { expect, test } from '@playwright/test'

// The research budget screen (settings/organization/policy) reads the
// signed-in person's policy, lets an owner/admin edit the spend ceilings and
// the auto-apply threshold, and round-trips through the policy endpoints.

test.describe('research budget settings', () => {
	test.describe('when an owner edits the budget', () => {
		test('should persist a changed per-run budget across a reload', async ({
			page,
		}) => {
			// GIVEN the research budget screen
			await page.goto('/settings/organization/policy', {
				waitUntil: 'networkidle',
			})
			await expect(page.getByTestId('research-policy-form')).toBeVisible()

			// WHEN the per-run budget is changed and saved
			const budget = page.getByTestId('research-policy-budget')
			await budget.fill('7.25')
			await page.getByTestId('research-policy-save').click()

			// THEN the value survives a reload (it round-tripped to the server)
			await expect(async () => {
				await page.reload({ waitUntil: 'networkidle' })
				await expect(page.getByTestId('research-policy-budget')).toHaveValue(
					'7.25',
				)
			}).toPass()
		})

		test('should reveal the confidence slider when auto-apply is on', async ({
			page,
		}) => {
			// GIVEN the budget screen with auto-apply off
			await page.goto('/settings/organization/policy', {
				waitUntil: 'networkidle',
			})
			const threshold = page.getByTestId('research-policy-threshold')
			const toggle = page.getByTestId('research-policy-auto-apply-toggle')

			// WHEN auto-apply is turned on
			if (!(await threshold.isVisible())) {
				await toggle.click()
			}

			// THEN the minimum-confidence slider appears
			await expect(threshold).toBeVisible()
		})
	})
})
