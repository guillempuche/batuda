import { expect, type Page } from '@playwright/test'

import { waitForInteractive } from './hydration'

/**
 * Open the compose window from whichever control opens it — the button on the
 * mail list, Reply on a thread, or the action on a company.
 *
 * The wait has to come before the click. The control is drawn by the server and
 * is clickable long before the code behind it arrives, so a click sent too early
 * lands on nothing and the window never opens; waiting afterwards cannot rescue
 * a click that is already gone.
 */
export async function openCompose(page: Page, trigger: string): Promise<void> {
	await waitForInteractive(page, trigger)
	await page.getByTestId(trigger).click()

	// Generous, because on a development build the window's own code is built the
	// first time something asks for it.
	await expect(page.getByTestId('compose-form')).toBeVisible({
		timeout: 15_000,
	})
}
