import { execSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import { setActiveOrgBySlug } from './helpers/set-active-org'

// Inbox-listing path. The seed leaves Alice with two inboxes on Taller
// — admin@taller.cat (human, default) and agent@taller.cat (agent) —
// so the inbox-filter dropdown is meaningfully exercised. Threads on
// the agent inbox (M4) must filter out when the human inbox is
// selected, and vice versa.
//
// Selectors verified against:
//   apps/internal/src/routes/emails/index.tsx
//     (thread-row-{id}, inbox-filter-trigger, inbox-filter-option,
//      data-inbox-email)

const DATABASE_URL =
	process.env['E2E_DATABASE_URL'] ??
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

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
		test('should render at least one row per seeded thread', async ({
			page,
		}) => {
			// GIVEN the seed produces 4 inbound threads on Taller (M1+M2
			// share, M3 single, M4 single on agent inbox, M8 single).
			// Resolve the count from the DB so the assertion stays in
			// sync if the seed shape changes.
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

			// THEN every seeded thread renders as a row
			const rows = page.locator('[data-testid^="thread-row-"]')
			await expect(rows).toHaveCount(expected)
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
			const expectedAgent = Number(
				psql(
					`SELECT count(*) FROM email_thread_links l
					 JOIN inboxes i ON i.id = l.inbox_id
					 WHERE i.email = 'agent@taller.cat'`,
				),
			)
			expect(expectedAgent, 'agent inbox must have threads').toBeGreaterThan(0)
			const rows = page.locator('[data-testid^="thread-row-"]')
			await expect(rows).toHaveCount(expectedAgent)
		})
	})

	test.describe('when the user clicks a thread row', () => {
		test('should navigate to /emails/<uuid>', async ({ page }) => {
			await page.goto('/emails', { waitUntil: 'networkidle' })

			// Click the first row and assert the URL transitions
			const firstRow = page.locator('[data-testid^="thread-row-"]').first()
			await expect(firstRow).toBeVisible()
			await firstRow.click()

			await page.waitForURL(/\/emails\/[0-9a-f-]{36}$/, { timeout: 5_000 })
		})
	})
})
