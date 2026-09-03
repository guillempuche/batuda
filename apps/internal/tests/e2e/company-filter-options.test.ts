import { expect, test } from '@playwright/test'

import { failApi } from './helpers/block-api'
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
const SPAIN = 'companies-filter-country-option-ES'

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
			// The header's own line, not the spoken one beside it: the count is
			// deliberately in the page twice, visible and announced.
			await expect(
				page.locator('p', { hasText: '1 company with filters applied' }),
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

	test.describe('when the counts cannot be fetched', () => {
		test('should keep naming the filter in force, so it can still be lifted', async ({
			page,
		}) => {
			// GIVEN the list filtered to one country, with its menu populated
			await page.goto('/companies?country=ES', { waitUntil: 'networkidle' })
			const countries = page.getByTestId('companies-filter-country')
			await countries.click()
			await expect(page.getByTestId(SPAIN)).toBeVisible({ timeout: 10_000 })
			await page.keyboard.press('Escape')

			// WHEN every further count fails, and a filter change asks for one
			await failApi(page, 'company-facets')
			await page.getByTestId('companies-status-client').click()
			await expect(page).toHaveURL(/status=client/)

			// THEN the country is still filtering and still named in its own menu.
			// A menu emptied by a failure would set the selector to a value its list
			// no longer held, and the filter would clear itself with nothing said.
			await expect(page).toHaveURL(/country=ES/)
			await expect(countries).toHaveText(/spain/i)
			await countries.click()
			await expect(page.getByTestId(SPAIN)).toBeVisible({ timeout: 10_000 })
		})
	})

	test.describe('when a second stage is picked', () => {
		test('should widen to either, and say so in the address', async ({
			page,
		}) => {
			// GIVEN the list narrowed to one stage
			await page.goto('/companies', { waitUntil: 'networkidle' })
			await page.getByTestId('companies-status-contacted').click()
			await expect(page).toHaveURL(/status=contacted/)
			const oneStage = await countShown(page)

			// WHEN a second stage is picked rather than swapping the first
			await page.getByTestId('companies-status-responded').click()

			// THEN both are in force and the list has grown. A company has one
			// stage, so naming a second can only widen — which is the question
			// ("everything mid-conversation") the board view existed to answer
			await expect(page).toHaveURL(
				/status=contacted%2Cresponded|status=contacted,responded/,
			)
			await expect(
				page.getByTestId('companies-status-contacted'),
			).toHaveAttribute('aria-pressed', 'true')
			await expect(
				page.getByTestId('companies-status-responded'),
			).toHaveAttribute('aria-pressed', 'true')
			expect(await countShown(page)).toBeGreaterThan(oneStage)
		})
	})

	test.describe('when the list is opened from a dashboard heading', () => {
		test('should name what needs doing, not only carry it in the address', async ({
			page,
		}) => {
			// GIVEN a link of the kind the dashboard's headings produce
			await page.goto('/companies?attention=overdue', {
				waitUntil: 'networkidle',
			})

			// THEN the control says which one is filtering. Unnamed, it would narrow
			// the list with nothing on screen saying so, leaving the address bar as
			// the only way to find out what "companies with filters applied" meant
			await expect(page.getByTestId('companies-filter-attention')).toHaveText(
				/overdue/i,
			)
		})

		test('should put it down when the bin is opened, rather than show nothing', async ({
			page,
		}) => {
			// GIVEN the list narrowed to what is overdue
			await page.goto('/companies?attention=overdue', {
				waitUntil: 'networkidle',
			})

			// WHEN the deleted companies are asked for
			await page.getByTestId('companies-filter-deleted').click()

			// THEN what needs doing is lifted. A deleted company is on none of those
			// lists by definition, so the two together match nothing at all — an
			// empty screen with no way to tell why
			await expect(page).toHaveURL(/deleted=only/)
			await expect(page).not.toHaveURL(/attention=/)
		})
	})

	test.describe('when a tag is picked', () => {
		test('should narrow by it and keep it visible on the control', async ({
			page,
		}) => {
			// GIVEN the companies list, whose tag menu is counted from the same
			// companies the list holds
			await page.goto('/companies', { waitUntil: 'networkidle' })
			const tags = page.getByTestId('companies-filter-tags')
			await tags.click()

			// WHEN the first tag on offer is ticked
			const option = page
				.locator('[data-testid^="companies-filter-tags-option-"]')
				.first()
			await expect(option).toBeVisible({ timeout: 10_000 })
			const picked = ((await option.getAttribute('data-testid')) ?? '').replace(
				'companies-filter-tags-option-',
				'',
			)
			await option.click()

			// THEN the list is narrowed by it, and the control names it, so the reader
			// sees what is in force without opening it again
			await expect(page).toHaveURL(
				new RegExp(`tags=${encodeURIComponent(picked)}`, 'i'),
			)
			await expect(tags).toHaveText(new RegExp(picked, 'i'))
		})
	})

	test.describe('when a fit verdict is picked', () => {
		test('should narrow by what the research runs concluded', async ({
			page,
		}) => {
			// GIVEN the companies list
			await page.goto('/companies', { waitUntil: 'networkidle' })
			await page.getByTestId('companies-filter-fit').click()

			// WHEN a verdict on offer is ticked
			const option = page.getByTestId('companies-filter-fit-option-strong_fit')
			await expect(option).toBeVisible({ timeout: 10_000 })
			await option.click()

			// THEN it filters the list. The menu is built from what runs actually
			// wrote rather than a fixed list of four words, so a verdict nobody
			// listed is still offered instead of hiding the companies carrying it
			await expect(page).toHaveURL(/fitVerdict=strong_fit/)
		})
	})
})

