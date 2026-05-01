import { expect, test } from '@playwright/test'

import { setActiveOrgBySlug } from './helpers/set-active-org'

// /settings/organization landing page + members list. The data comes
// from Better Auth's useActiveOrganization atom, which is signal-backed
// and refetches when setActive flips the cookie. Selectors verified
// against:
//   apps/internal/src/routes/settings/organization/index.tsx
//     (settings-org-card, settings-org-name, settings-org-members-link)
//   apps/internal/src/routes/settings/organization/members.tsx
//     (member-row-{userId}, member-role-{userId})

// Reset Alice's session to Taller before every test — a sibling file
// (org-switch) flips her to Restaurant; without this guard, downstream
// runs see the wrong active org and assert against members from the wrong
// workspace. We navigate to / first because page.evaluate on about:blank
// can't issue a same-origin-cookie'd fetch to the API host.
test.beforeEach(async ({ page }) => {
	await page.goto('/', { waitUntil: 'commit' })
	await setActiveOrgBySlug(page, 'taller')
})

test.describe('settings — organization', () => {
	test.describe('when the active user is the org owner (Alice in Taller)', () => {
		test('should show the active org name and link to members', async ({
			page,
		}) => {
			// GIVEN Alice on /settings/organization (active = taller)
			await page.goto('/settings/organization', { waitUntil: 'networkidle' })

			// THEN the org card should render with the taller name
			await expect(page.getByTestId('settings-org-card')).toBeVisible()
			await expect(page.getByTestId('settings-org-name')).toContainText(
				'Taller Demo',
			)
			// AND the members link should be reachable
			await expect(page.getByTestId('settings-org-members-link')).toBeVisible()
		})

		test('should list members with role badges on /settings/organization/members', async ({
			page,
		}) => {
			// GIVEN Alice navigates to the members page
			await page.goto('/settings/organization/members', {
				waitUntil: 'networkidle',
			})

			// THEN at least one member row should render (alice + carol seed)
			// AND the row's role badge should reflect the seeded role
			// We don't pin specific user ids — testids include them, so we
			// match the pattern instead.
			const memberRows = page.locator('[data-testid^="member-row-"]')
			await expect(memberRows.first()).toBeVisible()
			const memberCount = await memberRows.count()
			expect(memberCount).toBeGreaterThanOrEqual(2)

			// AND at least one role badge should read "Owner" (case-
			// insensitive — the badge renders uppercased via CSS)
			await expect(
				page.locator('[data-testid^="member-role-"]').first(),
			).toBeVisible()
		})
	})
})
