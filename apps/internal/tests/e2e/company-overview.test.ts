import { expect, test } from '@playwright/test'

import { closeAboutSection, openAboutSection } from './helpers/about-section'
import { setActiveOrgBySlug } from './helpers/set-active-org'

// Asserts the redesigned company-detail Overview tab — Slice 1 of the
// company-detail UX overhaul. The Overview replaces the flat 11-field
// Profile tab with a deal dashboard: Next action / Cadence / Upcoming
// at a glance; Open tasks + Timeline as the activity column; Research
// summary + About as the sidebar column.
//
// Selectors verified against:
//   apps/internal/src/components/companies/next-action-card.tsx
//     (company-next-action-card)
//   apps/internal/src/components/companies/cadence-card.tsx
//     (company-cadence-card)
//   apps/internal/src/components/companies/upcoming-meetings-card.tsx
//     (company-upcoming-meetings-card)
//   apps/internal/src/components/companies/open-tasks-card.tsx
//     (company-open-tasks-card)
//   apps/internal/src/components/companies/research-summary-card.tsx
//     (company-research-summary-card)
//   apps/internal/src/routes/companies/$slug.tsx
//     (company-overview-timeline; tab key='profile' label='Overview')
//   apps/internal/src/components/companies/about-section.tsx
//     (company-about-trigger, company-about-panel)

const COMPANY_SLUG = 'cal-pep-fonda'

test.describe('company-detail Overview tab', () => {
	test.beforeEach(async ({ page }) => {
		// Land at the dashboard first so the active-org is taller; the seed
		// puts cal-pep-fonda there. Then navigate to the company page.
		await page.goto('/', { waitUntil: 'commit' })
		await setActiveOrgBySlug(page, 'taller')
		await page.goto(`/companies/${COMPANY_SLUG}`)
		await expect(
			page.getByRole('heading', { level: 2, name: /cal pep/i }),
		).toBeVisible()
	})

	test.describe('when the company page loads without an explicit tab', () => {
		test('should render the Overview cards as the default tab', async ({
			page,
		}) => {
			// GIVEN a signed-in user navigates to /companies/cal-pep-fonda
			// AND no `tab` search param is set (stripSearchParams default
			//   in routes/companies/$slug.tsx:230 strips tab='profile')
			// WHEN the page finishes hydrating
			// THEN every Overview card is visible without a tab click
			//   [components/companies/next-action-card.tsx:23 — Card data-testid]
			await expect(page.getByTestId('company-next-action-card')).toBeVisible()
			//   [components/companies/cadence-card.tsx:48 — Card data-testid]
			await expect(page.getByTestId('company-cadence-card')).toBeVisible()
			//   [components/companies/upcoming-meetings-card.tsx:49 — Panel data-testid]
			await expect(
				page.getByTestId('company-upcoming-meetings-card'),
			).toBeVisible()
			//   [components/companies/open-tasks-card.tsx:38 — Card data-testid]
			await expect(page.getByTestId('company-open-tasks-card')).toBeVisible()
			//   [components/companies/research-summary-card.tsx:33 — Card data-testid]
			await expect(
				page.getByTestId('company-research-summary-card'),
			).toBeVisible()
			//   [routes/companies/$slug.tsx — OverviewTimeline data-testid]
			await expect(page.getByTestId('company-overview-timeline')).toBeVisible()

			// AND the Overview tab is the selected tab
			// [routes/companies/$slug.tsx — PriTabs.Tab value='profile' label='Overview']
			await expect(
				page.getByRole('tab', { name: 'Overview', selected: true }),
			).toBeVisible()
		})
	})

	test.describe('when the user looks for deal-driving signals', () => {
		test('should surface tasks, research and timeline on the Overview', async ({
			page,
		}) => {
			// GIVEN the page rendered the Overview cards
			// WHEN the user scans the Overview without clicking a tab
			// THEN the Open tasks card renders with either a list or its empty copy
			//   [components/companies/open-tasks-card.tsx:38, 44 — list/empty branch]
			const tasksCard = page.getByTestId('company-open-tasks-card')
			await expect(tasksCard).toBeVisible()
			// Either at least one task row OR the "No open tasks." empty line
			// is visible — both are acceptable Slice-1 outcomes since the
			// seeded fixtures vary across companies.
			await expect(
				tasksCard.locator('[data-testid^="company-open-task-"], p').first(),
			).toBeVisible()

			// AND the Research summary card renders
			//   [components/companies/research-summary-card.tsx:33, 53 — Run new button]
			const researchCard = page.getByTestId('company-research-summary-card')
			await expect(researchCard).toBeVisible()
			await expect(
				researchCard.getByTestId('company-research-summary-run-new'),
			).toBeVisible()

			// AND the Timeline panel is expanded by default
			//   [routes/companies/$slug.tsx — PriCollapsible.Root defaultOpen]
			const timeline = page.getByTestId('company-overview-timeline')
			await expect(timeline).toBeVisible()
			await expect(timeline.getByText('Show system events')).toBeVisible()
		})
	})

	test.describe('when the Overview shows the About section', () => {
		test('should show the eight editable fields grouped by concern', async ({
			page,
		}) => {
			// GIVEN the Overview as it renders, nothing clicked
			const panel = page.getByTestId('company-about-panel')

			// WHEN the user reads down the sidebar column
			// THEN the section is already open — whether this lead is qualified is
			// the question it answers, so it is not worth a click to find out.
			// Asserted here rather than through the helper, which tolerates either
			// state: this is the one place that holds the default to what it is.
			//   [components/companies/about-section.tsx — PriCollapsible.Root defaultOpen]
			await expect(panel).toBeVisible()

			// AND every grouped field label is reachable inside it
			//   Sales context (4)
			await expect(panel.getByText('Industry', { exact: true })).toBeVisible()
			await expect(panel.getByText('Country', { exact: true })).toBeVisible()
			await expect(panel.getByText('Location', { exact: true })).toBeVisible()
			await expect(panel.getByText('Size', { exact: true })).toBeVisible()
			//   Discovery (2)
			await expect(
				panel.getByText('Pain points', { exact: true }),
			).toBeVisible()
			await expect(
				panel.getByText('Current tools', { exact: true }),
			).toBeVisible()
			//   Tags & fit (2)
			await expect(panel.getByText('Tags', { exact: true })).toBeVisible()
			await expect(
				panel.getByText('Products fit', { exact: true }),
			).toBeVisible()
		})

		test('should hide the fields when shut but keep them where the browser can find them', async ({
			page,
		}) => {
			// GIVEN the About section open, as the Overview renders it
			await openAboutSection(page)

			// WHEN the user shuts it
			const panel = await closeAboutSection(page)

			// THEN the fields go off screen but stay on the page, marked so the
			// browser's own find can reach them and open the section back up.
			// Checking the mark as well as the hiding: hidden on its own would pass
			// just as well if the panel had been dropped from the page. The mark
			// sits on the parent, because the test id is on the inner body.
			await expect(panel).toBeHidden()
			await expect(panel.locator('xpath=..')).toHaveAttribute(
				'hidden',
				'until-found',
			)
		})
	})
})
