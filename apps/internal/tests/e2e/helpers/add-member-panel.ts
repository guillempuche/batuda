import { expect, type Page } from '@playwright/test'

import { chooseSelectOption } from './pri-select'

// Helpers for the inline add-member panel on /settings/organization/members.
// The form is folded into the members page behind an "Add member" CTA, and the
// role and language controls are Base UI PriSelects.

// Opens the panel from the CTA and waits for the form to be visible.
export async function openAddMemberPanel(page: Page): Promise<void> {
	await page.goto('/settings/organization/members', {
		waitUntil: 'networkidle',
	})
	await page.getByTestId('add-member-open').click()
	await expect(page.getByTestId('add-member-form')).toBeVisible()
}

// Picks a role. Default is 'member', so callers only need this for an admin.
export async function selectMemberRole(
	page: Page,
	role: 'member' | 'admin',
): Promise<void> {
	await chooseSelectOption(
		page,
		'add-member-role-trigger',
		`add-member-role-option-${role}`,
	)
}

// Picks the language their welcome email and first visit use. Default is 'en'.
export async function selectMemberLocale(
	page: Page,
	locale: 'en' | 'ca',
): Promise<void> {
	await chooseSelectOption(
		page,
		'add-member-locale-trigger',
		`add-member-locale-option-${locale}`,
	)
}
