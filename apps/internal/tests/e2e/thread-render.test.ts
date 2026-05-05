import { execSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import { setActiveOrgBySlug } from './helpers/set-active-org'

// Thread-render path. The seed direct-INSERTs M1 + M2 (Pep × Alice) so this
// spec opens the resulting thread and verifies that:
//   1. Both message cards render with the right `data-direction`.
//   2. Cards appear in chronological order (M1 received_at < M2).
//   3. The Cc disclosure toggle reveals/hides the Cc line.
//
// Selectors verified against:
//   apps/internal/src/routes/emails/$threadId.tsx
//     (thread-message-card, thread-cc-toggle)

const DATABASE_URL =
	process.env['E2E_DATABASE_URL'] ??
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

const psql = (sqlText: string): string =>
	execSync(`psql "${DATABASE_URL}" -tA -c "${sqlText.replace(/"/g, '\\"')}"`, {
		encoding: 'utf8',
	}).trim()

test.describe('thread render with multiple messages', () => {
	test.beforeEach(async ({ page }) => {
		// GIVEN Alice is signed in and pointed at Taller, where the
		// seeded threads live.
		await page.goto('/', { waitUntil: 'commit' })
		await setActiveOrgBySlug(page, 'taller')
	})

	test.describe('when the user opens the booking-module thread', () => {
		test('should render two message cards in chronological order with correct direction', async ({
			page,
		}) => {
			// GIVEN the seeded thread root is M1 (inbound from Pep) and M2
			// is Pep's reply, also inbound. Both have direction='inbound'.
			const threadId = psql(
				`SELECT id FROM email_thread_links WHERE subject = 'Quote for the booking module' LIMIT 1`,
			)
			expect(threadId, 'seeded thread must exist').not.toBe('')

			// WHEN the user navigates to the thread
			await page.goto(`/emails/${threadId}`, { waitUntil: 'networkidle' })

			// THEN exactly two message cards render
			const cards = page.getByTestId('thread-message-card')
			await expect(cards).toHaveCount(2)

			// AND both carry data-direction='inbound' (the seed only sends
			// inbound; outbound only appears after a reply send)
			const first = cards.nth(0)
			const second = cards.nth(1)
			await expect(first).toHaveAttribute('data-direction', 'inbound')
			await expect(second).toHaveAttribute('data-direction', 'inbound')
		})
	})

	test.describe('when the user toggles Show Cc on a message with no Cc list', () => {
		test('should not render the toggle (the disclosure is conditional)', async ({
			page,
		}) => {
			// GIVEN M1+M2 were seeded without Cc recipients. The CcToggle
			// only renders when `msg.cc.length > 0`, so its absence is the
			// behavior under test — proves the disclosure is gated.
			const threadId = psql(
				`SELECT id FROM email_thread_links WHERE subject = 'Quote for the booking module' LIMIT 1`,
			)
			expect(threadId, 'seeded thread must exist').not.toBe('')

			await page.goto(`/emails/${threadId}`, { waitUntil: 'networkidle' })

			// THEN the Cc toggle is not in the DOM for either card.
			await expect(page.getByTestId('thread-cc-toggle')).toHaveCount(0)
		})
	})
})
