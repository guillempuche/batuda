import { expect, test } from '@playwright/test'

import { setActiveOrgBySlug } from './helpers/set-active-org'

// The MCP OAuth UI: the connections settings page (where a member chooses which
// organizations each authorized AI client works in) and the consent screen. The
// full OAuth dance (a real client → authorize → login → consent → token) needs a
// live OAuth client, so this covers the routing, the listing, and the
// organization picker; the happy-path consent flow is validated against the dev
// stack manually.
//
// Both tests that change seeded data put it back afterwards, so a re-run — or a
// retry after a failure part-way through — starts where the seed left it. The
// restored removal then names whoever was signed in rather than the admin the
// seed named, which is why nothing asserts on that name. The root `test:e2e`
// rebuilds the sample data first, so a full run starts clean regardless.

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
		// across two organizations, Claude across one, and Codex cut off from
		// both, which is what the page exists to show. Asserting an empty state
		// here would contradict the seed, whose whole purpose is to give this
		// page something to render.
		await expect(page.getByTestId('mcp-connection-row')).toHaveCount(3)
		await expect(
			page.getByTestId('mcp-connection-name').filter({ hasText: 'ChatGPT' }),
		).toBeVisible()
		await expect(
			page.getByTestId('mcp-connection-name').filter({ hasText: 'Claude' }),
		).toBeVisible()
	})
})

