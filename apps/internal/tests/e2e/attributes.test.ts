import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { openAboutSection } from './helpers/about-section'
import { DATABASE_URL } from './helpers/database-url'
import { waitForInteractive } from './helpers/hydration'
import { chooseSelectOption } from './helpers/pri-select'
import { setActiveOrgBySlug } from './helpers/set-active-org'

// The attributes an organisation declares on its research stacks, and where
// they show up: the settings section that declares them, the company page that
// holds their values, the list filter that narrows by them, and the run pages
// that show what a research run found.
//
// The seed declares six attributes on Taller's "default" stack (site_count is a
// number in sites, takes_online_bookings a yes/no, fit a choice, founded_on a
// date, current_tools text, uses_whatsapp retired) and one more on
// "hospitality-es". A research run's findings are seeded through psql, as the
// research-findings spec does, so no model credits burn.
//
// Selectors verified against:
//   apps/internal/src/components/instructions/attribute-section.tsx
//     (org-attributes, org-attributes-add-{stackId}, org-attribute-{stackId}-{key},
//      org-attribute-edit|active|delete-{stackId}-{key}, org-attribute-delete-confirm-button)
//   apps/internal/src/components/instructions/attribute-dialog.tsx
//     (attribute-dialog, attribute-key|label|kind|unit|submit|error, attribute-kind-option-{kind})
//   apps/internal/src/components/instructions/stack-editor.tsx (stack-research-fills-attributes)
//   apps/internal/src/components/companies/about-section.tsx (company-attributes, company-attributes-count)
//   apps/internal/src/components/companies/attribute-field.tsx
//     (company-attribute-{key}, company-attribute-trail-{key})
//   apps/internal/src/components/companies/attribute-filter.tsx
//     (companies-filter-attribute, companies-filter-attribute-op, companies-filter-attribute-value,
//      companies-filter-attribute-clear)
//   apps/internal/src/components/research/findings/attributes-block.tsx
//     (research-attributes, research-attribute-{key})
//   apps/internal/src/components/research/review/proposed-updates-review.tsx
//     (research-review-attributes)

const psql = (sqlText: string): string =>
	execSync(`psql "${DATABASE_URL}" -tA -c "${sqlText.replace(/"/g, '\\"')}"`, {
		encoding: 'utf8',
	}).trim()

const COMPANY_SLUG = 'cal-pep-fonda'

test.beforeEach(async ({ page }) => {
	await page.goto('/', { waitUntil: 'commit' })
	await setActiveOrgBySlug(page, 'taller')
})

