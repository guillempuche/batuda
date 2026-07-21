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
	test('should reach the connections page from the settings nav and list the authorized clients', async ({
		page,
	}) => {
		// GIVEN the Settings hub, which lands on the profile page
		await page.goto('/settings', { waitUntil: 'networkidle' })
		await expect(page).toHaveURL(/\/settings\/profile$/)

		// WHEN she follows the Connections link. On a cold dev server the route
		// is still compiling, so a first click can land before the link is
		// interactive; clicking a link is idempotent, so retry until it moves.
		await expect(async () => {
			await page.getByTestId('settings-nav-mcp-connections').click()
			await expect(page).toHaveURL(/\/settings\/mcp\/connections$/, {
				timeout: 2_000,
			})
		}).toPass({ timeout: 15_000 })

		// THEN the page lists the clients the seed authorized for her — ChatGPT
		// across two organizations and Claude across one, which is what the page
		// exists to show. Asserting an empty state here would contradict the
		// seed, whose whole purpose is to give this page something to render.
		await expect(page.getByTestId('mcp-connection-row')).toHaveCount(2)
		await expect(
			page.getByTestId('mcp-connection-name').filter({ hasText: 'ChatGPT' }),
		).toBeVisible()
		await expect(
			page.getByTestId('mcp-connection-name').filter({ hasText: 'Claude' }),
		).toBeVisible()
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

	test('should show the org selector for a multi-org user when a client_id is present', async ({
		page,
	}) => {
		// GIVEN Alice (multi-org: taller + restaurant) opens consent with a
		// client_id. The signed oauth query is not validated client-side, so
		// the form renders; the org selector appears because she has >1 org.
		await page.goto('/oauth/consent?client_id=test-client', {
			waitUntil: 'networkidle',
		})

		// THEN the consent card renders with the client id and an org selector
		await expect(page.getByTestId('oauth-consent')).toBeVisible()
		await expect(page.getByTestId('oauth-consent-client')).toHaveText(
			'test-client',
		)
		await expect(page.getByTestId('oauth-consent-orgs')).toBeVisible()
		// Both orgs are listed and pre-checked (authorize-everywhere default).
		await expect(page.getByTestId('oauth-consent-org-taller')).toBeChecked()
		await expect(page.getByTestId('oauth-consent-org-restaurant')).toBeChecked()

		// AND unchecking one disables Allow until at least one is selected
		await page.getByTestId('oauth-consent-org-taller').uncheck()
		await expect(page.getByTestId('oauth-consent-allow')).toBeEnabled()
		await page.getByTestId('oauth-consent-org-restaurant').uncheck()
		await expect(page.getByTestId('oauth-consent-allow')).toBeDisabled()
	})
})
