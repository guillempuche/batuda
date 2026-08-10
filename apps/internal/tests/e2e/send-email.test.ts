import { execSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import { openCompose } from './helpers/compose'
import { DATABASE_URL } from './helpers/database-url'
import { expectNoMessage, waitForMessage } from './helpers/mail-catcher'
import { setActiveOrgBySlug } from './helpers/set-active-org'

// Sends a brand-new email via the compose UI and asserts it lands on the
// mail catcher's REST API. The seeded inbox points at localhost:1025/1143
// with security='plain', so the round-trip works.
//
// Selectors verified against:
//   apps/internal/src/components/emails/compose-form.tsx (compose-{form,to,
//   subject,send})
//   apps/internal/src/routes/emails/index.tsx (emails-compose)

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

test.describe('compose and send via the mail catcher', () => {
	test.beforeEach(async ({ page }) => {
		// GIVEN Alice's session is on Taller
		// AND the seeded inbox's grant_status is forced to `connected`. The
		// inbox-health probe (services/inbox-health-probe.ts) marks the inbox
		// connected against the reachable catcher, but it runs on a 15-min
		// cadence and its first tick can lose the race to a cold-booting
		// catcher; this UPDATE keeps the send pipeline (which blocks on
		// GrantUnavailable) asserting only what it owns.
		psql(
			`UPDATE inboxes SET grant_status='connected' WHERE email='admin@taller.cat'`,
		)
		await page.goto('/', { waitUntil: 'commit' })
		await setActiveOrgBySlug(page, 'taller')
	})

	test.describe('when an authenticated user sends a brand-new email', () => {
		test("should write the message to the catcher's inbox (poll until present)", async ({
			page,
		}) => {
			// GIVEN a recipient and subject nobody else uses — the catcher is shared
			// with every checkout on this machine and keeps what earlier runs
			// delivered, so only a unique pair makes the lookup below mean anything.
			const testId = `e2e-${Date.now()}`
			const recipient = `${testId}@catcher.local`
			const subject = `Test ${testId}`

			// WHEN Alice opens compose, fills the form, and clicks Send
			await page.goto('/emails')
			await openCompose(page, 'emails-compose')
			await page.getByTestId('compose-to').fill(recipient)
			await page.getByTestId('compose-subject').fill(subject)
			await fillBody(page, `Hello from e2e ${testId}`)
			await expect(page.getByTestId('compose-send')).toBeEnabled()
			await page.getByTestId('compose-send').click()

			// THEN the mail catcher receives the message within the polling window
			const msg = await waitForMessage(recipient, { subject })
			expect(msg.Subject).toBe(subject)
		})

		test('should close the compose window after a successful send', async ({
			page,
		}) => {
			const testId = `e2e-close-${Date.now()}`
			const recipient = `${testId}@catcher.local`

			await page.goto('/emails')
			await openCompose(page, 'emails-compose')
			await page.getByTestId('compose-to').fill(recipient)
			await page.getByTestId('compose-subject').fill(`Subj ${testId}`)
			await fillBody(page, `Body ${testId}`)
			await page.getByTestId('compose-send').click()

			// Wait for the catcher to confirm the round-trip before checking the
			// UI — eliminates the "did the click do nothing?" failure mode.
			await waitForMessage(recipient, { subject: `Subj ${testId}` })
			await expect(page.getByTestId('compose-window')).toBeHidden({
				timeout: 5_000,
			})
		})
	})

	test.describe('when the recipient is suppressed', () => {
		test.beforeEach(() => {
			// AND Pep Casals' email channel is forced into bounced state so
			// SuppressionGuard trips on the recipient
			psql(
				`UPDATE channels SET status='bounced', status_reason='${SUPPRESSED_REASON}', status_updated_at=now() WHERE channel='email' AND address='${SUPPRESSED_EMAIL}'`,
			)
		})

		test.afterEach(() => {
			psql(
				`UPDATE channels SET status='unknown', status_reason=NULL, status_updated_at=now(), soft_bounce_count=0 WHERE channel='email' AND address='${SUPPRESSED_EMAIL}'`,
			)
		})

		test('should disable Send and never reach the catcher', async ({
			page,
		}) => {
			// GIVEN Alice opens compose from Pep Casals' company so SuppressionGuard
			// has a companyId to query against
			await page.goto('/companies/cal-pep-fonda', { waitUntil: 'networkidle' })
			await openCompose(page, 'action-compose-email')

			// WHEN Alice puts the suppressed contact in `to`, under a subject unique
			// to this run so the check below can name the message that must not
			// arrive.
			const blockedSubject = `blocked send ${Date.now()}`
			await page.getByTestId('compose-to').fill(SUPPRESSED_EMAIL)
			await page.getByTestId('compose-subject').fill(blockedSubject)
			await fillBody(page, 'should not arrive')

			// THEN the Send button stays disabled, no message reaches the catcher
			await expect(page.getByTestId('compose-send')).toBeDisabled()
			await expectNoMessage(SUPPRESSED_EMAIL, blockedSubject)
		})

		test('should disable Send when the address carries a display name', async ({
			page,
		}) => {
			// GIVEN Alice opens compose from Pep Casals' company, as above
			await page.goto('/companies/cal-pep-fonda', { waitUntil: 'networkidle' })
			await openCompose(page, 'action-compose-email')

			// WHEN she writes the same blocked address with a display name around
			// it, the way a recipient arrives when it is copied out of another
			// message — the comma inside the quoted name is what a plain split on
			// separators breaks apart
			const blockedSubject = `blocked display name ${Date.now()}`
			await page
				.getByTestId('compose-to')
				.fill(`"Casals, Pep" <${SUPPRESSED_EMAIL}>`)
			await page.getByTestId('compose-subject').fill(blockedSubject)
			await fillBody(page, 'should not arrive')

			// THEN the warning names the bare address and Send stays disabled, the
			// same as when it was typed bare — the check answers on the address
			// inside the field, which is the one the send would refuse over
			await expect(page.getByTestId('compose-suppressed')).toContainText(
				SUPPRESSED_EMAIL,
				{ timeout: 10_000 },
			)
			await expect(page.getByTestId('compose-send')).toBeDisabled()
			await expectNoMessage(SUPPRESSED_EMAIL, blockedSubject)
		})
	})
})
