import { expect, test } from '@playwright/test'

import { setActiveOrgBySlug } from './helpers/set-active-org'

// The /settings/mcp help page: reachable from the settings nav, lists the chat
// interfaces (OAuth) first and the coding tools (API key) last, and gives every
// snippet a copy button. The clipboard write + screen-reader announce are
// unit-level concerns of PriCopyButton; this covers routing, render, and order.

test.beforeEach(async ({ page }) => {
	await page.goto('/', { waitUntil: 'commit' })
	await setActiveOrgBySlug(page, 'taller')
})

test.describe('settings — connect AI tools (MCP)', () => {
	test('should reach the help page from the settings nav and render its sections', async ({
		page,
	}) => {
		// GIVEN the Settings hub, which lands on the profile page
		await page.goto('/settings', { waitUntil: 'networkidle' })
		await expect(page).toHaveURL(/\/settings\/profile$/)

		// WHEN she follows the Connect AI tools link
		await page.getByTestId('settings-nav-mcp-setup').click()

		// THEN the help page loads with its heading and snippet copy buttons
		await expect(page).toHaveURL(/\/settings\/mcp\/?$/)
		await expect(
			page.getByRole('heading', { name: /connect ai tools over mcp/i }),
		).toBeVisible()
		await expect(page.getByTestId('mcp-copy-url')).toBeVisible()
		await expect(page.getByTestId('mcp-copy-claude-code')).toBeVisible()
	})

	test('should list the chat interfaces before the coding tools', async ({
		page,
	}) => {
		// GIVEN the help page
		await page.goto('/settings/mcp', { waitUntil: 'networkidle' })

		// WHEN its section titles are read top to bottom
		const titles = await page
			.getByRole('heading', { level: 3 })
			.allTextContents()

		// THEN the popular chat interfaces come first and the coding tools last
		const chatIndex = titles.findIndex(title => /chat interfaces/i.test(title))
		const codingIndex = titles.findIndex(title => /coding tools/i.test(title))
		expect(chatIndex).toBeGreaterThanOrEqual(0)
		expect(codingIndex).toBeGreaterThan(chatIndex)
	})
})
