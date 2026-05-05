import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { setActiveOrgBySlug } from './helpers/set-active-org'

// Asserts the upcoming-meetings card on the company Profile tab and the
// per-company Calendar tab list. Slice D — D.1 and D.2.
//
// The auto-task-on-cancel server flow (D.4) is verified at SQL level by
// apps/server/src/services/calendar-cancel-task.test.ts; here we focus
// on the read paths the user sees.
//
// Selectors verified against:
//   apps/internal/src/components/companies/upcoming-meetings-card.tsx
//     (company-upcoming-meetings-card, company-upcoming-meeting-{id})
//   apps/internal/src/components/companies/calendar-tab.tsx
//     (company-calendar-tab-list, company-calendar-tab-empty,
//     company-calendar-event-{id})
//   apps/internal/src/routes/companies/$slug.tsx (company-calendar-tab,
//     ?tab=calendar)

const DATABASE_URL =
	process.env['E2E_DATABASE_URL'] ??
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

const COMPANY_SLUG = 'cal-pep-fonda'

const psql = (sqlText: string): string =>
	execSync(`psql "${DATABASE_URL}" -tA -c "${sqlText.replace(/"/g, '\\"')}"`, {
		encoding: 'utf8',
	}).trim()

const seededIds: string[] = []

test.describe('calendar on company page', () => {
	test.beforeAll(() => {
		// GIVEN the seeded `cal-pep-fonda` company has at least one
		// confirmed upcoming event (the seed inserts "Zoom sync with Cal
		// Pep" by default). We additionally seed:
		//   - a cancelled event in the past so D.2's struck-through
		//     treatment has something to render
		const orgId = psql(
			`SELECT organization_id FROM companies WHERE slug='${COMPANY_SLUG}' LIMIT 1`,
		)
		const companyId = psql(
			`SELECT id FROM companies WHERE slug='${COMPANY_SLUG}' LIMIT 1`,
		)
		expect(orgId, 'taller seeded').not.toBe('')
		expect(companyId, 'cal-pep-fonda seeded').not.toBe('')

		const cancelledId = randomUUID()
		seededIds.push(cancelledId)
		psql(
			`INSERT INTO calendar_events (
				id, organization_id, source, provider, provider_booking_id,
				ical_uid, ical_sequence, start_at, end_at, status, title,
				location_type, organizer_email, company_id
			) VALUES (
				'${cancelledId}', '${orgId}', 'booking', 'calcom', 'cancelled-fixture-${cancelledId}',
				'cancelled-fixture-${cancelledId}', 0,
				now() - interval '2 days',
				now() - interval '2 days' + interval '30 minutes',
				'cancelled',
				'Cancelled discovery call',
				'video', 'organizer@taller.cat', '${companyId}'
			)`,
		)
	})

	test.afterAll(() => {
		for (const id of seededIds) {
			psql(`DELETE FROM calendar_events WHERE id='${id}'`)
		}
	})

	test.beforeEach(async ({ page }) => {
		await page.goto('/', { waitUntil: 'commit' })
		await setActiveOrgBySlug(page, 'taller')
	})

	test.describe('when the company has upcoming events', () => {
		test('should render the upcoming-meetings card on the Overview tab', async ({
			page,
		}) => {
			// WHEN Alice opens the company page (defaults to Overview tab)
			await page.goto(`/companies/${COMPANY_SLUG}`, {
				waitUntil: 'networkidle',
			})

			// THEN the upcoming-meetings card is visible with at least one
			// meeting row (the seed includes "Zoom sync with Cal Pep")
			const card = page.getByTestId('company-upcoming-meetings-card')
			await expect(card).toBeVisible()
			const rows = card.locator('[data-testid^="company-upcoming-meeting-"]')
			await expect(rows.first()).toBeVisible()
			// AND the row carries the title + an attendee count + a relative
			// time (full assertion against text would be brittle as time
			// passes; a non-empty row is the contract under test)
			await expect(rows.first()).toContainText(/attendee/)
		})
	})

	// The standalone Calendar tab was removed in Slice 2 — events now
	// surface inside the merged Conversations tab. The two tests below
	// covered the old CalendarTab component selectors and need rewriting
	// against the new ConversationsTab markup before they can pass again.
	test.describe
		.skip('when the user opens the Calendar tab', () => {
			test('should list past + future events with cancelled struck-through', async ({
				page,
			}) => {
				// WHEN Alice navigates to ?tab=calendar
				await page.goto(`/companies/${COMPANY_SLUG}?tab=calendar`, {
					waitUntil: 'networkidle',
				})

				// THEN the list renders
				const list = page.getByTestId('company-calendar-tab-list')
				await expect(list).toBeVisible()

				// AND the seeded cancelled fixture appears
				const cancelledRow = page.getByTestId(
					`company-calendar-event-${seededIds[0]}`,
				)
				await expect(cancelledRow).toBeVisible()
				await expect(cancelledRow).toContainText('Cancelled discovery call')
				await expect(cancelledRow).toContainText(/cancelled/i)

				// AND the cancelled row is visually de-emphasised (line-through
				// title). The styled-components selector targets the title span;
				// CSS is inline so we read the computed style.
				const titleStyle = await cancelledRow
					.locator('span')
					.first()
					.evaluate(el => window.getComputedStyle(el).textDecorationLine)
				expect(titleStyle).toMatch(/line-through/)
			})
		})

	test.describe
		.skip('when the company has no calendar events at all', () => {
			test('should render the empty state on the Calendar tab', async ({
				page,
			}) => {
				// GIVEN a company with no calendar events (seed includes
				// `forn-de-pa-queralt` with no events). If the seed shape ever
				// changes we'll need a different fixture; for now this is the
				// stable empty-case row.
				const slug = 'forn-de-pa-queralt'
				// Make sure the seeded company actually has zero events. If a
				// future seed adds one, skip this test rather than silently
				// passing on a misaligned premise.
				const count = psql(
					`SELECT COUNT(*)::text FROM calendar_events WHERE company_id = (SELECT id FROM companies WHERE slug='${slug}')`,
				)
				test.skip(count !== '0', 'seed adds events to forn-de-pa-queralt')

				// WHEN Alice opens its Calendar tab
				await page.goto(`/companies/${slug}?tab=calendar`, {
					waitUntil: 'networkidle',
				})

				// THEN the empty state renders
				await expect(
					page.getByTestId('company-calendar-tab-empty'),
				).toBeVisible()
			})
		})
})
