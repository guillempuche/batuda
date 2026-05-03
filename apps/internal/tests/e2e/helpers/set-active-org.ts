import { expect, type Page } from '@playwright/test'

// Single source of truth for the API base — auth.setup, the org-switcher
// afterEach, and settings-organization beforeEach all need to call
// `/auth/organization/set-active`. Hardcoding the URL three times made
// the suite fragile to BASE_URL overrides; this helper resolves the API
// host from `E2E_API_URL` if set, otherwise hits the same origin as the
// page. Same-origin is the default in dev because the session cookie
// lives host-only on `batuda.localhost` (Vite proxies `/auth/*` to the
// API and rewrites away the `Domain` attribute) — calling the API host
// directly would not attach the cookie.
const API_URL = process.env['E2E_API_URL'] ?? ''

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
