import { expect, test } from '@playwright/test'

// Quick Capture is the global interaction-logging dialog. It lives on
// every page (mounted by `<QuickCaptureProvider>` once at the shell)
// and opens via the "Log" CTA in the TopBar.
//
// Selectors verified against:
//   apps/internal/src/components/layout/top-bar.tsx (Log button text)
//   apps/internal/src/components/interactions/quick-capture-dialog.tsx
//     (quick-capture, quick-capture-form, quick-capture-company,
//      quick-capture-subject, quick-capture-summary, quick-capture-submit)
//
// Server side: POST /interactions creates the row AND updates the
// company's `lastContactedAt` in the same transaction (see
// packages/controllers/src/routes/interactions.ts). Success closes the
// dialog and pops a toast — we assert the close, which is the strongest
// observable: the popup leaves the DOM iff the API call resolved Success.
//
// Auth: this test runs in the `authed` project and inherits Alice's
// session cookie from the `setup` project's storageState.

test.describe('quick capture', () => {
	test.describe('when the authenticated user logs an interaction against a seeded company', () => {
		test('the interaction is created and the dialog closes', async ({
			page,
		}) => {
			// GIVEN Alice is on the dashboard (cookie injected by setup)
			// AND the page has reached networkidle so React has had time
			// to hydrate the TopBar — the Log button uses a plain onClick
			// (no form action), so a click before hydration would no-op
			await page.goto('/', { waitUntil: 'networkidle' })

			// WHEN she opens the QuickCapture dialog from the TopBar
			// (testid disambiguates from per-task "Log an interaction"
			// buttons that share the accessible name "Log")
			await page.getByTestId('topbar-log-trigger').click()

			// THEN the dialog is visible
			await expect(page.getByTestId('quick-capture')).toBeVisible()
			await expect(page.getByTestId('quick-capture-form')).toBeVisible()

			// AND when she selects a seeded company and fills subject + summary
			const companySelect = page.getByTestId('quick-capture-company')
			await expect(companySelect).toBeVisible()
			const firstCompanyId = await companySelect
				.locator('option:not([value=""])')
				.first()
				.getAttribute('value')
			expect(
				firstCompanyId,
				'seed should provide at least one company',
			).not.toBeNull()
			await companySelect.selectOption(firstCompanyId as string)
			await page
				.getByTestId('quick-capture-subject')
				.fill('e2e — quick capture smoke')
			await page
				.getByTestId('quick-capture-summary')
				.fill('Logged via Playwright to verify the QuickCapture round-trip.')

			// AND submits the form
			await page.getByTestId('quick-capture-submit').click()

			// THEN the dialog leaves the DOM — only happens after the
			// `interactions.create` mutation resolves Success and the
			// dialog calls close(); a failure path keeps the popup open
			// with an error message, so this assertion proves the row
			// was actually written
			await expect(page.getByTestId('quick-capture')).toHaveCount(0)
		})
	})
})
