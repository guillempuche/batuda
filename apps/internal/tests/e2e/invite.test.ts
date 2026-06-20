import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, type Locator, type Page, test } from '@playwright/test'

import { openInvitePanel } from './helpers/invite-panel'
import { setActiveOrgBySlug } from './helpers/set-active-org'

// Org invitations, now driven entirely from /settings/organization/members:
// the invite form, the pending-invitation list, and cancel/resend all live on
// one page. The end-to-end accept flow:
//
//   1. Alice (taller owner) opens the inline invite panel, fills the form,
//      submits.
//   2. The server's `sendInvitationEmail` callback pre-creates the invitee,
//      mints a magic-link sign-in URL pointing at /accept-invitation/<id>, and
//      ships it via the local transactional provider. The .md lands under
//      apps/server/.dev-inbox/ with `labels: invitation`.
//   3. The test reads the .md and extracts the magic-link URL.
//   4. A FRESH browser context (no Alice cookie) opens the URL: BA's
//      magic-link verify endpoint signs the invitee in AND redirects via the
//      callbackURL to /accept-invitation/<id>.
//   5. The accept page calls acceptInvitation, flipping the member row from
//      pending to accepted.
//
// Selectors verified against:
//   apps/internal/src/routes/settings/organization/members.tsx
//   apps/internal/src/routes/accept-invitation.$id.tsx
//
// Auth: Alice's session comes from `auth.setup`'s storageState. Invitees and
// the member-view persona use fresh contexts so we never reuse Alice's cookie.

const INBOX_DIR = join(process.cwd(), '..', 'server', '.dev-inbox')

const BASE_URL = process.env['E2E_BASE_URL'] ?? 'https://batuda.localhost'

interface InvitationMail {
	readonly file: string
	readonly url: string
}

