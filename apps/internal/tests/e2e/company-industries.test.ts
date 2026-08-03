import { expect, test } from '@playwright/test'

import { setActiveOrgBySlug } from './helpers/set-active-org'

// The organisation's own list of trades, from both ends: writing one on a
// company page and then curating it under Settings.
//
// Each scenario invents its own trade name so parallel workers and repeated
// runs never fight over the same row, and puts the company back on the trade it
// started with so the seeded list is unchanged afterwards.

// Reset Alice to Taller before every scenario — sibling files flip her active
// org, and every endpoint here resolves the trades of whichever org is active.
test.beforeEach(async ({ page }) => {
	await page.goto('/', { waitUntil: 'commit' })
	await setActiveOrgBySlug(page, 'taller')
})

test.describe('company industries', () => {
	test.describe('when somebody types a trade nobody has used yet', () => {
		test('should keep the words they typed and offer them next time', async ({
			page,
		}) => {
			const trade = `Rellotgeria ${Date.now()}`

			// GIVEN a company whose About panel is open
			await page.goto('/companies/cal-pep-fonda', { waitUntil: 'networkidle' })
			await page.getByTestId('company-about-trigger').click()
			const field = page.getByTestId('company-industry')
			await expect(field).toBeVisible()
			const before = (await field.innerText()).trim()

			// WHEN she writes a trade the organisation has never used
			await field.click()
			await field.fill(trade)
			await field.press('Enter')

			// THEN the company reads back with the words she typed, not a tidied
			// or reduced version of them
			await expect(page.getByTestId('company-industry')).toHaveText(trade, {
				timeout: 10_000,
			})

			// AND the trade is now one the organisation offers: on another
			// company, typing its opening letters suggests it
			await page.goto('/companies/ferros-baix-llobregat', {
				waitUntil: 'networkidle',
			})
			await page.getByTestId('company-about-trigger').click()
			const other = page.getByTestId('company-industry')
			await other.click()
			await other.fill(trade.slice(0, 8))
			await expect(page.getByRole('option', { name: trade })).toBeVisible({
				timeout: 10_000,
			})
			await other.press('Escape')

			// Put the first company back where it started.
			await page.goto('/companies/cal-pep-fonda', { waitUntil: 'networkidle' })
			await page.getByTestId('company-about-trigger').click()
			await page.getByTestId('company-industry').click()
			await page.getByTestId('company-industry').fill(before)
			await page.getByTestId('company-industry').press('Enter')
			await expect(page.getByTestId('company-industry')).toHaveText(before, {
				timeout: 10_000,
			})
		})
	})

	test.describe('when a trade nothing uses is left behind', () => {
		test('should offer to remove it, and remove it', async ({ page }) => {
			const trade = `Vidrieria ${Date.now()}`

			// GIVEN a trade written onto a company and then taken off again, so
			// the organisation has one nothing is on
			await page.goto('/companies/cal-pep-fonda', { waitUntil: 'networkidle' })
			await page.getByTestId('company-about-trigger').click()
			const field = page.getByTestId('company-industry')
			await expect(field).toBeVisible()
			const before = (await field.innerText()).trim()
			await field.click()
			await field.fill(trade)
			await field.press('Enter')
			await expect(page.getByTestId('company-industry')).toHaveText(trade, {
				timeout: 10_000,
			})
			await page.getByTestId('company-industry').click()
			await page.getByTestId('company-industry').fill(before)
			await page.getByTestId('company-industry').press('Enter')
			await expect(page.getByTestId('company-industry')).toHaveText(before, {
				timeout: 10_000,
			})

			// WHEN she opens the trades list in Settings
			await page.goto('/settings/organization/industries', {
				waitUntil: 'networkidle',
			})
			const row = page
				.getByTestId('industries-list')
				.locator('div')
				.filter({ hasText: trade })
				.last()

			// THEN that trade says nothing is on it, and offers a Remove — which
			// only appears once a trade is unused
			await expect(row).toContainText('0 companies')
			const remove = page.getByRole('button', { name: `Remove ${trade}` })
			await remove.scrollIntoViewIfNeeded()
			await remove.click()

			// AND it is gone from the list
			await expect(
				page.getByRole('button', { name: `Rename ${trade}` }),
			).toHaveCount(0, { timeout: 10_000 })
		})
	})

	test.describe('when two spellings of one trade end up on the list', () => {
		test('should fold one into the other and move its companies over', async ({
			page,
		}) => {
			const kept = `Escultura ${Date.now()}`
			const folded = `${kept} i talla`

			// GIVEN two companies given two different trades
			await page.goto('/companies/cal-pep-fonda', { waitUntil: 'networkidle' })
			await page.getByTestId('company-about-trigger').click()
			const first = page.getByTestId('company-industry')
			await expect(first).toBeVisible()
			const firstBefore = (await first.innerText()).trim()
			await first.click()
			await first.fill(kept)
			await first.press('Enter')
			await expect(page.getByTestId('company-industry')).toHaveText(kept, {
				timeout: 10_000,
			})

			await page.goto('/companies/ferros-baix-llobregat', {
				waitUntil: 'networkidle',
			})
			await page.getByTestId('company-about-trigger').click()
			const second = page.getByTestId('company-industry')
			await expect(second).toBeVisible()
			const secondBefore = (await second.innerText()).trim()
			await second.click()
			await second.fill(folded)
			await second.press('Enter')
			await expect(page.getByTestId('company-industry')).toHaveText(folded, {
				timeout: 10_000,
			})

			// WHEN she folds the second trade into the first
			await page.goto('/settings/organization/industries', {
				waitUntil: 'networkidle',
			})
			const merge = page.getByRole('button', {
				name: `Merge ${folded} into another`,
			})
			await merge.scrollIntoViewIfNeeded()
			await merge.click()
			await expect(page.getByTestId('industry-merge-dialog')).toBeVisible()
			await page.getByTestId('industry-merge-target').fill(kept)
			await page.getByRole('option', { name: kept, exact: true }).click()
			await page.getByTestId('industry-merge-confirm').click()

			// THEN the folded trade is gone
			await expect(
				page.getByRole('button', { name: `Rename ${folded}` }),
			).toHaveCount(0, { timeout: 10_000 })

			// AND the company that was on it now reads as the trade that stayed
			await page.goto('/companies/ferros-baix-llobregat', {
				waitUntil: 'networkidle',
			})
			await page.getByTestId('company-about-trigger').click()
			await expect(page.getByTestId('company-industry')).toHaveText(kept, {
				timeout: 10_000,
			})

			// Put both companies back where they started.
			await page.getByTestId('company-industry').click()
			await page.getByTestId('company-industry').fill(secondBefore)
			await page.getByTestId('company-industry').press('Enter')
			await expect(page.getByTestId('company-industry')).toHaveText(
				secondBefore,
				{ timeout: 10_000 },
			)
			await page.goto('/companies/cal-pep-fonda', { waitUntil: 'networkidle' })
			await page.getByTestId('company-about-trigger').click()
			await page.getByTestId('company-industry').click()
			await page.getByTestId('company-industry').fill(firstBefore)
			await page.getByTestId('company-industry').press('Enter')
			await expect(page.getByTestId('company-industry')).toHaveText(
				firstBefore,
				{ timeout: 10_000 },
			)
		})
	})

	test.describe('when filtering the companies list by a trade', () => {
		test('should offer the organisation trades, not only the ones on screen', async ({
			page,
		}) => {
			// GIVEN the companies list
			await page.goto('/companies', { waitUntil: 'networkidle' })

			// WHEN she opens the Industry filter
			await page.getByTestId('companies-filter-industry').click()

			// THEN it offers a trade only one seeded company is in — one the old
			// filter, built from whichever companies happened to be loaded, could
			// not have listed reliably
			const option = page.getByRole('option', {
				name: 'Serralleria',
				exact: true,
			})
			await expect(option).toBeVisible({ timeout: 10_000 })

			// WHEN she picks it
			await option.click()

			// THEN the list narrows to that trade, and the count reads in the
			// singular rather than "1 companies"
			await expect(page).toHaveURL(/industry=serralleria/)
			await expect(
				page.getByText('1 company with filters applied'),
			).toBeVisible({ timeout: 10_000 })
		})
	})
})
