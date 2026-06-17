import { execSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import {
	clearCatcher,
	getMessage,
	getRawMessage,
	waitForMessage,
} from './helpers/mail-catcher'
import { setActiveOrgBySlug } from './helpers/set-active-org'

// Rich-compose path. The Tiptap editor's bubble-menu controls carry no
// stable testids, so formatting is applied the way a user would: the
// "- " Markdown rule starts a bullet list, and a double-click word
// selection plus the stock Cmd+B keymap bolds a word. The proof is
// wire-side: the decoded text/html part the recipient receives, where the
// brand renderer emits inline-styled spans — a font-weight span for bold,
// and <ul>/<li> whose rows wrap their text in <span> — not <strong> or
// bare list tags.
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
		// GIVEN the catcher is empty and the seeded inbox is reachable.
		await clearCatcher()
		psql(
			`UPDATE inboxes SET grant_status='connected' WHERE email='admin@taller.cat'`,
		)
		await page.goto('/', { waitUntil: 'commit' })
		await setActiveOrgBySlug(page, 'taller')
	})

	test.describe('when the user composes with bold + a bullet list', () => {
		test('should send an HTML body where bold and a bullet list survive on the wire', async ({
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
			// Build the body: a first line, then a bullet list. The "- "
			// Markdown input rule fires on typed text and is reliable headless.
			await editor.pressSequentially('Hello world')
			await page.keyboard.press('Enter')
			await editor.pressSequentially('- one')
			await page.keyboard.press('Enter')
			await editor.pressSequentially('two')
			// Bold "Hello" by selecting the word — double-click is a reliable
			// browser primitive — then toggling Tiptap's stock Cmd+B. Toggling
			// bold on an empty caret (stored marks) does not survive the typing
			// that follows in headless Chromium.
			await editor
				.locator('p')
				.filter({ hasText: 'Hello world' })
				.first()
				.dblclick({ position: { x: 8, y: 10 } })
			await page.keyboard.press('Meta+b')

			await expect(page.getByTestId('compose-send')).toBeEnabled()
			await page.getByTestId('compose-send').click()

			// THEN the decoded html part carries the formatting. The brand
			// renderer emits inline-styled spans, not <strong> or bare <ul>:
			// bold is a font-weight span, list rows wrap their text in <span>.
			const summary = await waitForMessage(recipient)
			const html = (await getMessage(summary)).Html
			expect(html).toMatch(/<span style="font-weight:\s*700">Hello<\/span>/i)
			expect(html).toMatch(/<ul[^>]*>/i)
			expect(html).toMatch(/<li[^>]*><span>one<\/span>/i)
			expect(html).toMatch(/<li[^>]*><span>two<\/span>/i)
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

			const summary = await waitForMessage(recipient)
			const raw = getRawMessage(summary)
			// A text/plain part is the baseline for any nodemailer-emitted
			// message; if this regresses, the rich path probably stopped
			// producing the alt content too.
			expect(raw).toMatch(/content-type:\s*text\/plain/i)
		})
	})
})
