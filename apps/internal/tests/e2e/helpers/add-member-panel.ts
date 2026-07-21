import { expect, type Page } from '@playwright/test'

// Helpers for the inline add-member panel on /settings/organization/members.
// The form is folded into the members page behind an "Add member" CTA, and the
// role and language controls are Base UI PriSelects (a button trigger + a
// portalled popup), not native <select>s — so `selectOption` does not work.

// Opens the panel from the CTA and waits for the form to be visible.
export async function openAddMemberPanel(page: Page): Promise<void> {
	await page.goto('/settings/organization/members', {
		waitUntil: 'networkidle',
	})
	await page.getByTestId('add-member-open').click()
	await expect(page.getByTestId('add-member-form')).toBeVisible()
}

// Opens one of the panel's selects and picks an option. The popup is
// portalled and animates in, so the option resolves before it can be clicked —
// wait for it to be visible first, then choose it with the keyboard. Enter on
// a focused option is what a keyboard user does anyway, so this also covers
// the path a mouse click would skip.
async function chooseOption(
	page: Page,
	triggerTestId: string,
	optionTestId: string,
): Promise<void> {
	await page.getByTestId(triggerTestId).click()
	const option = page.getByTestId(optionTestId)
	await option.waitFor({ state: 'visible' })
	await option.hover()
	await page.keyboard.press('Enter')
	await option.waitFor({ state: 'hidden' })
}

// Picks a role. Default is 'member', so callers only need this for an admin.
export async function selectMemberRole(
	page: Page,
	role: 'member' | 'admin',
): Promise<void> {
	await chooseOption(
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
	await chooseOption(
		page,
		'add-member-locale-trigger',
		`add-member-locale-option-${locale}`,
	)
}
