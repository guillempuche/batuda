import { expect, type Locator, type Page } from '@playwright/test'

// Reaching the About section on a company page. Specs ask for the state they
// need rather than for a click, so they read the same whether the section
// starts open or shut.
async function setAboutSection(
	page: Page,
	shouldBeOpen: boolean,
): Promise<Locator> {
	const trigger = page.getByTestId('company-about-trigger')
	await expect(trigger).toBeVisible()
	const panel = page.getByTestId('company-about-panel')

	// The header animates on first paint and drags the trigger across the page
	// for about a second, so a click can land on empty space. Wait only a moment
	// for the panel, then let the retry send another click.
	await expect(async () => {
		const isOpen = (await trigger.getAttribute('aria-expanded')) === 'true'
		if (isOpen !== shouldBeOpen) {
			await trigger.click()
		}
		await (shouldBeOpen
			? expect(panel).toBeVisible({ timeout: 1_000 })
			: expect(panel).toBeHidden({ timeout: 1_000 }))
	}).toPass({ timeout: 15_000 })

	return panel
}

// Leaves the About section open, and hands back its panel.
export function openAboutSection(page: Page): Promise<Locator> {
	return setAboutSection(page, true)
}

// Leaves the About section shut, and hands back its panel.
export function closeAboutSection(page: Page): Promise<Locator> {
	return setAboutSection(page, false)
}
