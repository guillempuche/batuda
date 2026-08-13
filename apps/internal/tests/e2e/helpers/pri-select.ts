import type { Page } from '@playwright/test'

// Driving Base UI PriSelects, which are a button trigger plus a popup that
// lives elsewhere on the page rather than a native <select>, so Playwright's
// `selectOption` cannot work them.

// The popup animates in, so the option is on the page a moment before it can be
// clicked — wait for it to show, then press Enter on it, which is what a
// keyboard user does anyway and covers the path a mouse click would skip.
export async function chooseSelectOption(
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