test.describe('attributes', () => {
	test.describe('when an admin declares an attribute on a campaign stack', () => {
		test('should list it, let it be retired, and let it be deleted', async ({
			page,
		}) => {
			const key = `e2e_locations_${Date.now()}`
			await page.goto('/settings/organization/templates', {
				waitUntil: 'networkidle',
			})

			// GIVEN the attributes section with the seeded declarations on screen
			const section = page.getByTestId('org-attributes')
			await expect(section).toBeVisible()
			const addButton = section
				.locator('[data-testid^="org-attributes-add-"]')
				.first()
			await expect(addButton).toBeVisible()
			const stackId = (await addButton.getAttribute('data-testid'))?.replace(
				'org-attributes-add-',
				'',
			)
			const row = page.getByTestId(`org-attribute-${stackId}-${key}`)

			// WHEN a number attribute with a unit is declared through the dialog
			await addButton.click()
			await expect(page.getByTestId('attribute-dialog')).toBeVisible()
			await page.getByTestId('attribute-key').fill(key)
			await page.getByTestId('attribute-label').fill('Locations')
			await chooseSelectOption(
				page,
				'attribute-kind',
				'attribute-kind-option-number',
			)
			await page.getByTestId('attribute-unit').fill('locations')
			await page.getByTestId('attribute-submit').click()

			// THEN it joins its stack's list as a number with its unit
			await expect(page.getByTestId('attribute-dialog')).toBeHidden()
			await expect(row).toBeVisible()
			await expect(row).toContainText('Locations')
			await expect(row).toContainText('Number')
			await expect(row).toContainText('locations')

			// AND retiring it tags the row without removing it
			await page.getByTestId(`org-attribute-active-${stackId}-${key}`).click()
			await expect(row).toContainText(/inactive/i)

			// AND deleting it, after the confirm, takes the row away
			await page.getByTestId(`org-attribute-delete-${stackId}-${key}`).click()
			await page.getByTestId('org-attribute-delete-confirm-button').click()
			await expect(row).toHaveCount(0)
		})

		test('should refuse a key another stack declares with a different kind', async ({
			page,
		}) => {
			await page.goto('/settings/organization/templates', {
				waitUntil: 'networkidle',
			})
			const section = page.getByTestId('org-attributes')
			const addButton = section
				.locator('[data-testid^="org-attributes-add-"]')
				.last()
			await expect(addButton).toBeVisible()

			// GIVEN the dialog on the second stack
			await addButton.click()
			await expect(page.getByTestId('attribute-dialog')).toBeVisible()

			// WHEN the seeded number key is declared again as text
			await page.getByTestId('attribute-key').fill('site_count')
			await page.getByTestId('attribute-label').fill('Sites again')
			await page.getByTestId('attribute-submit').click()

			// THEN the server's refusal is worded in the banner, not beside a field,
			// and the dialog stays open with the draft
			await expect(page.getByTestId('attribute-banner')).toContainText(
				'Another stack already declares this key',
			)
			await expect(page.getByTestId('attribute-dialog')).toBeVisible()
			await expect(page.getByTestId('attribute-key')).toHaveValue('site_count')
		})

		test('should keep the research-fills switch on the stack editor', async ({
			page,
		}) => {
			await page.goto('/settings/organization/templates', {
				waitUntil: 'networkidle',
			})

			// GIVEN the editor of the first org research stack
			await page
				.getByTestId('stack-row')
				.first()
				.getByRole('button', { name: /^Edit / })
				.click()
			await expect(page.getByTestId('stack-editor')).toBeVisible()
			const checkbox = page.getByTestId('stack-research-fills-attributes')
			await expect(checkbox).toBeVisible()
			const wasOn = (await checkbox.getAttribute('aria-checked')) === 'true'

			// WHEN the switch is flipped and the stack saved
			await checkbox.click()
			await page.getByTestId('stack-save').click()
			await expect(page.getByTestId('stack-editor')).toBeHidden()

			// THEN reopening the editor shows the new state
			await page
				.getByTestId('stack-row')
				.first()
				.getByRole('button', { name: /^Edit / })
				.click()
			await expect(
				page.getByTestId('stack-research-fills-attributes'),
			).toHaveAttribute('aria-checked', wasOn ? 'false' : 'true')

			// Put it back so the seeded arrangement survives a second run.
			await page.getByTestId('stack-research-fills-attributes').click()
			await page.getByTestId('stack-save').click()
			await expect(page.getByTestId('stack-editor')).toBeHidden()
		})
	})

	test.describe('when a company page shows its attributes', () => {
		const runId = randomUUID()
		const companyId = () =>
			psql(`select id from companies where slug='${COMPANY_SLUG}'`)

		test.beforeEach(() => {
			// A value a research run read off a page, with the run it came from, so
			// the trail under it has something to point at.
			const orgId = psql(`select id from organization where slug='taller'`)
			const userId = psql(
				`select id from "user" where email='admin@taller.cat'`,
			)
			psql(
				`insert into research_runs (id, organization_id, kind, query, mode, schema_name, status, findings, created_by, completed_at) values ('${runId}', '${orgId}', 'leaf', 'Cal Pep Fonda', 'deep', 'company_enrichment_v1', 'succeeded', '{}'::jsonb, '${userId}', now())`,
			)
			psql(
				`update companies set attributes = attributes || '{"takes_online_bookings": {"value": false, "source_url": "https://calpepfonda.cat/reserves", "quote": "Reserves: truqueu-nos al 938 123 456", "as_of": "2026-06-01", "research_id": "${runId}", "set_by": "research"}}'::jsonb where id='${companyId()}'`,
			)
		})

		test.afterEach(() => {
			psql(
				`update companies set attributes = attributes || '{"takes_online_bookings": {"value": false, "set_by": "client"}, "site_count": {"value": 1, "set_by": "client"}}'::jsonb where id='${companyId()}'`,
			)
			psql(`delete from research_runs where id='${runId}'`)
		})

		test('should show the declared attributes, the trail of a research value, and take an edit', async ({
			page,
		}) => {
			// GIVEN the company page with its About section open
			await page.goto(`/companies/${COMPANY_SLUG}`)
			await expect(
				page.getByRole('heading', { level: 2, name: /cal pep/i }),
			).toBeVisible()
			await openAboutSection(page)
			const group = page.getByTestId('company-attributes')
			await expect(group).toBeVisible()
			// The rows edit only once React holds the page; a click on the server's
			// HTML lands on nothing.
			await waitForInteractive(page, 'company-attributes')

			// THEN the research-set value carries where it came from
			const trail = page.getByTestId(
				'company-attribute-trail-takes_online_bookings',
			)
			await expect(trail).toBeVisible()
			await expect(trail).toContainText('calpepfonda.cat')
			await expect(trail).toContainText('Reserves: truqueu-nos')
			await expect(trail.getByRole('link', { name: 'run' })).toHaveAttribute(
				'href',
				`/research/${runId}`,
			)

			// WHEN the number of sites is edited
			const sites = page.getByTestId('company-attribute-site_count')
			await sites.getByRole('button', { name: /edit sites/i }).click()
			await sites.getByRole('textbox', { name: 'Sites' }).fill('3')
			await page.keyboard.press('Enter')

			// THEN the row shows the new number with its unit, and the row stores it
			await expect(sites).toContainText('3 sites')
			await expect
				.poll(() =>
					psql(
						`select attributes->'site_count'->>'value' from companies where id='${companyId()}'`,
					),
				)
				.toBe('3')
		})
	})

	test.describe('when the list is narrowed by an attribute', () => {
		test('should filter, mirror on the board, and survive a hand-typed address', async ({
			page,
		}) => {
			// GIVEN the companies list with nothing filtered
			await page.goto('/companies', { waitUntil: 'networkidle' })
			const announcement = page.getByTestId('companies-count-announcement')
			await expect(announcement).toContainText(/compan/i)
			await expect(announcement).not.toContainText('with filters applied')

			// WHEN Sites at least 2 is applied
			await chooseSelectOption(
				page,
				'companies-filter-attribute',
				'companies-filter-attribute-option-site_count',
			)
			await chooseSelectOption(
				page,
				'companies-filter-attribute-op',
				'companies-filter-attribute-op-option-gte',
			)
			await page.getByTestId('companies-filter-attribute-value').fill('2')
			await page.keyboard.press('Enter')

			// THEN the address carries the three parts and the count is announced again
			await expect(page).toHaveURL(/attributeKey=site_count/)
			await expect(page).toHaveURL(/attributeOp=gte/)
			await expect(page).toHaveURL(/attributeValue=/)
			await expect(announcement).toContainText('with filters applied')

			// AND the board keeps the same filter and links back to the list with it
			await page.goto(
				'/companies/board?attributeKey=site_count&attributeOp=gte&attributeValue=2',
			)
			await expect(page).toHaveURL(/companies\/board/)
			await expect(
				page.locator('a[href*="attributeKey=site_count"]').first(),
			).toHaveAttribute('href', /attributeOp=gte/)

			// AND a yes/no, which the address hands over as a bare `false`, comes
			// through the board and back into the link to the list
			await page.goto(
				'/companies/board?attributeKey=takes_online_bookings&attributeOp=eq&attributeValue=false',
			)
			await expect(
				page.locator('a[href*="attributeKey=takes_online_bookings"]').first(),
			).toHaveAttribute('href', /attributeValue=false/)

			// AND an address typed by hand, digits unquoted, still narrows the list
			await page.goto(
				'/companies?attributeKey=site_count&attributeOp=gte&attributeValue=2',
				{ waitUntil: 'networkidle' },
			)
			await expect(page.getByText('Something went wrong!')).toHaveCount(0)
			await expect(
				page.getByTestId('companies-filter-attribute-op'),
			).toContainText(/at least/i)
			await expect(
				page.getByTestId('companies-filter-attribute-value'),
			).toHaveValue('2')

			// AND clearing the control drops all three parts
			await page.getByTestId('companies-filter-attribute-clear').click()
			await expect(page).not.toHaveURL(/attributeKey/)
		})

		test('should carry the filter through a saved view', async ({ page }) => {
			const viewName = `e2e-attr-${Date.now()}`
			// GIVEN the list narrowed by an attribute
			await page.goto(
				'/companies?attributeKey=site_count&attributeOp=gte&attributeValue=%222%22',
				{ waitUntil: 'networkidle' },
			)
			await expect(page).toHaveURL(/attributeKey=site_count/)

			// WHEN the view is saved and the list is opened clean, then the view applied
			page.once('dialog', dialog => void dialog.accept(viewName))
			await page.getByTestId('companies-save-view').click()
			await expect(
				page.getByTestId(`companies-saved-view-${viewName}`),
			).toBeVisible()
			await page.goto('/companies', { waitUntil: 'networkidle' })
			await expect(page).not.toHaveURL(/attributeKey/)
			await page.getByTestId(`companies-saved-view-${viewName}`).click()

			// THEN the attribute filter is back in the address
			await expect(page).toHaveURL(/attributeKey=site_count/)
			await expect(page).toHaveURL(/attributeOp=gte/)
		})
	})

	test.describe('when a research run found attribute values', () => {
		const runId = randomUUID()

		test.beforeEach(() => {
			const orgId = psql(`select id from organization where slug='taller'`)
			const userId = psql(
				`select id from "user" where email='admin@taller.cat'`,
			)
			const companyId = psql(
				`select id from companies where slug='${COMPANY_SLUG}'`,
			)
			const findings = JSON.stringify({
				enrichment: {
					industry: {
						value: 'Restaurant',
						source_id: 'https://calpepfonda.cat',
					},
				},
				attributes: {
					site_count: {
						value: 3,
						source_id: 'https://calpepfonda.cat/locals',
						quote: 'Tres locals a Vilanova',
						confidence: null,
					},
					takes_online_bookings: {
						value: false,
						source_id: 'https://calpepfonda.cat/reserves',
						quote: 'Reserves: truqueu-nos',
						confidence: null,
					},
				},
				proposed_updates: [
					{
						id: randomUUID(),
						status: 'pending',
						operation: 'update',
						subject_table: 'companies',
						subject_id: companyId,
						expected_version: 0,
						reason: 'The site names the trade.',
						fields: { industry: 'Restaurant' },
						citations: [{ source_id: 'https://calpepfonda.cat' }],
					},
				],
			}).replace(/'/g, "''")
			const context = JSON.stringify({
				subjects: [{ table: 'companies', id: companyId }],
			})
			psql(
				`insert into research_runs (id, organization_id, created_by, kind, query, mode, schema_name, status, phase, findings, context, completed_at, started_at) values ('${runId}', '${orgId}', '${userId}', 'leaf', 'Cal Pep Fonda', 'deep', 'company_enrichment_v1', 'succeeded', 3, '${findings}'::jsonb, '${context}'::jsonb, now(), now())`,
			)
		})

		test.afterEach(() => {
			psql(`delete from research_runs where id='${runId}'`)
		})

		test('should show them on the run page and on the change it lands with', async ({
			page,
		}) => {
			// GIVEN the run page
			await page.goto(`/research/${runId}`, { waitUntil: 'networkidle' })
			await waitForInteractive(page, 'research-review')

			// THEN the findings carry an attributes block, labelled and with units
			const block = page.getByTestId('research-attributes').first()
			await expect(block).toBeVisible()
			await expect(
				page.getByTestId('research-attribute-site_count').first(),
			).toContainText('3 sites')
			await expect(
				page.getByTestId('research-attribute-takes_online_bookings').first(),
			).toContainText('No')

			// AND the pending change about the company says the attributes land with it
			await expect(page.getByTestId('research-review-attributes')).toBeVisible()
			await expect(
				page.getByTestId('research-review-attributes'),
			).toContainText('Tres locals a Vilanova')
		})
	})
})
