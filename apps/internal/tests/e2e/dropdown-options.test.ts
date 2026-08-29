import { expect, test } from '@playwright/test'

import { openAboutSection } from './helpers/about-section'
import { setActiveOrgBySlug } from './helpers/set-active-org'

// How wide a dropdown opens, and where the names inside it start.
//
// A tick is drawn on the chosen option and on no other, so the room for one is
// kept on every row: the names all start in the same place, and the list grows
// to its longest option rather than stopping at the button that opened it.

// Reset Alice to Taller before every scenario — sibling files flip her active
// org, and the trades offered here are whichever org is active.
test.beforeEach(async ({ page }) => {
	await page.goto('/', { waitUntil: 'commit' })
	await setActiveOrgBySlug(page, 'taller')
})

test.describe('dropdown options', () => {
	test.describe('when only the chosen option carries a tick', () => {
		test('should start every name in the same place', async ({ page }) => {
			// GIVEN the companies list, whose trade filter starts on "All trades"
			await page.goto('/companies', { waitUntil: 'networkidle' })
			const trigger = page.getByTestId('companies-filter-industry')
			await expect(trigger).toBeVisible()

			// WHEN it is opened, so the first option is ticked and the rest are not
			await trigger.click()
			// A shut list still holds its options, every one of them at no size at
			// all — which would read as all the names lining up.
			await expect(trigger).toHaveAttribute('aria-expanded', 'true')
			const options = page.locator(
				'[data-testid^="companies-filter-industry-option-"]',
			)
			await expect(options.first()).toBeVisible()

			// THEN every name begins the same distance from the left, tick or no tick
			const nameStarts = await options.evaluateAll(rows =>
				rows.map(row => {
					const name = row.lastElementChild
					// -1 stands for a row with no name, caught by the check below.
					return name === null
						? -1
						: Math.round(name.getBoundingClientRect().left)
				}),
			)
			expect(nameStarts.length).toBeGreaterThan(1)
			expect(Math.min(...nameStarts)).toBeGreaterThan(0)
			expect(new Set(nameStarts).size).toBe(1)
		})
	})

	test.describe('when an option is longer than the button that opens it', () => {
		test('should open wide enough to read the whole name', async ({ page }) => {
			// A name far longer than the filter button, and its own so parallel
			// workers and repeated runs never fight over the same row.
			const trade = `Maquinaria agricola i manteniment de vehicles industrials ${Date.now()}`

			// GIVEN that trade is one the organisation offers — written onto a
			// company, then taken off again so the seeded data is as it was
			await page.goto('/companies/cal-pep-fonda', { waitUntil: 'networkidle' })
			await openAboutSection(page)
			const field = page.getByTestId('company-industry')
			await expect(field).toBeVisible()
			const before = (await field.innerText()).trim()
			await field.click()
			await field.fill(trade)
			await field.press('Enter')
			await expect(field).toHaveText(trade, { timeout: 10_000 })

			await field.click()
			await field.fill(before)
			await field.press('Enter')
			await expect(field).toHaveText(before, { timeout: 10_000 })

			// WHEN the trade filter on the companies list is opened
			await page.goto('/companies', { waitUntil: 'networkidle' })
			const trigger = page.getByTestId('companies-filter-industry')
			await expect(trigger).toBeVisible()
			await trigger.click()
			const option = page.getByRole('option', { name: trade })
			await expect(option).toBeVisible({ timeout: 10_000 })

			// THEN the whole name is on screen, and the list has grown past the
			// button rather than cutting the name off at it
			const measured = await option.evaluate(row => {
				const popup = row.parentElement
				return {
					nameFullyShown: row.scrollWidth <= row.clientWidth,
					popupWidth: popup === null ? 0 : popup.getBoundingClientRect().width,
				}
			})
			const triggerWidth = await trigger.evaluate(
				button => button.getBoundingClientRect().width,
			)
			expect(measured.nameFullyShown).toBe(true)
			expect(measured.popupWidth).toBeGreaterThan(triggerWidth)

			// Leave the organisation's trades as they were found.
			await page.keyboard.press('Escape')
			await page.goto('/settings/organization/industries', {
				waitUntil: 'networkidle',
			})
			const remove = page.getByRole('button', { name: `Remove ${trade}` })
			await remove.scrollIntoViewIfNeeded()
			await remove.click()
			await expect(
				page.getByRole('button', { name: `Rename ${trade}` }),
			).toHaveCount(0, { timeout: 10_000 })
		})
	})
})
