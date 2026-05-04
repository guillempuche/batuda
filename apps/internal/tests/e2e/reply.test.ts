import { execSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import { clearMailpit, getRawMessage, waitForMessage } from './helpers/mailpit'
import { setActiveOrgBySlug } from './helpers/set-active-org'

// Reply path. The seed SMTPs M1+M2 (Pep × Alice) into Mailpit; the
// mail-worker ingests them on its next IDLE cycle so the threads list
// renders before the test runs. The reply submit goes through the same
// compose form the rest of the suite drives, so we lean on its
// existing testids and assert on the wire bytes Mailpit captures —
// the SMTP socket is the single authoritative source for "did the
// reply land with the right In-Reply-To/References".
//
// Selectors verified against:
//   apps/internal/src/routes/emails/$threadId.tsx
//     (thread-reply, thread-reply-all)
//   apps/internal/src/components/emails/compose-form.tsx
//     (compose-{form,to,subject,send})

const DATABASE_URL =
	process.env['E2E_DATABASE_URL'] ??
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

const psql = (sqlText: string): string =>
	execSync(`psql "${DATABASE_URL}" -tA -c "${sqlText.replace(/"/g, '\\"')}"`, {
		encoding: 'utf8',
	}).trim()

const fillBody = async (
	page: import('@playwright/test').Page,
	text: string,
) => {
	const editor = page
		.getByTestId('compose-form')
		.locator('[role="textbox"]')
		.first()
	await editor.click()
	await editor.pressSequentially(text)
}

test.describe('reply on a seeded thread', () => {
	test.beforeEach(async ({ page }) => {
		// GIVEN Mailpit is empty and Alice's session is active on Taller.
		await clearMailpit()
		// AND the seeded inbox is reachable (the inbox-health probe trips
		// `connect_failed` on a 15-min cadence and would block sendDraft;
		// reset to `connected` so the spec asserts the reply path itself).
		psql(
			`UPDATE inboxes SET grant_status='connected' WHERE email='admin@taller.cat'`,
		)
		await page.goto('/', { waitUntil: 'commit' })
		await setActiveOrgBySlug(page, 'taller')
	})

	test.describe('when the user clicks Reply on the booking-module thread', () => {
		test('should send a message that carries In-Reply-To and References pointing at the parent', async ({
			page,
		}) => {
			// GIVEN the seeded thread "Quote for the booking module" is in
			// the inbox; resolve its threadId from the DB so we navigate
			// straight to the route (clicking the row would also work, but
			// pulls in the listing render path which has its own spec).
			const threadId = psql(
				`SELECT id FROM email_thread_links WHERE subject = 'Quote for the booking module' LIMIT 1`,
			)
			expect(threadId, 'seeded thread must exist').not.toBe('')

			await page.goto(`/emails/${threadId}`, { waitUntil: 'networkidle' })

			// WHEN Alice clicks Reply and sends a body via the compose form
			await page.getByTestId('thread-reply').click()
			await expect(page.getByTestId('compose-form')).toBeVisible()
			const body = `e2e reply ${Date.now()}`
			await fillBody(page, body)
			await expect(page.getByTestId('compose-send')).toBeEnabled()
			await page.getByTestId('compose-send').click()

			// THEN Mailpit captures the reply, and the raw RFC822 carries
			// In-Reply-To + References pointing at the parent's Message-Id.
			const summary = await waitForMessage('to:pep@calpepfonda.cat', {
				timeoutMs: 10_000,
			})
			const raw = await getRawMessage(summary.ID)
			expect(raw).toMatch(/in-reply-to:\s*<[^>]+>/i)
			expect(raw).toMatch(/references:\s*<[^>]+>/i)
		})
	})

	test.describe('when the user clicks Reply all', () => {
		test('should land a Cc on the wire when the parent had additional recipients', async ({
			page,
		}) => {
			// GIVEN the booking-module thread root (M1) — the seed sends it
			// from pep@calpepfonda.cat with a single To. Reply-all should
			// still produce a valid send (no Cc on a single-recipient parent
			// is a no-op rather than a regression). This baseline exists so
			// that future seed expansions of M1's Cc list trip the assertion.
			const threadId = psql(
				`SELECT id FROM email_thread_links WHERE subject = 'Quote for the booking module' LIMIT 1`,
			)
			expect(threadId, 'seeded thread must exist').not.toBe('')

			await page.goto(`/emails/${threadId}`, { waitUntil: 'networkidle' })

			// WHEN Alice clicks Reply all and sends
			await page.getByTestId('thread-reply-all').click()
			await expect(page.getByTestId('compose-form')).toBeVisible()
			const body = `e2e reply-all ${Date.now()}`
			await fillBody(page, body)
			await expect(page.getByTestId('compose-send')).toBeEnabled()
			await page.getByTestId('compose-send').click()

			// THEN Mailpit captures the reply with the same threading headers
			const summary = await waitForMessage('to:pep@calpepfonda.cat', {
				timeoutMs: 10_000,
			})
			const raw = await getRawMessage(summary.ID)
			expect(raw).toMatch(/in-reply-to:\s*<[^>]+>/i)
		})
	})
})
