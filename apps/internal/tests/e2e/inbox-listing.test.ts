import { execSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import { DATABASE_URL } from './helpers/database-url'
import { setActiveOrgBySlug } from './helpers/set-active-org'

// Inbox-listing path. The seed leaves Alice with two inboxes on Taller
// — admin@taller.cat (human, default) and agent@taller.cat (agent) —
// so the inbox-filter dropdown is meaningfully exercised. Threads on
// the agent inbox (M4) must filter out when the human inbox is
// selected, and vice versa.
//
// Selectors verified against:
//   apps/internal/src/routes/emails/index.tsx
//     (thread-row-{id}, emails-thread-total, inbox-filter-trigger,
//      inbox-filter-option, data-inbox-email)

// Hand-copy of EMAILS_PAGE_SIZE in src/atoms/emails-atoms.ts: importing it
// pulls in Vite's `import.meta.env`, which Node does not have.
const PAGE_SIZE = 100

const psql = (sqlText: string): string =>
	execSync(`psql "${DATABASE_URL}" -tA -c "${sqlText.replace(/"/g, '\\"')}"`, {
		encoding: 'utf8',
	}).trim()

test.describe('emails inbox listing', () => {
	test.beforeEach(async ({ page }) => {
		// GIVEN Alice's session is active and pointed at Taller.
		await page.goto('/', { waitUntil: 'commit' })
		await setActiveOrgBySlug(page, 'taller')
	})

	test.describe('when the user opens /emails', () => {
		test('should account for every thread and render the seeded ones', {
			tag: '@smoke',
		}, async ({ page }) => {
			// GIVEN however many threads Taller has. Read from the database
			// rather than written down, because the seed's own count changes and
			// every spec that sends an email adds one more for good.
			const expected = Number(
				psql(
					`SELECT count(*) FROM email_thread_links l
					 JOIN organization o ON o.id = l.organization_id
					 WHERE o.slug = 'taller'`,
				),
			)
			expect(expected, 'seeded threads must exist').toBeGreaterThan(0)

			// WHEN the user lands on /emails
			await page.goto('/emails', { waitUntil: 'networkidle' })

			// THEN the page accounts for all of them. Counting rows instead would
			// count one page of mail rather than all of it: the list draws a
			// page at a time, so its row count stops at the page size however
			// much mail there is.
			await expect(page.getByTestId('emails-thread-total')).toHaveText(
				expected === 1 ? '1 thread' : `${expected} threads`,
			)

			// AND rows are actually drawn
			await expect(
				page.locator('[data-testid^="thread-row-"]').first(),
			).toBeVisible()

			// AND a known thread can be reached. Searched for rather than looked
			// for on screen: an older thread can sit on a later page, and is
			// then not there to find — the same trap as counting rows, one step
			// further along.
			await page
				.getByTestId('emails-search')
				.fill('Quote for the booking module')
			await expect(page.getByText('Quote for the booking module')).toBeVisible()
		})
	})

	test.describe('when a page holds more threads than fit on screen', () => {
		test('should draw a row for every thread on the page', async ({ page }) => {
			// GIVEN however many threads Taller has, capped at the one page the
			// list draws at a time.
			const totalThreads = Number(
				psql(
					`SELECT count(*) FROM email_thread_links l
					 JOIN organization o ON o.id = l.organization_id
					 WHERE o.slug = 'taller'`,
				),
			)
			const expectedRows = Math.min(totalThreads, PAGE_SIZE)

			// WHEN the user lands on /emails
			await page.goto('/emails', { waitUntil: 'networkidle' })

			// THEN every one of them has a row, including the ones below the
			// fold. A list that draws only what fits the window leaves the rest
			// of the page unreachable on a short screen.
			await expect(page.locator('[data-testid^="thread-row-"]')).toHaveCount(
				expectedRows,
			)
		})
	})

	test.describe('when the user filters by the agent inbox', () => {
		test('should hide threads that live on the human inbox', async ({
			page,
		}) => {
			await page.goto('/emails', { waitUntil: 'networkidle' })

			// WHEN Alice opens the inbox-filter dropdown and picks the agent
			await page.getByTestId('inbox-filter-trigger').click()
			await page
				.locator(
					'[data-testid="inbox-filter-option"][data-inbox-email="agent@taller.cat"]',
				)
				.click()

			// THEN only threads on agent@taller.cat remain. The seed puts
			// M4 ("Visit photos attached") on the agent inbox; the human
			// threads (M1/M2/M3/M8) must drop off the list.
			// Narrowed to Taller: the address alone would also match an inbox of
			// the same name belonging to another organisation.
			const expectedAgent = Number(
				psql(
					`SELECT count(*) FROM email_thread_links l
					 JOIN inboxes i ON i.id = l.inbox_id
					 JOIN organization o ON o.id = l.organization_id
					 WHERE i.email = 'agent@taller.cat' AND o.slug = 'taller'`,
				),
			)
			expect(expectedAgent, 'agent inbox must have threads').toBeGreaterThan(0)
			// The page's own tally, for the same reason as the test above: a row
			// count would stop at the page size. It holds today only because the
			// agent inbox has a single thread.
			await expect(page.getByTestId('emails-thread-total')).toHaveText(
				expectedAgent === 1 ? '1 thread' : `${expectedAgent} threads`,
			)
		})
	})

	test.describe('when the user opens a thread row', () => {
		test('should navigate to /emails/<uuid>', async ({ page }) => {
			await page.goto('/emails', { waitUntil: 'networkidle' })

			// Open the first row via its keyboard affordance (the row is
			// tabindex=0 with an "Open thread" aria-label and an Enter/Space
			// handler). A positional click on row 0 is flaky: Playwright scrolls
			// it to the top of the grid, where the sticky table header then
			// intercepts the click. Pressing Enter on the focused row activates
			// the same navigation without hit-testing under that header.
			const firstRow = page.locator('[data-testid^="thread-row-"]').first()
			await expect(firstRow).toBeVisible()
			await firstRow.press('Enter')

			await page.waitForURL(/\/emails\/[0-9a-f-]{36}$/, { timeout: 5_000 })
		})
	})
})
