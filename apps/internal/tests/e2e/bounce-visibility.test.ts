import { execSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import { setActiveOrgBySlug } from './helpers/set-active-org'

// Bounce visibility on the contact page. Slice 6 wires the suppression
// banner (and inline badge) on company → Contacts when a contact's
// `email_status` is bounced or complained.
//
// We seed the bounced state directly via psql instead of driving the
// mail-worker's DSN parser end-to-end — the worker is a separate process
// that watches real IMAP, not the dev .dev-inbox/, so a true round-trip
// here would require a maildev container. The DSN→DB path is unit-tested
// in apps/mail-worker/src/bounces.test.ts; this spec asserts the UI
// renders the resulting state correctly.
//
// Selectors verified against:
//   apps/internal/src/routes/companies/$slug.tsx (suppression banner +
//   badge + clear action; testids: contact-suppression-{badge,banner,clear}-{id})

const DATABASE_URL =
	process.env['E2E_DATABASE_URL'] ??
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

const TARGET_EMAIL = 'pep@calpepfonda.cat'
const TARGET_REASON = '550 5.1.1 mailbox not found (e2e fixture)'
const COMPANY_SLUG = 'cal-pep-fonda'

const psql = (sqlText: string): string =>
	execSync(`psql "${DATABASE_URL}" -tA -c "${sqlText.replace(/"/g, '\\"')}"`, {
		encoding: 'utf8',
	}).trim()

test.describe('contact suppression banner', () => {
	test.beforeEach(async ({ page }) => {
		// GIVEN Alice's session is active and pointed at Taller (the seed
		// puts Pep Casals there).
		await page.goto('/', { waitUntil: 'commit' })
		await setActiveOrgBySlug(page, 'taller')

		// AND the seeded Pep Casals row is forced to bounced state.
		psql(
			`UPDATE contacts SET email_status='bounced', email_status_reason='${TARGET_REASON}', email_status_updated_at=now() WHERE email='${TARGET_EMAIL}'`,
		)
	})

	test.afterEach(() => {
		// Revert the seeded bounce so the row is reusable across runs and
		// other suites that read the same contact don't see leftover state.
		psql(
			`UPDATE contacts SET email_status='unknown', email_status_reason=NULL, email_status_updated_at=now(), email_soft_bounce_count=0 WHERE email='${TARGET_EMAIL}'`,
		)
	})

	test('should render the suppression banner with the upstream reason', async ({
		page,
	}) => {
		// WHEN the user opens the bounced contact's company page → Contacts
		await page.goto(`/companies/${COMPANY_SLUG}`, {
			waitUntil: 'networkidle',
		})
		await page.getByRole('tab', { name: /Contacts/i }).click()

		// THEN the banner should be visible carrying the bounce reason.
		const banner = page.getByTestId(/^contact-suppression-banner-/).first()
		await expect(banner).toBeVisible()
		await expect(banner).toContainText(TARGET_REASON)

		// AND the inline badge next to the contact name should also render.
		await expect(
			page.getByTestId(/^contact-suppression-badge-/).first(),
		).toBeVisible()
	})

	test('should clear the suppression when the user clicks Clear', async ({
		page,
	}) => {
		// GIVEN the page is open and the banner is visible
		await page.goto(`/companies/${COMPANY_SLUG}`, {
			waitUntil: 'networkidle',
		})
		await page.getByRole('tab', { name: /Contacts/i }).click()
		const banner = page.getByTestId(/^contact-suppression-banner-/).first()
		await expect(banner).toBeVisible()

		// WHEN the user clicks the Clear action on the banner
		await page
			.getByTestId(/^contact-suppression-clear-/)
			.first()
			.click()

		// THEN the banner should disappear (the contact list re-fetches
		// after the clear-suppression mutation resolves successfully).
		await expect(
			page.getByTestId(/^contact-suppression-banner-/).first(),
		).toBeHidden({ timeout: 10_000 })

		// AND the DB row should reflect email_status='unknown' (the route
		// resets it to that value, not to 'valid').
		const row = psql(
			`SELECT email_status FROM contacts WHERE email='${TARGET_EMAIL}'`,
		)
		expect(row).toBe('unknown')
	})
})
