import { execSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import {
	clearMailpit,
	getMessage,
	getRawMessage,
	waitForMessage,
} from './helpers/mailpit'
import { setActiveOrgBySlug } from './helpers/set-active-org'

// Sends an email after configuring a default footer on the seeded inbox
// and asserts the wire bytes carry the footer text. Slice 6.4 deferred
// this spec until a real catcher could observe what nodemailer wrote to
// the SMTP socket.
//
// Reads the raw RFC822 from mailpit's HTTP API rather than the storage
// object — both are fed by the same `transport.send(creds, message)`
// call in apps/server/src/services/email.ts:491; mailpit captures the
// SMTP-receive side, storage captures the nodemailer-emit side. Equally
// authoritative for the "did the footer make it on the wire" question.

const DATABASE_URL =
	process.env['E2E_DATABASE_URL'] ??
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

const SEEDED_INBOX_EMAIL = 'admin@taller.cat'

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

test.describe('compose with footer', () => {
	let footerId: string | null = null
	const footerMarker = `BATUDA_E2E_FOOTER_${Date.now()}`

	test.beforeAll(() => {
		// GIVEN a default footer is configured for Alice's seeded inbox
		const inboxId = psql(
			`SELECT id FROM inboxes WHERE email='${SEEDED_INBOX_EMAIL}' LIMIT 1`,
		)
		expect(inboxId, 'seeded inbox row must exist').not.toBe('')

		const orgId = psql(
			`SELECT organization_id FROM inboxes WHERE id='${inboxId}'`,
		)
		const bodyJson = JSON.stringify([
			{
				type: 'paragraph',
				spans: [{ kind: 'text', value: footerMarker }],
			},
		]).replace(/'/g, "''")

		footerId = psql(
			`INSERT INTO inbox_footers (organization_id, inbox_id, name, body_json, is_default) VALUES ('${orgId}', '${inboxId}', 'e2e-footer', '${bodyJson}'::jsonb, true) RETURNING id`,
		)
	})

	test.afterAll(() => {
		if (footerId !== null && footerId !== '') {
			psql(`DELETE FROM inbox_footers WHERE id='${footerId}'`)
		}
	})

	test.beforeEach(async ({ page }) => {
		await clearMailpit()
		// See send-email.test.ts for the rationale: re-assert
		// `connected` so the inbox-health probe doesn't trip
		// GrantUnavailable on sendDraft.
		psql(
			`UPDATE inboxes SET grant_status='connected' WHERE email='admin@taller.cat'`,
		)
		await page.goto('/', { waitUntil: 'commit' })
		await setActiveOrgBySlug(page, 'taller')
	})

	test.describe('when the inbox has a default footer configured', () => {
		test('should append the footer to the sent message body', async ({
			page,
		}) => {
			const testId = `e2e-footer-${Date.now()}`
			const recipient = `${testId}@catcher.local`

			// WHEN Alice sends a brand-new email
			await page.goto('/emails')
			await page.getByTestId('emails-compose').click()
			await expect(page.getByTestId('compose-form')).toBeVisible()
			await page.getByTestId('compose-to').fill(recipient)
			await page.getByTestId('compose-subject').fill(`Subj ${testId}`)
			await fillBody(page, `Body ${testId}`)
			await expect(page.getByTestId('compose-send')).toBeEnabled()
			await page.getByTestId('compose-send').click()

			// THEN mailpit's parsed text body and the raw wire bytes both
			// contain the footer marker — proves the server appended the
			// footer before serializing.
			const summary = await waitForMessage(`to:${recipient}`)
			const detail = await getMessage(summary.ID)
			expect(detail.Text).toContain(footerMarker)

			const raw = await getRawMessage(summary.ID)
			expect(raw).toContain(footerMarker)
		})
	})
})
