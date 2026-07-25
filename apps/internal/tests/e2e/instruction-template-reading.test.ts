import { expect, test } from '@playwright/test'

import { setActiveOrgBySlug } from './helpers/set-active-org'

// Reading an instruction template, and the `?read=` address that carries it.
// Standing guidance steers every agent run, so a member can read any template
// the list returns — the organization's as well as their own — while editing
// stays with the owner. Reading has its own key rather than sharing `?dlg=`
// with the editors, so it can open over a half-written stack without
// discarding it.
// Selectors verified against:
//   apps/internal/src/routes/settings/profile/templates.tsx
//     (template-row, template-view-{id}, new-stack)
//   apps/internal/src/routes/settings/organization/templates.tsx
//     (org-template-row, org-template-view-{id}, org-template-view-dialog)
//   apps/internal/src/components/instructions/template-view-dialog.tsx
//     (template-view-dialog, -body, -edit)
//   apps/internal/src/components/instructions/template-editor-dialog.tsx
//     (template-editor-dialog, template-editor-name)
//   apps/internal/src/components/instructions/stack-picker.tsx (stack-read-{id})
//   apps/internal/src/components/instructions/stack-editor.tsx (stack-name)

test.beforeEach(async ({ page }) => {
	await page.goto('/', { waitUntil: 'commit' })
	await setActiveOrgBySlug(page, 'taller')
})

