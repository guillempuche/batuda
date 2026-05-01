import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { setActiveOrgBySlug } from './helpers/set-active-org'

// End-to-end invite + accept. The flow under test:
//
//   1. Alice (taller owner) opens /settings/organization/invite, fills
//      the form, submits.
//   2. The server's `sendInvitationEmail` callback pre-creates the
//      invitee, mints a magic-link sign-in URL pointing at
//      /accept-invitation/<id>, and ships it via the local
//      transactional provider. The .md file lands under
//      apps/server/.dev-inbox/ with `labels: invitation`.
//   3. The test reads the .md, extracts the magic-link URL.
//   4. A FRESH browser context (no Alice cookie) opens the URL: BA's
//      magic-link verify endpoint signs the invitee in AND redirects
//      via the callbackURL to /accept-invitation/<id>.
//   5. The accept page calls authClient.organization.acceptInvitation,
//      which flips the `member` row from pending to accepted.
//   6. We assert the success card renders.
//
// Selectors verified against:
//   apps/internal/src/routes/settings/organization/invite.tsx
//   apps/internal/src/routes/accept-invitation.$id.tsx
//
// Auth: Alice's session is from `auth.setup`'s storageState. The invitee
// uses a fresh context so we don't reuse Alice's cookie when clicking
// the magic link.

const INBOX_DIR = join(process.cwd(), '..', 'server', '.dev-inbox')

interface InvitationMail {
	readonly file: string
	readonly url: string
}

// Reads the dev-inbox dir, finds the most recent .md whose recipient
// slug matches the invitee, and pulls the magic-link URL out of the
// body. Polls because the API returns before the file is on disk in
// some test runs.
async function pollInvitationMail(
	recipient: string,
	timeoutMs: number,
): Promise<InvitationMail> {
	const slug = recipient.split('@')[0]!
	const deadline = Date.now() + timeoutMs
	let lastErr: unknown
	while (Date.now() < deadline) {
		try {
			const files = await readdir(INBOX_DIR)
			const match = files
				.filter(name => name.includes(slug) && name.endsWith('.md'))
				.sort()
				.pop()
			if (match) {
				const body = await readFile(join(INBOX_DIR, match), 'utf8')
				if (!body.includes('labels:')) {
					await new Promise(r => {
						setTimeout(r, 200)
					})
					continue
				}
				if (!body.includes('invitation')) {
					// Found the file but it's a magic-link, not invitation.
					// Keep polling — the invitation file is the next one.
					await new Promise(r => {
						setTimeout(r, 200)
					})
					continue
				}
				const urlMatch = body.match(
					/https?:\/\/[^\s]*\/auth\/magic-link\/verify[^\s]*/,
				)
				if (urlMatch) return { file: match, url: urlMatch[0] }
			}
		} catch (e) {
			lastErr = e
		}
		await new Promise(r => {
			setTimeout(r, 200)
		})
	}
	throw new Error(
		`invitation .md for ${recipient} did not appear within ${timeoutMs}ms (last error: ${String(lastErr)})`,
	)
}

test.describe('org invitation end-to-end', () => {
	test.beforeEach(async ({ page }) => {
		// Reset Alice to taller — sibling tests may have flipped her org.
		await page.goto('/', { waitUntil: 'commit' })
		await setActiveOrgBySlug(page, 'taller')
	})

	test.describe('when the org owner invites a brand-new user', () => {
		// Each run uses a unique recipient so reseeding the DB isn't
		// required between runs of this single test file.
		const recipient = `invitee-${Date.now()}@example.com`

		test('should send an invitation, accept it via the magic link, and add the member', async ({
			page,
			browser,
		}) => {
			// GIVEN Alice is on the invite form
			await page.goto('/settings/organization/invite', {
				waitUntil: 'networkidle',
			})
			await expect(page.getByTestId('invite-form')).toBeVisible()

			// WHEN she submits an email + role=member
			await page.getByTestId('invite-email').fill(recipient)
			await page.getByTestId('invite-role').selectOption('member')
			await page.getByTestId('invite-submit').click()

			// THEN the success banner should render (proves the API resolved
			// without an error — the invitation row is in the DB and the
			// transactional provider was called).
			await expect(page.getByTestId('invite-success')).toBeVisible({
				timeout: 10_000,
			})

			// AND a .md file should land in apps/server/.dev-inbox/ with
			// `labels: invitation` and a magic-link URL we can extract.
			const mail = await pollInvitationMail(recipient, 5_000)
			expect(mail.url).toContain('/auth/magic-link/verify')
			expect(decodeURIComponent(mail.url)).toContain('/accept-invitation/')

			// WHEN the invitee opens the URL in a fresh browser context (no
			// Alice cookie — we want to prove the magic-link path itself
			// authenticates, not that we reused an existing session).
			const inviteeContext = await browser.newContext({
				ignoreHTTPSErrors: true,
			})
			const inviteePage = await inviteeContext.newPage()
			await inviteePage.goto(mail.url, { waitUntil: 'networkidle' })

			// THEN the accept page should render and reach the success state
			// (the magic link signs the invitee in, the callback URL lands
			// them on /accept-invitation/<id>, and the page's effect calls
			// authClient.organization.acceptInvitation which flips the
			// member row from pending to accepted).
			await expect(
				inviteePage.getByTestId('accept-invitation-success'),
			).toBeVisible({ timeout: 15_000 })

			await inviteeContext.close()
		})
	})
})
