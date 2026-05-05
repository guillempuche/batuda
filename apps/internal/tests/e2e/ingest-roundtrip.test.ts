import { execSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import { setActiveOrgBySlug } from './helpers/set-active-org'
import { injectViaSmtp } from './helpers/smtp-inject'

// Cross-process IMAP-ingest roundtrip. SKIPPED locally: Mailpit (the
// dev compose mail catcher) does not implement IMAP — only SMTP +
// POP3 + HTTP. The mail-worker connects via ImapFlow, which fails
// with "Unexpected close" on every tick, and the row this test
// asserts can never appear. Re-enable once we swap Mailpit for a
// test container that speaks IMAP (greenmail, dovecot, etc.) or
// when this spec runs against a real provider in CI.

const DATABASE_URL =
	process.env['E2E_DATABASE_URL'] ??
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

const psql = (sqlText: string): string =>
	execSync(`psql "${DATABASE_URL}" -tA -c "${sqlText.replace(/"/g, '\\"')}"`, {
		encoding: 'utf8',
	}).trim()

const waitForRow = async (
	queryFn: () => string,
	{ timeoutMs = 30_000, pollMs = 500 } = {},
): Promise<string> => {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		const v = queryFn()
		if (v) return v
		await new Promise(r => setTimeout(r, pollMs))
	}
	throw new Error('worker did not ingest within timeout')
}

test.describe
	.skip('SMTP → IMAP → DB roundtrip (needs IMAP-capable catcher)', () => {
		test.beforeEach(async ({ page }) => {
			// Make sure Alice is active on Taller so any UI-side assertions
			// downstream resolve in the right org.
			await page.goto('/', { waitUntil: 'commit' })
			await setActiveOrgBySlug(page, 'taller')
		})

		test.describe('when an external sender SMTPs a fresh message', () => {
			test('should appear as an inbound email_messages row within the worker tick window', async () => {
				const testId = `roundtrip-${Date.now()}`
				const subject = `e2e roundtrip ${testId}`

				// WHEN we SMTP-inject a message addressed to Alice's seeded inbox
				await injectViaSmtp({
					to: 'admin@taller.cat',
					from: `sender-${testId}@example.com`,
					subject,
					text: `body ${testId}`,
				})

				// THEN the worker ingests it within ~30s (IDLE wake-up + folder-
				// sync tick + INSERT). Poll on the unique subject to be tick-
				// agnostic.
				const direction = await waitForRow(() =>
					psql(
						`SELECT direction FROM email_messages
					 WHERE subject = '${subject.replace(/'/g, "''")}'`,
					),
				)
				expect(direction).toBe('inbound')
			})
		})
	})
