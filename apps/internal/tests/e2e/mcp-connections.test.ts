import { expect, test } from '@playwright/test'

import { setActiveOrgBySlug } from './helpers/set-active-org'

// The MCP OAuth UI: the connections settings page (where a member binds each
// authorized AI client to an org) and the consent screen. The full OAuth dance
// (a real client → authorize → login → consent → token) needs a live OAuth
// client, so this covers the routing + the unauthenticated/empty states; the
// happy-path consent flow is validated against the dev stack manually.

test.beforeEach(async ({ page }) => {
	await page.goto('/', { waitUntil: 'commit' })
	await setActiveOrgBySlug(page, 'taller')
})

test.describe('settings — MCP connections', () => {
	test('should reach the connections page from the settings nav and show the empty state', async ({
		page,
	}) => {
		// GIVEN the Settings hub, which lands on the profile page
		await page.goto('/settings', { waitUntil: 'networkidle' })
		await expect(page).toHaveURL(/\/settings\/profile$/)

		// WHEN she follows the Connections link
		await page.getByTestId('settings-nav-mcp-connections').click()

		// THEN the connections page loads and shows the empty state (no clients
		// authorized yet)
		await expect(page).toHaveURL(/\/settings\/mcp\/connections$/)
		await expect(page.getByTestId('mcp-connections-empty')).toBeVisible()
	})
})

test.describe('OAuth consent', () => {
	test('should show nothing-to-authorize when opened without an authorize request', async ({
		page,
	}) => {
		// GIVEN the consent route opened directly (no signed authorize query)
		// WHEN it renders for the signed-in user
		await page.goto('/oauth/consent', { waitUntil: 'networkidle' })

		// THEN it explains there's nothing to authorize rather than a broken form
		await expect(page.getByText(/nothing to authorize/i)).toBeVisible()
	})
})
