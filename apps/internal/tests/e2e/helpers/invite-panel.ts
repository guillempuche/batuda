import { expect, type Page } from '@playwright/test'

// Helpers for the inline invite panel on /settings/organization/members.
// The invite form is folded into the members page behind an "Invite member"
// CTA, and the role control is the Base UI PriSelect (a button trigger + a
// portalled popup), not a native <select> — so `selectOption` no longer works.

// Opens the invite panel from the CTA and waits for the form to be visible.
export async function openInvitePanel(page: Page): Promise<void> {
	await page.goto('/settings/organization/members', {
		waitUntil: 'networkidle',
	})
	await page.getByTestId('invite-open').click()
	await expect(page.getByTestId('invite-form')).toBeVisible()
}

// Picks a role on the PriSelect: open the trigger, click the option. Default
// is 'member', so callers only need this when inviting an admin.
export async function selectInviteRole(
	page: Page,
	role: 'member' | 'admin',
): Promise<void> {
	await page.getByTestId('invite-role-trigger').click()
	await page.getByTestId(`invite-role-option-${role}`).click()
}
