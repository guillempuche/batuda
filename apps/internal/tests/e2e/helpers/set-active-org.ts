import { expect, type Page } from '@playwright/test'

// Single source of truth for the API base — auth.setup, the org-switcher
// afterEach, and settings-organization beforeEach all need to call
// `/auth/organization/set-active`. Hardcoding the URL three times made the
// suite fragile to BASE_URL overrides; this helper resolves the API host
// from the test's E2E_API_URL env var, falling back to the dev portless
// host that Playwright already targets.
const API_URL = process.env['E2E_API_URL'] ?? 'https://api.batuda.localhost'

export async function setActiveOrgBySlug(
	page: Page,
	slug: string,
): Promise<void> {
	const result = await page.evaluate(
		async ({ apiBase, organizationSlug }) => {
			const res = await fetch(`${apiBase}/auth/organization/set-active`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ organizationSlug }),
			})
			return { status: res.status, body: (await res.text()).slice(0, 200) }
		},
		{ apiBase: API_URL, organizationSlug: slug },
	)
	expect(
		result.status,
		`set-active(${slug}) failed: ${result.status} ${result.body}`,
	).toBe(200)
}