test.describe('settings — choosing a connection’s organizations', () => {
	// Alice belongs to taller + restaurant, and the seed authorizes ChatGPT for
	// both — the state that leaves an assistant unable to say which one it means.
	const CHATGPT_CHANGE_ORGS = 'mcp-connection-change-orgs-mock-chatgpt-client'

	test.beforeEach(async ({ page }) => {
		await page.goto('/settings/mcp/connections', { waitUntil: 'networkidle' })
	})

	// Tick every organization back on, whatever the test left ChatGPT reaching,
	// so a re-run starts from the same place the seed left.
	test.afterEach(async ({ page }) => {
		await page.goto('/settings/mcp/connections', { waitUntil: 'networkidle' })
		await page.getByTestId(CHATGPT_CHANGE_ORGS).click()
		const orgCheckboxes = page
			.getByTestId('mcp-connection-orgs-dialog')
			.locator('[data-testid^="mcp-connection-org-pick-"]')
		const count = await orgCheckboxes.count()
		for (let i = 0; i < count; i++) {
			const box = orgCheckboxes.nth(i)
			if ((await box.getAttribute('aria-checked')) !== 'true') await box.click()
		}
		await page.getByTestId('mcp-connection-orgs-save').click()
		await expect(page.getByTestId('mcp-connection-orgs-dialog')).toBeHidden()
	})

	test('should narrow a two-organization connection down to one', async ({
		page,
	}) => {
		// GIVEN ChatGPT reaching both of Alice's organizations
		const chatgptRow = page
			.getByTestId('mcp-connection-row')
			.filter({ hasText: 'ChatGPT' })
		await expect(chatgptRow.getByTestId('mcp-connection-org')).toHaveCount(2)

		// WHEN she opens the picker and unticks all but the first organization
		await page.getByTestId(CHATGPT_CHANGE_ORGS).click()
		const dialog = page.getByTestId('mcp-connection-orgs-dialog')
		await expect(dialog).toBeVisible()
		const boxes = dialog.locator('[data-testid^="mcp-connection-org-pick-"]')
		await expect(boxes).toHaveCount(2)
		// Warned while more than one is ticked — an assistant cannot choose
		// between them, so this state is the one that leaves it stuck
		await expect(page.getByTestId('mcp-connection-orgs-warning')).toBeVisible()
		await boxes.nth(1).click()
		await expect(page.getByTestId('mcp-connection-orgs-warning')).toBeHidden()
		await page.getByTestId('mcp-connection-orgs-save').click()

		// THEN the connection is left reaching exactly one organization, which is
		// what makes it usable without the assistant being asked to pick
		await expect(dialog).toBeHidden()
		await expect(chatgptRow.getByTestId('mcp-connection-org')).toHaveCount(1)
	})

	test('should refuse to save when nothing is ticked', async ({ page }) => {
		// GIVEN the picker open on ChatGPT
		await page.getByTestId(CHATGPT_CHANGE_ORGS).click()
		const dialog = page.getByTestId('mcp-connection-orgs-dialog')
		const boxes = dialog.locator('[data-testid^="mcp-connection-org-pick-"]')

		// WHEN every organization is unticked
		const count = await boxes.count()
		for (let i = 0; i < count; i++) await boxes.nth(i).click()

		// THEN saving is refused here rather than at the server, which reads an
		// empty choice as "nobody has chosen" and would widen access instead of
		// removing it. Taking access away is what the revoke button is for
		await expect(page.getByTestId('mcp-connection-orgs-save')).toBeDisabled()
	})

	test('should offer back an organization the member removed, but not one an owner removed', async ({
		page,
	}) => {
		// GIVEN Codex, cut off from one organization by Alice and from the other
		// by that organization's owner
		const codexRow = page
			.getByTestId('mcp-connection-row')
			.filter({ hasText: 'Codex' })
		// It reaches nothing, and says so rather than claiming nothing was chosen
		await expect(codexRow.getByTestId('mcp-connection-unbound')).toHaveText(
			/no organization selected/i,
		)

		// WHEN she opens its picker
		await page
			.getByTestId('mcp-connection-change-orgs-mock-codex-client')
			.click()
		const dialog = page.getByTestId('mcp-connection-orgs-dialog')
		const boxes = dialog.locator('[data-testid^="mcp-connection-org-pick-"]')

		// THEN her own removal is offered back and the owner's is not — one of
		// them she can undo by choosing it again, the other she cannot
		await expect(dialog.getByText(/you removed this one/i)).toBeVisible()
		await expect(dialog.getByText(/an owner removed this one/i)).toBeVisible()
		await expect(boxes).toHaveCount(2)
		const enabled = await Promise.all([
			boxes.nth(0).isEnabled(),
			boxes.nth(1).isEnabled(),
		])
		expect(enabled.filter(Boolean)).toHaveLength(1)
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

test.describe('settings — allowing a stopped assistant back', () => {
	// Alice owns taller; Carol's Copilot is a connection of somebody else's, so
	// this is the case the rules allow — nobody may take back a removal aimed at
	// themselves. Stopping it again at the end leaves a row where the seed put
	// one, so a second run finds something to allow back.
	// Put the removal back however the test ended, including a failed attempt
	// part-way through — a retry that started from an allowed connection would
	// fail on the wrong assertion and stay red until someone reseeded by hand.
	test.afterEach(async ({ page }) => {
		await page.goto('/settings/mcp/connections', { waitUntil: 'networkidle' })
		const stillAllowed = page
			.getByTestId('mcp-org-connection-row')
			.filter({ hasText: 'Copilot' })
		if ((await stillAllowed.count()) > 0) {
			await stillAllowed.getByRole('button', { name: /revoke/i }).click()
			await page.getByTestId('mcp-org-revoke-confirm').click()
			await expect(page.getByTestId('mcp-org-blocked-row')).toHaveCount(1)
		}
	})

	test('should allow a stopped assistant back', async ({ page }) => {
		await page.goto('/settings/mcp/connections', { waitUntil: 'networkidle' })

		// GIVEN Carol's Copilot, which the seed has stopped in this organization.
		// It is listed rather than hidden, because this list is the only way back
		const blocked = page.getByTestId('mcp-org-blocked-row')
		await expect(blocked).toHaveCount(1)
		await expect(blocked).toContainText('Copilot')
		const active = page
			.getByTestId('mcp-org-connection-row')
			.filter({ hasText: 'Copilot' })
		await expect(active).toHaveCount(0)

		// WHEN the owner allows it back
		await blocked.getByRole('button', { name: /allow again/i }).click()

		// THEN it leaves the stopped list and can reach the organization again
		await expect(page.getByTestId('mcp-org-blocked-row')).toHaveCount(0)
		await expect(active).toHaveCount(1)

		// AND the keyboard lands on the heading of the list the row moved to.
		// The button it was on has gone with the row, so without this a keyboard
		// or screen-reader user is dropped back to the top of the document
		await expect(
			page.getByRole('heading', { name: /everyone's connections/i }),
		).toBeFocused()
	})
})