// Reads the dev-inbox dir, finds the most recent .md whose recipient slug
// matches the invitee, and pulls the magic-link URL out of the body. Polls
// because the API returns before the file is on disk in some test runs.
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
				if (!body.includes('labels:') || !body.includes('invitation')) {
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

// The pending-invitation row for a given email — rows are keyed by invitation
// id, so we locate by the email text the row renders.
function invitationRow(page: Page, email: string): Locator {
	return page
		.locator('[data-testid^="invitation-row-"]')
		.filter({ hasText: email })
}

// Sends an invitation from Alice's already-open invite panel.
async function sendInvite(page: Page, email: string): Promise<void> {
	await page.getByTestId('invite-email').fill(email)
	await page.getByTestId('invite-submit').click()
}

test.describe('org invitations on the members page', () => {
	test.beforeEach(async ({ page }) => {
		// Reset Alice to taller — sibling tests may have flipped her org.
		await page.goto('/', { waitUntil: 'commit' })
		await setActiveOrgBySlug(page, 'taller')
	})

	test.describe('when the org owner invites a brand-new user', () => {
		// Unique recipient so reseeding the DB isn't required between runs.
		const recipient = `invitee-${Date.now()}@example.com`

		test('should send the invitation, list it as pending, and accept it via the magic link', async ({
			page,
			browser,
		}) => {
			// GIVEN Alice opens the invite panel from the members-page CTA
			await openInvitePanel(page)

			// WHEN she submits an email (role defaults to member)
			await sendInvite(page, recipient)

			// THEN the success banner renders (the invitation row is in the DB and
			// the transactional provider was called)
			await expect(page.getByTestId('invite-success')).toBeVisible({
				timeout: 10_000,
			})

			// AND the invitation appears as a pending row with email/role/status
			const row = invitationRow(page, recipient)
			await expect(row).toBeVisible()
			await expect(
				row.locator('[data-testid^="invitation-status-"]'),
			).toContainText('Pending')
			await expect(
				row.locator('[data-testid^="invitation-role-"]'),
			).toContainText('Member')

			// AND a .md invitation lands with a magic-link URL we can extract
			const mail = await pollInvitationMail(recipient, 5_000)
			expect(mail.url).toContain('/auth/magic-link/verify')
			expect(decodeURIComponent(mail.url)).toContain('/accept-invitation/')

			// WHEN the invitee opens the URL in a fresh context (no Alice cookie)
			const inviteeContext = await browser.newContext({
				ignoreHTTPSErrors: true,
			})
			const inviteePage = await inviteeContext.newPage()
			await inviteePage.goto(mail.url, { waitUntil: 'networkidle' })

			// THEN the accept page reaches its success state
			await expect(
				inviteePage.getByTestId('accept-invitation-success'),
			).toBeVisible({ timeout: 15_000 })
			await inviteeContext.close()

			// AND once Alice reloads, the now-accepted invite is no longer pending
			await page.reload({ waitUntil: 'networkidle' })
			await expect(invitationRow(page, recipient)).toHaveCount(0)
		})
	})

	test.describe('when the owner re-invites an already-invited email', () => {
		test('should surface an inline error and keep a single pending row', async ({
			page,
		}) => {
			const recipient = `dup-${Date.now()}@example.com`

			// GIVEN a fresh invitation was just sent
			await openInvitePanel(page)
			await sendInvite(page, recipient)
			await expect(page.getByTestId('invite-success')).toBeVisible({
				timeout: 10_000,
			})
			const row = invitationRow(page, recipient)
			await expect(row).toBeVisible()

			// WHEN the same email is invited again (panel stays open)
			await sendInvite(page, recipient)

			// THEN an inline error explains it's already invited
			await expect(page.getByTestId('invite-error')).toBeVisible()
			// AND there is still exactly one pending row for that email
			await expect(row).toHaveCount(1)

			// cleanup
			await row.locator('[data-testid^="invitation-cancel-"]').click()
			await expect(invitationRow(page, recipient)).toHaveCount(0)
		})
	})

	test.describe('when the owner manages a pending invitation', () => {
		test('should cancel it, drop the row, and confirm', async ({ page }) => {
			const recipient = `cancel-${Date.now()}@example.com`

			// GIVEN a pending invitation
			await openInvitePanel(page)
			await sendInvite(page, recipient)
			const row = invitationRow(page, recipient)
			await expect(row).toBeVisible()

			// WHEN Alice cancels it
			await row.locator('[data-testid^="invitation-cancel-"]').click()

			// THEN the row disappears (canceled invites drop from pending) and a
			// confirmation shows
			await expect(invitationRow(page, recipient)).toHaveCount(0)
			await expect(page.getByTestId('invitation-cancel-confirm')).toBeVisible()
		})

		test('should resend it, keep the row, and confirm', async ({ page }) => {
			const recipient = `resend-${Date.now()}@example.com`

			// GIVEN a pending invitation
			await openInvitePanel(page)
			await sendInvite(page, recipient)
			const row = invitationRow(page, recipient)
			await expect(row).toBeVisible()

			// WHEN Alice resends it
			await row.locator('[data-testid^="invitation-resend-"]').click()

			// THEN a confirmation shows and the row stays (resend refreshes the
			// same invitation rather than creating a new one)
			await expect(page.getByTestId('invitation-resend-confirm')).toBeVisible()
			await expect(row).toHaveCount(1)

			// cleanup
			await row.locator('[data-testid^="invitation-cancel-"]').click()
			await expect(invitationRow(page, recipient)).toHaveCount(0)
		})

		// The empty-state rendering is covered deterministically by the
		// invitation-status unit test (selectPendingInvitations → []); asserting
		// a globally-empty pending list over the shared seed DB is inherently
		// racy, so it is intentionally not duplicated here.
	})

	test.describe('when a regular member views the page', () => {
		test('should see pending invitations read-only with no invite or cancel controls', async ({
			page,
			browser,
		}) => {
			const recipient = `member-view-${Date.now()}@example.com`

			// GIVEN Alice (owner) creates a pending invite so there's a row to see
			await openInvitePanel(page)
			await sendInvite(page, recipient)
			await expect(invitationRow(page, recipient)).toBeVisible()

			// WHEN Carol (a plain member of taller) signs in fresh and opens members.
			// Empty storageState on purpose: the authed project injects Alice's
			// cookie by default, which would land Carol on the dashboard already
			// signed in as the owner.
			const carolContext = await browser.newContext({
				ignoreHTTPSErrors: true,
				baseURL: BASE_URL,
				storageState: { cookies: [], origins: [] },
			})
			const carol = await carolContext.newPage()
			await carol.goto('/login')
			await expect(carol.getByTestId('login-form')).toBeVisible()
			await carol.getByTestId('login-email').fill('colleague@taller.cat')
			await carol.getByTestId('login-password').fill('batuda-dev-2026')
			await carol.getByTestId('login-submit').click()
			await carol.waitForURL(/\/$/)
			await setActiveOrgBySlug(carol, 'taller')
			await carol.goto('/settings/organization/members', {
				waitUntil: 'networkidle',
			})

			// THEN she can see the pending invitation
			await expect(invitationRow(carol, recipient)).toBeVisible()
			// BUT there is no invite CTA and no cancel/resend/remove controls
			await expect(carol.getByTestId('invite-open')).toHaveCount(0)
			await expect(
				carol.locator('[data-testid^="invitation-cancel-"]'),
			).toHaveCount(0)
			await expect(
				carol.locator('[data-testid^="invitation-resend-"]'),
			).toHaveCount(0)
			await expect(
				carol.locator('[data-testid^="member-remove-"]'),
			).toHaveCount(0)
			await carolContext.close()

			// cleanup: Alice cancels the invite
			await invitationRow(page, recipient)
				.locator('[data-testid^="invitation-cancel-"]')
				.click()
			await expect(invitationRow(page, recipient)).toHaveCount(0)
		})
	})
})