test.describe('when the filters are used without looking at the screen', () => {
	test('should name each option, so the choices are told apart', async ({
		page,
	}) => {
		// GIVEN the tag menu open
		await page.goto('/companies', { waitUntil: 'networkidle' })
		await page.getByTestId('companies-filter-tags').click()
		const first = page
			.locator('[data-testid^="companies-filter-tags-option-"]')
			.first()
		await expect(first).toBeVisible({ timeout: 10_000 })
		const tag = ((await first.getAttribute('data-testid')) ?? '').replace(
			'companies-filter-tags-option-',
			'',
		)

		// THEN the option is a checkbox that carries the tag as its name. Named
		// by nothing, every row announces as "unchecked checkbox" and a listener
		// has no way to tell one from the next
		// The name carries the tag and what its number counts. Base UI's own
		// hidden input sits beside it carrying `aria-hidden`, so it is not a
		// second checkbox as far as anyone listening is concerned
		await expect(
			page.getByRole('checkbox', { name: new RegExp(`^${tag} `) }),
		).toHaveCount(1)

		// AND there is one control per row, not a nameless checkbox beside a
		// stateless button — which was two tab stops for one choice
		await expect(
			page.getByRole('button', { name: tag, exact: true }),
		).toHaveCount(0)
	})

	test('should say what is chosen, not only show a badge', async ({ page }) => {
		// GIVEN two tags chosen, which is where the control stops naming them and
		// starts counting them
		await page.goto('/companies', { waitUntil: 'networkidle' })
		const tags = page.getByTestId('companies-filter-tags')
		await tags.click()
		const options = page.locator(
			'[data-testid^="companies-filter-tags-option-"]',
		)
		await expect(options.first()).toBeVisible({ timeout: 10_000 })
		await options.first().click()
		await expect(options.nth(1)).toBeVisible()
		await options.nth(1).click()
		await page.keyboard.press('Escape')

		// THEN the trigger's own name carries the number in words. A bare digit
		// beside the label is silence to a listener, which is the one thing the
		// badge exists to say
		await expect(tags).toHaveAccessibleName(/2 selected/i)
	})

	test('should name a single choice rather than count it', async ({ page }) => {
		// GIVEN one tag chosen
		await page.goto('/companies', { waitUntil: 'networkidle' })
		const tags = page.getByTestId('companies-filter-tags')
		await tags.click()
		const first = page
			.locator('[data-testid^="companies-filter-tags-option-"]')
			.first()
		await expect(first).toBeVisible({ timeout: 10_000 })
		const picked = ((await first.getAttribute('data-testid')) ?? '').replace(
			'companies-filter-tags-option-',
			'',
		)
		await first.click()
		await page.keyboard.press('Escape')

		// THEN it is named, spoken as well as shown — "1" would tell a reader that
		// something is in force while withholding which
		await expect(tags).toHaveAccessibleName(new RegExp(picked, 'i'))
	})

	test('should say which stage filter is in force, including none', async ({
		page,
	}) => {
		// GIVEN nothing narrowed by stage
		await page.goto('/companies', { waitUntil: 'networkidle' })

		// THEN the chip that is lit says so. It is the only one that lights up
		// while carrying no state a listener can hear
		const all = page.getByTestId('companies-status-all')
		await expect(all).toHaveAttribute('aria-pressed', 'true')

		// WHEN a stage is picked
		await page.getByTestId('companies-status-client').click()
		await expect(page).toHaveURL(/status=client/)

		// THEN the two swap, and both say which they are
		await expect(all).toHaveAttribute('aria-pressed', 'false')
		await expect(page.getByTestId('companies-status-client')).toHaveAttribute(
			'aria-pressed',
			'true',
		)
	})

	test('should announce the count when a filter changes it', async ({
		page,
	}) => {
		// GIVEN the list unfiltered
		await page.goto('/companies', { waitUntil: 'networkidle' })

		// WHEN a stage is picked, which changes the list without the keyboard
		// moving anywhere
		await page.getByTestId('companies-status-client').click()
		await expect(page).toHaveURL(/status=client/)

		// THEN the change is spoken. Without it a listener gets silence, and the
		// two controls that quietly lift another filter are invisible entirely
		await expect(
			page.getByTestId('companies-count-announcement'),
		).toContainText(/compan(y|ies) with filters applied/, {
			timeout: 10_000,
		})
	})
})

// The total the header states, which is what a filter is judged by — the grid
// only holds the page loaded so far.
async function countShown(
	page: import('@playwright/test').Page,
): Promise<number> {
	const text = await page
		.locator('p', { hasText: /companies? with filters applied/ })
		.first()
		.textContent()
	return Number((text ?? '').match(/\d+/)?.[0] ?? '0')
}
