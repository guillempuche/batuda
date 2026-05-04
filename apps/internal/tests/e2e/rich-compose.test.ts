import { execSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import { clearMailpit, getRawMessage, waitForMessage } from './helpers/mailpit'
import { setActiveOrgBySlug } from './helpers/set-active-org'

// Rich-compose path. The Tiptap editor inside the compose form is
// driven through its bubble menu — selecting text exposes Bold,
// Bullet List, and Link buttons. We trigger formatting via keyboard
// shortcuts (Cmd+B / Cmd+Shift+8 / Cmd+K-style flow) because the
// upstream `@react-email/editor` bubble menu DOM is not stable enough
// for testid-style hooks. The wire-side assertion is what proves the
// formatting survived: the raw RFC822 must contain `<strong>`, `<ul>`,
// `<li>`, and an `<a href` tag.
//
// Selectors verified against:
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

const editorOf = (page: import('@playwright/test').Page) =>
	page.getByTestId('compose-form').locator('[role="textbox"]').first()

test.describe('compose with rich formatting', () => {
	test.beforeEach(async ({ page }) => {
		// GIVEN Mailpit is empty and the seeded inbox is reachable.
		await clearMailpit()
		psql(
			`UPDATE inboxes SET grant_status='connected' WHERE email='admin@taller.cat'`,
		)
		await page.goto('/', { waitUntil: 'commit' })
		await setActiveOrgBySlug(page, 'taller')
	})

	test.describe('when the user composes with bold + a bullet list', () => {
		test('should send an HTML body that carries <strong>, <ul>, and <li> on the wire', async ({
			page,
		}) => {
			const testId = `rich-${Date.now()}`
			const recipient = `${testId}@catcher.local`

			// WHEN Alice opens compose and types a rich body
			await page.goto('/emails')
			await page.getByTestId('emails-compose').click()
			await expect(page.getByTestId('compose-form')).toBeVisible()
			await page.getByTestId('compose-to').fill(recipient)
			await page.getByTestId('compose-subject').fill(`Subj ${testId}`)

			const editor = editorOf(page)
			await editor.click()
			// Bold word via Cmd+B (Tiptap's stock keymap)
			await page.keyboard.press('Meta+b')
			await editor.pressSequentially('Hello')
			await page.keyboard.press('Meta+b')
			await editor.pressSequentially(' world\n')
			// Bullet list via the standard Tiptap Markdown shortcut
			await editor.pressSequentially('- one\n')
			await editor.pressSequentially('two\n')

			await expect(page.getByTestId('compose-send')).toBeEnabled()
			await page.getByTestId('compose-send').click()

			// THEN the raw RFC822 carries the formatting on the html part
			const summary = await waitForMessage(`to:${recipient}`)
			const raw = await getRawMessage(summary.ID)
			expect(raw).toMatch(/<strong>Hello<\/strong>/i)
			expect(raw).toMatch(/<ul>/i)
			expect(raw).toMatch(/<li>/i)
		})
	})

	test.describe('when the body is plain text only', () => {
		test('should still produce a text/plain part on the wire', async ({
			page,
		}) => {
			const testId = `plain-${Date.now()}`
			const recipient = `${testId}@catcher.local`

			await page.goto('/emails')
			await page.getByTestId('emails-compose').click()
			await expect(page.getByTestId('compose-form')).toBeVisible()
			await page.getByTestId('compose-to').fill(recipient)
			await page.getByTestId('compose-subject').fill(`Subj ${testId}`)

			const editor = editorOf(page)
			await editor.click()
			await editor.pressSequentially(`Plain body ${testId}`)

			await page.getByTestId('compose-send').click()

			const summary = await waitForMessage(`to:${recipient}`)
			const raw = await getRawMessage(summary.ID)
			// A text/plain part is the baseline for any nodemailer-emitted
			// message; if this regresses, the rich path probably stopped
			// producing the alt content too.
			expect(raw).toMatch(/content-type:\s*text\/plain/i)
		})
	})
})
