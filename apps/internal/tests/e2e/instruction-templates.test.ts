import { expect, test } from '@playwright/test'

import { setActiveOrgBySlug } from './helpers/set-active-org'

// Reading and writing an instruction template, and the `?read=` address that
// carries it. Standing guidance steers every agent run, so anyone in the
// organization can read and keep any template the list returns — the shared
// ones as well as their own — and reading turns into writing in the same
// dialog rather than handing over to a second one. Reading has its own key
// rather than sharing `?dlg=` with the editors, so it can open over a
// half-written stack without discarding it.
// Selectors verified against:
//   apps/internal/src/routes/settings/profile/templates.tsx
//     (new-stack)
//   apps/internal/src/components/instructions/template-library.tsx
//     (template-row, template-view-{id}, org-template-row,
//      org-template-view-{id}, template-edit-{id})
//   apps/internal/src/components/instructions/template-dialog.tsx
//     (template-view-dialog, -body, -edit, org-template-view-dialog,
//      template-editor-name, template-editor-body, template-editor-submit,
//      template-editor-cancel, template-editor-discard)
//   apps/internal/src/components/instructions/stack-picker.tsx (stack-read-{id})
//   apps/internal/src/components/instructions/stack-editor.tsx (stack-name)

test.beforeEach(async ({ page }) => {
	await page.goto('/', { waitUntil: 'commit' })
	await setActiveOrgBySlug(page, 'taller')
})

