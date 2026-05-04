import { execSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import { clearMailpit, getMessage, waitForMessage } from './helpers/mailpit'
import { setActiveOrgBySlug } from './helpers/set-active-org'

// Sends an email with a small PDF attachment via the compose UI and
// asserts mailpit's parsed metadata carries the file. Slice 6.4
// deferred this spec until the dev stack had a real SMTP catcher.
//
// Selectors verified against:
//   apps/internal/src/components/emails/compose-form.tsx (compose-{form,to,
//   subject,send})
//   apps/internal/src/components/emails/attachment-picker.tsx (hidden file
//   input under aria-label="Add attachment")

const DATABASE_URL =
	process.env['E2E_DATABASE_URL'] ??
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

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
		await clearMailpit()
		// See send-email.test.ts beforeEach for the rationale: the
		// dev-stack inbox-health probe trips the seeded mailpit inbox
		// to `connect_failed` on its 15-min cadence, so we re-assert
		// `connected` per test to avoid GrantUnavailable on sendDraft.
		psql(
			`UPDATE inboxes SET grant_status='connected' WHERE email='admin@taller.cat'`,
		)
		await page.goto('/', { waitUntil: 'commit' })
		await setActiveOrgBySlug(page, 'taller')
	})

	test.describe('when the user attaches a small PDF', () => {
		test("should include the attachment in mailpit's message metadata", async ({
			page,
		}) => {
			const testId = `e2e-attach-${Date.now()}`
			const recipient = `${testId}@catcher.local`
			const filename = `${testId}.pdf`

			// GIVEN compose is open and the form is fillable
			// Wait for hydration before clicking the open button. `goto`'s
			// default `load` event fires before TanStack Start finishes
			// streaming + hydrating, so the click can land on the not-yet-
			// wired form action and the SSR replay buffer occasionally
			// misses it on hot-rebuilt dev bundles.
			await page.goto('/emails', { waitUntil: 'networkidle' })
			await page.getByTestId('emails-compose').click()
			await expect(page.getByTestId('compose-form')).toBeVisible({
				timeout: 15_000,
			})
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

			// THEN mailpit receives the message with the attachment metadata
			const summary = await waitForMessage(`to:${recipient}`)
			const detail = await getMessage(summary.ID)
			const att = detail.Attachments.find(a => a.FileName === filename)
			expect(att, 'attachment present on mailpit message').toBeDefined()
			expect(att?.ContentType).toBe('application/pdf')
			expect(att?.Size).toBeGreaterThan(0)
		})

		test('should purge email_attachment_staging on success', async ({
			page,
		}) => {
			const testId = `e2e-att-sent-${Date.now()}`
			const recipient = `${testId}@catcher.local`
			const filename = `${testId}.pdf`

			// Wait for hydration before clicking the open button. `goto`'s
			// default `load` event fires before TanStack Start finishes
			// streaming + hydrating, so the click can land on the not-yet-
			// wired form action and the SSR replay buffer occasionally
			// misses it on hot-rebuilt dev bundles.
			await page.goto('/emails', { waitUntil: 'networkidle' })
			await page.getByTestId('emails-compose').click()
			await expect(page.getByTestId('compose-form')).toBeVisible({
				timeout: 15_000,
			})
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
			await page.getByTestId('compose-send').click()

			// Wait for the send to land in mailpit before reading the staging
			// row — the post-send purge runs after the SMTP ack.
			await waitForMessage(`to:${recipient}`)

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
