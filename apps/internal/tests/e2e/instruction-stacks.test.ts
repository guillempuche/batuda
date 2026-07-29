import { expect, test } from '@playwright/test'

import { setActiveOrgBySlug } from './helpers/set-active-org'

// The instruction stacks sections, personal and organization-wide.
// A stack is a named, ordered group of instruction templates for one agent;
// exactly one per agent can be the default that applies when a run names none.
// The organization's default is admin-only, and unsetting it leaves every
// member who hasn't picked their own running with no shared guidance.
// Selectors verified against:
//   apps/internal/src/routes/settings/profile/templates.tsx
//     (new-stack, inherit-banner, use-org-default)
//   apps/internal/src/routes/settings/organization/templates.tsx
//     (org-default-banner, clear-org-default, org-default-clear-confirm)
//   apps/internal/src/components/instructions/stack-list.tsx (stack-row)
//   apps/internal/src/components/instructions/stack-editor.tsx
//     (stack-editor, stack-name, stack-make-default, stack-save, stack-cancel)
//   apps/internal/src/components/instructions/stack-picker.tsx (stack-add-{id})

test.beforeEach(async ({ page }) => {
	await page.goto('/', { waitUntil: 'commit' })
	await setActiveOrgBySlug(page, 'taller')
})

test.describe('instruction stacks', () => {
	test.describe('when the member already has a default stack (Alice in Taller)', () => {
		test('should list the stack and say which one is followed', async ({
			page,
		}) => {
			// GIVEN Alice opens her instruction templates page
			await page.goto('/settings/profile/templates', {
				waitUntil: 'networkidle',
			})

			// THEN her seeded research stack is listed
			await expect(page.getByTestId('stack-row').first()).toBeVisible()
			await expect(page.getByTestId('stack-row').first()).toContainText(
				'default',
			)
			// AND the banner reports she follows her own stack, offering the org one
			await expect(page.getByTestId('inherit-banner')).toBeVisible()
			await expect(page.getByTestId('use-org-default')).toBeVisible()
		})
	})

	test.describe('when the member creates another named stack', () => {
		test('should save it, list it, and move the default onto it', async ({
			page,
		}) => {
			const name = `e2e-stack-${Date.now()}`
			await page.goto('/settings/profile/templates', {
				waitUntil: 'networkidle',
			})
			// The list arrives from its own request after the page settles, so count
			// only once a row is on screen — otherwise the baseline reads zero.
			await expect(page.getByTestId('stack-row').first()).toBeVisible()
			const stacksBefore = await page.getByTestId('stack-row').count()
			// Remember which stack currently holds the default so it can be put back
			// afterwards — the default is a single seat, and the first test in this
			// file expects the seeded stack to still hold it.
			const defaultBefore =
				(await page
					.getByTestId('stack-row')
					.filter({ hasText: 'Default' })
					.first()
					.locator('span')
					.first()
					.textContent()) ?? ''

			// GIVEN the stack editor is open
			await page.getByTestId('new-stack').click()
			await expect(page.getByTestId('stack-editor')).toBeVisible()

			// WHEN a name and one template are chosen and the stack is saved
			await page.getByTestId('stack-name').fill(name)
			await page.locator('[data-testid^="stack-add-"]').first().click()
			await page.getByTestId('stack-save').click()

			// THEN it joins the list
			await expect(page.getByTestId('stack-editor')).toBeHidden()
			await expect(page.getByTestId('stack-row')).toHaveCount(stacksBefore + 1)
			const created = page
				.getByTestId('stack-row')
				.filter({ hasText: name })
				.first()
			await expect(created).toBeVisible()

			// AND making it the default moves the badge off the previous one
			await page.getByLabel(`Make ${name} the default`).click()
			await expect(created).toContainText('Default')
			await expect(page.getByLabel(`Make ${name} the default`)).toHaveCount(0)

			// Hand the default back and remove what this test made, so running the
			// file twice in a row still starts from the seeded arrangement.
			await page.getByLabel(`Make ${defaultBefore.trim()} the default`).click()
			await expect(created).not.toContainText('Default')
			await created.getByLabel(`Delete ${name}`).click()
			await page.getByTestId('stack-delete-confirm-button').click()
			await expect(page.getByTestId('stack-row')).toHaveCount(stacksBefore)
		})

		test('should keep the save disabled until a name and a template are picked', async ({
			page,
		}) => {
			// GIVEN the stack editor is open on an empty draft
			await page.goto('/settings/profile/templates', {
				waitUntil: 'networkidle',
			})
			await page.getByTestId('new-stack').click()

			// THEN saving is blocked until both a name and a template exist
			await expect(page.getByTestId('stack-save')).toBeDisabled()
			await page.getByTestId('stack-name').fill('e2e-incomplete')
			await expect(page.getByTestId('stack-save')).toBeDisabled()
			await page.locator('[data-testid^="stack-add-"]').first().click()
			await expect(page.getByTestId('stack-save')).toBeEnabled()

			// AND cancelling closes the editor without adding a stack
			await page.getByTestId('stack-cancel').click()
			await expect(page.getByTestId('stack-editor')).toBeHidden()
			await expect(
				page.getByTestId('stack-row').filter({ hasText: 'e2e-incomplete' }),
			).toHaveCount(0)
		})
	})
	test.describe('when an admin clears the organization default', () => {
		test('should stop showing a default until another is set', async ({
			page,
		}) => {
			await page.goto('/settings/organization/templates', {
				waitUntil: 'networkidle',
			})

			// GIVEN an org stack marked as the default
			const banner = page.getByTestId('org-default-banner')
			const stackRow = page.getByTestId('stack-row').first()
			await expect(stackRow).toBeVisible()
			if (!(await banner.isVisible())) {
				await stackRow.getByRole('button', { name: /^Make / }).click()
			}
			await expect(banner).toBeVisible()

			// WHEN the default is cleared
			await page.getByTestId('clear-org-default').click()
			await page.getByTestId('org-default-clear-confirm-button').click()

			// THEN nothing is held up as the organization's default any more
			await expect(banner).toBeHidden()

			// AND another stack can be made the default, putting one back
			await stackRow.getByRole('button', { name: /^Make / }).click()
			await expect(banner).toBeVisible()
		})
	})
})