test.describe('reading an instruction template', () => {
	test.describe('when the template belongs to the organization', () => {
		test('should open it for reading and offer to edit it', async ({
			page,
		}) => {
			// GIVEN the personal templates page, which lists org templates too
			await page.goto('/settings/profile/templates', {
				waitUntil: 'networkidle',
			})
			await expect(page.getByTestId('template-row').first()).toBeVisible()

			// AND a row the reader does not personally own, marked "Org"
			const orgRow = page
				.getByTestId('template-row')
				.filter({ hasText: 'Org' })
				.first()
			await expect(orgRow).toBeVisible()

			// WHEN its Read button is used
			await orgRow.getByRole('button', { name: /^Read / }).click()

			// THEN the template's guidance is on screen
			await expect(page.getByTestId('template-view-dialog')).toBeVisible()
			await expect(
				page.getByTestId('template-view-dialog-body'),
			).not.toBeEmpty()

			// AND it can be edited, because shared guidance is everyone's to keep
			await expect(page.getByTestId('template-view-dialog-edit')).toBeVisible()
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

	test.describe('when a reader opens a template on the organization page', () => {
		test('should show the guidance and offer to edit it', async ({ page }) => {
			// GIVEN the org templates page
			await page.goto('/settings/organization/templates', {
				waitUntil: 'networkidle',
			})
			const row = page.getByTestId('org-template-row').first()
			await expect(row).toBeVisible()

			// WHEN a template is opened for reading
			await row.getByRole('button', { name: /^Read / }).click()

			// THEN its guidance is readable, and it can be changed from here
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

test.describe('managing an instruction template', () => {
	test.describe('when a reader edits and saves without leaving the dialog', () => {
		test('should stay open and show the text that was just saved', async ({
			page,
		}) => {
			const body = `e2e rewritten ${Date.now()}`
			await page.goto('/settings/profile/templates', {
				waitUntil: 'networkidle',
			})
			const ownRow = page
				.getByTestId('template-row')
				.filter({ hasText: 'Mine' })
				.first()
			await expect(ownRow).toBeVisible()

			// GIVEN one of their own templates open for reading. The Read button
			// names the template, so the name comes from there rather than position.
			const readButton = ownRow.getByRole('button', { name: /^Read / })
			const name = (
				(await readButton.getAttribute('aria-label')) ?? ''
			).replace(/^Read /, '')
			await readButton.click()
			const dialog = page.getByTestId('template-view-dialog')
			await expect(dialog).toBeVisible()

			// WHEN Edit turns the same dialog into the editor, seeded with it
			await page.getByTestId('template-view-dialog-edit').click()
			await expect(page.getByTestId('template-editor-name')).toHaveValue(
				name.trim(),
			)

			// AND the guidance is rewritten and saved
			await page.getByTestId('template-editor-body').fill(body)
			await page.getByTestId('template-editor-submit').click()

			// THEN the dialog never closed, and it now reads back the saved text
			await expect(dialog).toBeVisible()
			await expect(page.getByTestId('template-editor-name')).toBeHidden()
			await expect(page.getByTestId('template-view-dialog-body')).toContainText(
				body,
			)
		})
	})

	test.describe('when a reader cancels after typing', () => {
		test('should ask before throwing the draft away', async ({ page }) => {
			await page.goto('/settings/profile/templates', {
				waitUntil: 'networkidle',
			})
			const ownRow = page
				.getByTestId('template-row')
				.filter({ hasText: 'Mine' })
				.first()
			await expect(ownRow).toBeVisible()
			await ownRow.getByRole('button', { name: /^Read / }).click()
			await page.getByTestId('template-view-dialog-edit').click()

			// GIVEN a body that has been typed into but not saved
			await page.getByTestId('template-editor-body').fill('e2e unsaved draft')

			// WHEN Cancel steps back towards reading
			await page.getByTestId('template-editor-cancel').click()

			// THEN it asks first rather than dropping the draft
			await expect(page.getByTestId('template-editor-discard')).toBeVisible()
			await expect(page.getByTestId('template-editor-body')).toBeVisible()

			// AND discarding returns to reading, with the dialog still open
			await page.getByTestId('template-editor-discard').click()
			await expect(page.getByTestId('template-view-dialog')).toBeVisible()
			await expect(page.getByTestId('template-editor-body')).toBeHidden()
		})
	})

	test.describe('when a template is handed to a colleague', () => {
		test('should leave the giver’s library once it is theirs', async ({
			page,
		}) => {
			const name = `e2e-handover-${Date.now()}`
			await page.goto('/settings/profile/templates', {
				waitUntil: 'networkidle',
			})

			// GIVEN a template of their own, written for this test so the handover
			// can't take a seeded row away from the rest of the suite
			await page.getByTestId('templates-new').click()
			await page.getByTestId('template-editor-name').fill(name)
			await page.getByTestId('template-editor-body').fill('e2e handover body')
			await page.getByTestId('template-editor-submit').click()
			const row = page.getByTestId('template-row').filter({ hasText: name })
			await expect(row).toBeVisible()
			const testId =
				(await row
					.getByRole('button', { name: /^Read / })
					.getAttribute('data-testid')) ?? ''
			const id = testId.replace('template-view-', '')

			// WHEN it is handed to somebody else in the organization
			await page.getByTestId(`template-more-${id}`).click()
			await page.getByTestId(`template-transfer-${id}`).click()
			await expect(page.getByTestId('template-transfer-confirm')).toBeVisible()
			await page.getByTestId('template-transfer-confirm-target').click()
			await page
				.locator('[data-testid^="template-transfer-confirm-option-"]')
				.first()
				.click()
			await page.getByTestId('template-transfer-confirm-button').click()

			// THEN it is gone from the giver's library, because it is no longer theirs
			await expect(row).toBeHidden()
		})
	})

	test.describe("when a row's Edit button is used instead of the reader", () => {
		test('should open straight into the editor at that address', async ({
			page,
		}) => {
			await page.goto('/settings/profile/templates', {
				waitUntil: 'networkidle',
			})
			const row = page.getByTestId('template-row').first()
			await expect(row).toBeVisible()
			const testId =
				(await row
					.getByRole('button', { name: /^Read / })
					.getAttribute('data-testid')) ?? ''
			const id = testId.replace('template-view-', '')
			expect(id).not.toHaveLength(0)

			// WHEN the row's own Edit button is used
			await page.getByTestId(`template-edit-${id}`).click()

			// THEN the editor is open, and the address addresses it so a reload keeps it
			await expect(page.getByTestId('template-editor-name')).toBeVisible()
			expect(decodeURIComponent(page.url())).toContain('"kind":"edit"')
		})
	})
})
