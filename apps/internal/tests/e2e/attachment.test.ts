import { execSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import { openCompose } from './helpers/compose'
import { DATABASE_URL } from './helpers/database-url'
import { getMessage, waitForMessage } from './helpers/mail-catcher'
import { setActiveOrgBySlug } from './helpers/set-active-org'

// Sends an email with a small PDF attachment via the compose UI and
// asserts the mail catcher's parsed metadata carries the file. The seeded
// inbox points at the dev SMTP catcher, so the round-trip works.
//
// Selectors verified against:
//   apps/internal/src/components/emails/compose-form.tsx (compose-{form,to,
//   subject,send})
//   apps/internal/src/components/emails/attachment-picker.tsx (hidden file
//   input under aria-label="Add attachment")

const psql = (sqlText: string): string =>
	execSync(`psql "${DATABASE_URL}" -tA -c "${sqlText.replace(/"/g, '\\"')}"`, {
		encoding: 'utf8',
	}).trim()

// Minimal valid PDF (under 1 KB) — proves the attachment pipeline,
// not the size-limit guard.
const PDF_BYTES = Buffer.from(
	[
		'%PDF-1.4',
		'1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
		'2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
		'3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj',
		'xref',
		'0 4',
		'0000000000 65535 f',
		'0000000010 00000 n',
		'0000000060 00000 n',
		'0000000110 00000 n',
		'trailer << /Root 1 0 R /Size 4 >>',
		'startxref',
		'170',
		'%%EOF',
	].join('\n'),
	'utf8',
)

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

test.describe('compose with attachment', () => {
	test.beforeEach(async ({ page }) => {
		// See send-email.test.ts beforeEach for the rationale: force the
		// seeded inbox `connected` so a cold-catcher probe tick can't trip
		// GrantUnavailable on sendDraft.
		psql(
			`UPDATE inboxes SET grant_status='connected' WHERE email='admin@taller.cat'`,
		)
		await page.goto('/', { waitUntil: 'commit' })
		await setActiveOrgBySlug(page, 'taller')
	})

	test.describe('when the user attaches a small PDF', () => {
		test("should include the attachment in the catcher's message metadata", async ({
			page,
		}) => {
			const testId = `e2e-attach-${Date.now()}`
			const recipient = `${testId}@catcher.local`
			const filename = `${testId}.pdf`

			// GIVEN compose is open and the form is fillable
			await page.goto('/emails', { waitUntil: 'networkidle' })
			await openCompose(page, 'emails-compose')
			await page.getByTestId('compose-to').fill(recipient)
			await page.getByTestId('compose-subject').fill(`Subj ${testId}`)
			await fillBody(page, `Body ${testId}`)

			// WHEN the user attaches a tiny PDF via the hidden file input
			await page
				.getByTestId('compose-form')
				.locator('input[type="file"]')
				.setInputFiles({
					name: filename,
					mimeType: 'application/pdf',
					buffer: PDF_BYTES,
				})

			// AND waits for the upload chip to leave its uploading state
			await expect(
				page.getByTestId('compose-form').getByText(filename),
			).toBeVisible()
			await expect(page.getByTestId('compose-send')).toBeEnabled({
				timeout: 10_000,
			})
			await page.getByTestId('compose-send').click()

			// THEN the catcher receives the message with the attachment metadata
			const summary = await waitForMessage(recipient, {
				subject: `Subj ${testId}`,
			})
			const detail = await getMessage(summary)
			const att = detail.Attachments.find(a => a.FileName === filename)
			expect(att, 'attachment present on catcher message').toBeDefined()
			expect(att?.ContentType).toBe('application/pdf')
			expect(att?.Size).toBeGreaterThan(0)
		})
	})

	test.describe('when the user attaches several files at once', () => {
		test('should send every one of them, not just the last to finish', async ({
			page,
		}) => {
			// GIVEN two files chosen in a single pick, the way a file dialog
			// hands them over
			const testId = `e2e-attach-many-${Date.now()}`
			const recipient = `${testId}@catcher.local`
			const first = `${testId}-first.pdf`
			const second = `${testId}-second.pdf`

			await page.goto('/emails', { waitUntil: 'networkidle' })
			await openCompose(page, 'emails-compose')
			await page.getByTestId('compose-to').fill(recipient)
			await page.getByTestId('compose-subject').fill(`Subj ${testId}`)
			await fillBody(page, `Body ${testId}`)

			// WHEN both are picked together
			await page
				.getByTestId('compose-form')
				.locator('input[type="file"]')
				.setInputFiles([
					{ name: first, mimeType: 'application/pdf', buffer: PDF_BYTES },
					{ name: second, mimeType: 'application/pdf', buffer: PDF_BYTES },
				])

			await expect(
				page.getByTestId('compose-form').getByText(first),
			).toBeVisible()
			await expect(
				page.getByTestId('compose-form').getByText(second),
			).toBeVisible()
			await expect(page.getByTestId('compose-send')).toBeEnabled({
				timeout: 15_000,
			})
			await page.getByTestId('compose-send').click()

			// THEN both are on the message that goes out
			// AND this is the case that used to lose one: each upload finished
			// against the list as it was before either began, so whichever
			// landed second replaced the first — silently, on a message that
			// still sent
			const summary = await waitForMessage(recipient, {
				subject: `Subj ${testId}`,
			})
			const detail = await getMessage(summary)
			const names = detail.Attachments.map(a => a.FileName).sort()
			expect(names).toEqual([first, second].sort())
		})
	})

	test.describe('after a send succeeds', () => {
		test('should purge email_attachment_staging on success', async ({
			page,
		}) => {
			const testId = `e2e-att-sent-${Date.now()}`
			const recipient = `${testId}@catcher.local`
			const filename = `${testId}.pdf`

			await page.goto('/emails', { waitUntil: 'networkidle' })
			await openCompose(page, 'emails-compose')
			await page.getByTestId('compose-to').fill(recipient)
			await page.getByTestId('compose-subject').fill(`Subj ${testId}`)
			await fillBody(page, `Body ${testId}`)
			await page
				.getByTestId('compose-form')
				.locator('input[type="file"]')
				.setInputFiles({
					name: filename,
					mimeType: 'application/pdf',
					buffer: PDF_BYTES,
				})
			await expect(page.getByTestId('compose-send')).toBeEnabled({
				timeout: 10_000,
			})

			// Wait for the send request itself to come back, not just for the
			// message to reach the catcher. The catcher has it the moment SMTP
			// delivers, and the purge runs after that — so reading the staging
			// row on the catcher's timing reads it before the purge has run.
			const sent = page.waitForResponse(
				resp =>
					resp.url().includes('/email/drafts/') &&
					resp.url().endsWith('/send') &&
					resp.request().method() === 'POST',
				{ timeout: 20_000 },
			)
			await page.getByTestId('compose-send').click()
			expect((await sent).status()).toBe(200)
			await waitForMessage(recipient, { subject: `Subj ${testId}` })

			// THEN the staging row is gone — markSentAndCleanup deletes it
			// immediately after the provider acks (see
			// apps/server/src/services/email-attachment-staging.ts).
			const remaining = psql(
				`SELECT staging_id FROM email_attachment_staging WHERE filename='${filename}'`,
			)
			expect(remaining).toBe('')
		})
	})
})

test.describe('removing an attachment before sending', () => {
	test('should leave it off the message that goes out', async ({ page }) => {
		// GIVEN a file attached and then taken off again, the way somebody
		// corrects a mistake before sending
		const testId = `e2e-attach-removed-${Date.now()}`
		const recipient = `${testId}@catcher.local`
		const filename = `${testId}.pdf`

		psql(
			`UPDATE inboxes SET grant_status='connected' WHERE email='admin@taller.cat'`,
		)
		await page.goto('/', { waitUntil: 'commit' })
		await setActiveOrgBySlug(page, 'taller')
		await page.goto('/emails', { waitUntil: 'networkidle' })
		await openCompose(page, 'emails-compose')
		await page.getByTestId('compose-to').fill(recipient)
		await page.getByTestId('compose-subject').fill(`Subj ${testId}`)
		await fillBody(page, `Body ${testId}`)
		await page
			.getByTestId('compose-form')
			.locator('input[type="file"]')
			.setInputFiles({
				name: filename,
				mimeType: 'application/pdf',
				buffer: PDF_BYTES,
			})
		await expect(page.getByTestId('compose-send')).toBeEnabled({
			timeout: 10_000,
		})

		// WHEN the chip is removed and the message sent
		await page.getByRole('button', { name: `Remove ${filename}` }).click()
		await expect(
			page.getByTestId('compose-form').getByText(filename),
		).toBeHidden()
		await page.getByTestId('compose-send').click()

		// THEN the message carries no attachment
		const summary = await waitForMessage(recipient, {
			subject: `Subj ${testId}`,
		})
		const detail = await getMessage(summary)
		expect(detail.Attachments.map(a => a.FileName)).toEqual([])
	})
})
