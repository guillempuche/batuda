import { execSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import {
	clearMailpit,
	expectNoMessage,
	waitForMessage,
} from './helpers/mailpit'
import { setActiveOrgBySlug } from './helpers/set-active-org'

// Sends a brand-new email via the compose UI and asserts it lands on
// mailpit's HTTP API. Slice 3.7 deferred this spec until the dev stack
// had a real SMTP/IMAP catcher; the seeded inbox now points at
// localhost:1025/1143 with security='plain', so the round-trip works.
//
// Selectors verified against:
//   apps/internal/src/components/emails/compose-form.tsx (compose-{form,to,
//   subject,send})
//   apps/internal/src/routes/emails/index.tsx (emails-compose)

const DATABASE_URL =
	process.env['E2E_DATABASE_URL'] ??
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

const SUPPRESSED_EMAIL = 'pep@calpepfonda.cat'
const SUPPRESSED_REASON = '550 5.1.1 mailbox not found (e2e fixture)'

const psql = (sqlText: string): string =>
	execSync(`psql "${DATABASE_URL}" -tA -c "${sqlText.replace(/"/g, '\\"')}"`, {
		encoding: 'utf8',
	}).trim()

const fillBody = async (
	page: import('@playwright/test').Page,
	text: string,
) => {
	// EmailEditor is a Tiptap ProseMirror contenteditable. It carries
	// role=textbox and lives inside the compose-form scope.
	const editor = page
		.getByTestId('compose-form')
		.locator('[role="textbox"]')
		.first()
	await editor.click()
	await editor.pressSequentially(text)
}

test.describe('compose and send via mailpit', () => {
	test.beforeEach(async ({ page }) => {
		// GIVEN mailpit is empty for this spec and Alice's session is on Taller
		await clearMailpit()
		await page.goto('/', { waitUntil: 'commit' })
		await setActiveOrgBySlug(page, 'taller')
	})

	test.describe('when an authenticated user sends a brand-new email', () => {
		test("should write the message to mailpit's inbox (poll until present)", async ({
			page,
		}) => {
			// Unique recipient + subject keeps mailpit search deterministic
			// even if a previous run left stragglers (clearMailpit covers it,
			// but a fresh address belt-and-suspenders the assertion).
			const testId = `e2e-${Date.now()}`
			const recipient = `${testId}@catcher.local`
			const subject = `Test ${testId}`

			// WHEN Alice opens compose, fills the form, and clicks Send
			await page.goto('/emails')
			await page.getByTestId('emails-compose').click()
			await expect(page.getByTestId('compose-form')).toBeVisible()
			await page.getByTestId('compose-to').fill(recipient)
			await page.getByTestId('compose-subject').fill(subject)
			await fillBody(page, `Hello from e2e ${testId}`)
			await expect(page.getByTestId('compose-send')).toBeEnabled()
			await page.getByTestId('compose-send').click()

			// THEN mailpit receives the message within the polling window
			const msg = await waitForMessage(`to:${recipient}`)
			expect(msg.Subject).toBe(subject)
		})

		test('should close the compose window after a successful send', async ({
			page,
		}) => {
			const testId = `e2e-close-${Date.now()}`
			const recipient = `${testId}@catcher.local`

			await page.goto('/emails')
			await page.getByTestId('emails-compose').click()
			await expect(page.getByTestId('compose-form')).toBeVisible()
			await page.getByTestId('compose-to').fill(recipient)
			await page.getByTestId('compose-subject').fill(`Subj ${testId}`)
			await fillBody(page, `Body ${testId}`)
			await page.getByTestId('compose-send').click()

			// Wait for mailpit to confirm the round-trip before checking the
			// UI — eliminates the "did the click do nothing?" failure mode.
			await waitForMessage(`to:${recipient}`)
			await expect(page.getByTestId('compose-window')).toBeHidden({
				timeout: 5_000,
			})
		})
	})

	test.describe('when the recipient is suppressed', () => {
		test.beforeEach(() => {
			// AND Pep Casals is forced into bounced state so SuppressionGuard
			// trips on the recipient
			psql(
				`UPDATE contacts SET email_status='bounced', email_status_reason='${SUPPRESSED_REASON}', email_status_updated_at=now() WHERE email='${SUPPRESSED_EMAIL}'`,
			)
		})

		test.afterEach(() => {
			psql(
				`UPDATE contacts SET email_status='unknown', email_status_reason=NULL, email_status_updated_at=now(), email_soft_bounce_count=0 WHERE email='${SUPPRESSED_EMAIL}'`,
			)
		})

		test('should disable Send and never reach mailpit', async ({ page }) => {
			// GIVEN Alice opens compose from Pep Casals' company so SuppressionGuard
			// has a companyId to query against
			await page.goto('/companies/cal-pep-fonda', { waitUntil: 'networkidle' })
			await page.getByTestId('action-compose-email').click()
			await expect(page.getByTestId('compose-form')).toBeVisible()

			// WHEN Alice puts the suppressed contact in `to`
			await page.getByTestId('compose-to').fill(SUPPRESSED_EMAIL)
			await page.getByTestId('compose-subject').fill('blocked send')
			await fillBody(page, 'should not arrive')

			// THEN the Send button stays disabled, no message reaches mailpit
			await expect(page.getByTestId('compose-send')).toBeDisabled()
			await expectNoMessage(`to:${SUPPRESSED_EMAIL}`)
		})
	})
})
