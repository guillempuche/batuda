import { execSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import { setActiveOrgBySlug } from './helpers/set-active-org'

// Mailbox-listing path. The seed leaves Alice with two mailboxes on Taller
// — admin@taller.cat (human, default) and agent@taller.cat (agent) —
// so the mailbox-filter dropdown is meaningfully exercised. Threads on
// the agent mailbox (M4) must filter out when the human mailbox is
// selected, and vice versa.
//
// Selectors verified against:
//   apps/internal/src/routes/emails/index.tsx
//     (thread-row-{id}, mailbox-filter-trigger, mailbox-filter-option,
//      data-mailbox-email)

const DATABASE_URL =
	process.env['E2E_DATABASE_URL'] ??
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

const psql = (sqlText: string): string =>
	execSync(`psql "${DATABASE_URL}" -tA -c "${sqlText.replace(/"/g, '\\"')}"`, {
		encoding: 'utf8',
	}).trim()

test.describe('emails mailbox listing', () => {
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
			// share, M3 single, M4 single on agent mailbox, M8 single).
			// Resolve the count from the DB so the assertion stays in
			// sync if the seed shape changes.
			const expected = Number(
				psql(
					`SELECT count(*) FROM conversations l
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

	test.describe('when the user filters by the agent mailbox', () => {
		test('should hide threads that live on the human mailbox', async ({
			page,
		}) => {
			await page.goto('/emails', { waitUntil: 'networkidle' })

			// WHEN Alice opens the mailbox-filter dropdown and picks the agent
			await page.getByTestId('mailbox-filter-trigger').click()
			await page
				.locator(
					'[data-testid="mailbox-filter-option"][data-mailbox-email="agent@taller.cat"]',
				)
				.click()

			// THEN only threads on agent@taller.cat remain. The seed puts
			// M4 ("Visit photos attached") on the agent mailbox; the human
			// threads (M1/M2/M3/M8) must drop off the list.
			const expectedAgent = Number(
				psql(
					`SELECT count(*) FROM conversations l
					 JOIN channel_connections i ON i.id = l.connection_id
					 WHERE i.external_id = 'agent@taller.cat'`,
				),
			)
			expect(expectedAgent, 'agent mailbox must have threads').toBeGreaterThan(
				0,
			)
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