test.describe('reading an instruction template', () => {
	test.describe('when the template belongs to the organization, not the reader', () => {
		test('should open it for reading without offering to edit it', async ({
			page,
		}) => {
			// GIVEN the personal templates page, which lists org templates too
			await page.goto('/settings/profile/templates', {
				waitUntil: 'networkidle',
			})
			await expect(page.getByTestId('template-row').first()).toBeVisible()

			// AND a row the reader does not own, marked "Org"
			const orgRow = page
				.getByTestId('template-row')
				.filter({ hasText: 'Org' })
				.first()
			await expect(orgRow).toBeVisible()

			// WHEN its Read button is used
			await orgRow.getByRole('button', { name: /^Read / }).click()

			// THEN the template's guidance is on screen
			const dialog = page.getByTestId('template-view-dialog')
			await expect(dialog).toBeVisible()
			await expect(
				page.getByTestId('template-view-dialog-body'),
			).not.toBeEmpty()

			// AND no edit affordance is offered, because it is not theirs to change
			await expect(page.getByTestId('template-view-dialog-edit')).toBeHidden()
		})
	})

	test.describe('when the reader owns the template', () => {
		test('should offer Edit, and hand over to the editor seeded with it', async ({
			page,
		}) => {
			await page.goto('/settings/profile/templates', {
				waitUntil: 'networkidle',
			})
			const ownRow = page
				.getByTestId('template-row')
				.filter({ hasText: 'Mine' })
				.first()
			await expect(ownRow).toBeVisible()

			// GIVEN their own template open for reading. The Read button names the
			// template, so the name comes from there rather than from row position.
			const readButton = ownRow.getByRole('button', { name: /^Read / })
			const name = (
				(await readButton.getAttribute('aria-label')) ?? ''
			).replace(/^Read /, '')
			await readButton.click()
			await expect(page.getByTestId('template-view-dialog')).toBeVisible()

			// WHEN Edit is taken
			await page.getByTestId('template-view-dialog-edit').click()

			// THEN the editor replaces it, already holding that template
			await expect(page.getByTestId('template-editor-dialog')).toBeVisible()
			await expect(page.getByTestId('template-view-dialog')).toBeHidden()
			await expect(page.getByTestId('template-editor-name')).toHaveValue(
				name.trim(),
			)
			// AND the URL now addresses the editor rather than the reader
			expect(decodeURIComponent(page.url())).toContain('"kind":"edit"')
		})
	})

	test.describe('when a reader shares the link to an open template', () => {
		test('should reopen the same template on load, and close on Back', async ({
			page,
		}) => {
			await page.goto('/settings/profile/templates', {
				waitUntil: 'networkidle',
			})
			await expect(page.getByTestId('template-row').first()).toBeVisible()
			await page
				.getByTestId('template-row')
				.first()
				.getByRole('button', { name: /^Read / })
				.click()
			await expect(page.getByTestId('template-view-dialog')).toBeVisible()
			const title =
				(await page
					.getByTestId('template-view-dialog')
					.getByRole('heading')
					.first()
					.textContent()) ?? ''

			// GIVEN the address of the open template
			const shared = page.url()
			expect(shared).toContain('read=')

			// WHEN that address is loaded fresh
			await page.goto(shared, { waitUntil: 'networkidle' })

			// THEN the same template is open again
			await expect(page.getByTestId('template-view-dialog')).toBeVisible()
			await expect(
				page.getByTestId('template-view-dialog').getByRole('heading').first(),
			).toHaveText(title)

			// WHEN Back is pressed
			await page.goBack()

			// THEN the dialog closes and the address is clean again
			await expect(page.getByTestId('template-view-dialog')).toBeHidden()
			expect(page.url()).not.toContain('read=')
		})
	})

	test.describe('when the link names a template that no longer exists', () => {
		test('should settle on the list rather than an empty dialog', async ({
			page,
		}) => {
			// WHEN a link to a template id that is not in the organization is opened
			await page.goto(
				'/settings/profile/templates?read=00000000-0000-4000-8000-000000000000',
				{ waitUntil: 'networkidle' },
			)

			// THEN the page drops the dead link and shows the list
			await expect(page.getByTestId('template-row').first()).toBeVisible()
			await expect(page.getByTestId('template-view-dialog')).toBeHidden()
			await expect(page).toHaveURL(/\/settings\/profile\/templates$/)
		})
	})

	test.describe('when an edit link names a template the page cannot change', () => {
		test('should fall back to reading it instead of a dead address', async ({
			page,
		}) => {
			// GIVEN the id of an organization template, which the personal page
			// lists but cannot save
			await page.goto('/settings/profile/templates', {
				waitUntil: 'networkidle',
			})
			const orgRow = page
				.getByTestId('template-row')
				.filter({ hasText: 'Org' })
				.first()
			await expect(orgRow).toBeVisible()
			const testId =
				(await orgRow
					.getByRole('button', { name: /^Read / })
					.getAttribute('data-testid')) ?? ''
			const id = testId.replace('template-view-', '')
			expect(id).not.toHaveLength(0)

			// WHEN an edit link for it is opened
			const editLink = encodeURIComponent(JSON.stringify({ kind: 'edit', id }))
			await page.goto(`/settings/profile/templates?dlg=${editLink}`, {
				waitUntil: 'networkidle',
			})

			// THEN the template opens for reading, with no editor to save from
			await expect(page.getByTestId('template-view-dialog')).toBeVisible()
			await expect(page.getByTestId('template-editor-dialog')).toBeHidden()
			expect(page.url()).toContain('read=')
		})
	})

	test.describe('when a reader checks a template while building a stack', () => {
		test('should show it without losing the half-written stack', async ({
			page,
		}) => {
			const name = `e2e-draft-${Date.now()}`
			await page.goto('/settings/profile/templates', {
				waitUntil: 'networkidle',
			})

			// GIVEN a stack part-way through being written
			await page.getByTestId('new-stack').click()
			await expect(page.getByTestId('stack-editor')).toBeVisible()
			await page.getByTestId('stack-name').fill(name)
			await page.locator('[data-testid^="stack-add-"]').first().click()
			const picked = page.locator('[data-testid^="stack-read-"]').first()
			await expect(picked).toBeVisible()

			// WHEN one of its templates is opened for reading
			await picked.click()

			// THEN the guidance is on screen
			await expect(page.getByTestId('template-view-dialog')).toBeVisible()
			await expect(
				page.getByTestId('template-view-dialog-body'),
			).not.toBeEmpty()

			// AND the stack being written is still there, name and all
			await expect(page.getByTestId('stack-editor')).toBeVisible()
			await expect(page.getByTestId('stack-name')).toHaveValue(name)

			// AND closing the reader leaves the draft untouched
			await page.keyboard.press('Escape')
			await expect(page.getByTestId('template-view-dialog')).toBeHidden()
			await expect(page.getByTestId('stack-name')).toHaveValue(name)
		})
	})

	test.describe('when an admin reads a template on the organization page', () => {
		test('should show the guidance and offer to edit it', async ({ page }) => {
			// GIVEN the org templates page as an admin
			await page.goto('/settings/organization/templates', {
				waitUntil: 'networkidle',
			})
			const row = page.getByTestId('org-template-row').first()
			await expect(row).toBeVisible()

			// WHEN a template is opened for reading
			await row.getByRole('button', { name: /^Read / }).click()

			// THEN its guidance is readable, and an admin may change it
			await expect(page.getByTestId('org-template-view-dialog')).toBeVisible()
			await expect(
				page.getByTestId('org-template-view-dialog-body'),
			).not.toBeEmpty()
			await expect(
				page.getByTestId('org-template-view-dialog-edit'),
			).toBeVisible()
		})
	})
})
