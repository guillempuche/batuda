import { expect, test } from '@playwright/test'

import { setActiveOrgBySlug } from './helpers/set-active-org'

// What the trade and country menus offer once a stage has been picked: only a
// narrowing that finds something, plus whatever is already chosen so it can be
// undone. The bin's own rule — that a value only a deleted company carries is
// never offered — is pinned against the database on the server side instead,
// since the seed has no deleted companies to read it from here.
//
// Ceràmica sits on one seeded company, which is not a client; Climatització
// sits on several, three of them clients.

const CERAMICA = 'companies-filter-industry-option-ceramica'
const CLIMA = 'companies-filter-industry-option-climatitzacio'

// Reset Alice to Taller before every scenario — sibling files flip her active
// org, and the trades offered here are whichever org is active.
test.beforeEach(async ({ page }) => {
	await page.goto('/', { waitUntil: 'commit' })
	await setActiveOrgBySlug(page, 'taller')
})

test.describe('company filter options', () => {
	test.describe('when a stage is chosen', () => {
		test('should stop offering a trade that stage has none of', async ({
			page,
		}) => {
			// GIVEN the companies list, whose trade menu offers both trades while
			// every stage is in view
			await page.goto('/companies', { waitUntil: 'networkidle' })
			const trades = page.getByTestId('companies-filter-industry')
			await trades.click()
			await expect(page.getByTestId(CERAMICA)).toBeVisible({ timeout: 10_000 })
			await expect(page.getByTestId(CLIMA)).toBeVisible()
			await page.keyboard.press('Escape')

			// WHEN the list is narrowed to clients
			await page.getByTestId('companies-status-client').click()
			await expect(page).toHaveURL(/status=client/)

			// THEN the trade some client is on is still offered, and the one no
			// client is on has gone — picking it could only have emptied the list
			await trades.click()
			await expect(page.getByTestId(CLIMA)).toBeVisible({ timeout: 10_000 })
			await expect(page.getByTestId(CERAMICA)).toHaveCount(0)
		})
	})

	test.describe('when a value is picked from a menu', () => {
		test('should apply it, not clear it while the next counts load', async ({
			page,
		}) => {
			// GIVEN the companies list with nothing filtered
			await page.goto('/companies', { waitUntil: 'networkidle' })
			const trades = page.getByTestId('companies-filter-industry')
			await trades.click()

			// WHEN a trade is picked — which is also what starts the next count, so
			// the menu is briefly asked to show values it does not have yet
			const option = page.getByTestId(CLIMA)
			await expect(option).toBeVisible({ timeout: 10_000 })
			await option.click()

			// THEN the choice sticks. A menu that emptied itself while the counts
			// were in flight would set the dropdown to a value its own list had
			// stopped holding, and it would clear the filter the instant it was set.
			await expect(page).toHaveURL(/industry=climatitzacio/, {
				timeout: 10_000,
			})
			await expect(trades).toHaveText(/climatitzaci/i)
		})
	})

	test.describe('when the chosen trade is one nobody is on at all', () => {
		test('should still name it in the menu, so it can be taken off', async ({
			page,
		}) => {
			// GIVEN a link carrying a trade the organisation has never used — the
			// same state a trade reaches once its last company is deleted
			await page.goto('/companies?industry=nobody-sells-this', {
				waitUntil: 'networkidle',
			})

			// WHEN the trade menu is opened
			await page.getByTestId('companies-filter-industry').click()

			// THEN it is named there rather than missing, spelled back out of the
			// address since no company carries the words anybody wrote
			const orphan = page.getByTestId(
				'companies-filter-industry-option-nobody-sells-this',
			)
			await expect(orphan).toBeVisible({ timeout: 10_000 })
			await expect(orphan).toHaveText(/nobody sells this/i)
		})
	})

	test.describe('when the trade already chosen has none in the new stage', () => {
		test('should keep offering it, so it can be undone', async ({ page }) => {
			// GIVEN the list is filtered to a trade with a single company on it
			await page.goto('/companies?industry=ceramica', {
				waitUntil: 'networkidle',
			})
			await expect(
				page.getByText('1 company with filters applied'),
			).toBeVisible({ timeout: 10_000 })

			// WHEN the list is also narrowed to clients, which that trade has none of
			await page.getByTestId('companies-status-client').click()
			await expect(page).toHaveURL(/status=client/)

			// THEN the trade is still in the menu even though nothing is behind it —
			// dropping it would leave the button naming a filter the menu denies,
			// with no way back except clearing every filter
			await page.getByTestId('companies-filter-industry').click()
			await expect(page.getByTestId(CERAMICA)).toBeVisible({ timeout: 10_000 })
		})
	})
})
