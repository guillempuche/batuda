import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { DATABASE_URL } from './helpers/database-url'
import { setActiveOrgBySlug } from './helpers/set-active-org'

// A run's findings are the research schema filled in by the model, and they
// reach the browser under the very names that schema defines. Nothing else
// checks that a findings view actually renders those names — a mismatch shows
// up as a blank card, never as an error — so this drives two schemas end to end
// against seeded findings.
//
// Seeded via psql rather than by driving the engine, so no model credits burn.
//
// Selectors verified against:
//   apps/internal/src/components/research/run-detail.tsx (research-run-findings)
//   apps/internal/src/components/research/findings/company-enrichment-view.tsx
//     (research-enrichment, research-fit)
//   apps/internal/src/components/research/findings/competitor-scan-view.tsx
//     (research-market-summary)

const psql = (sqlText: string): string =>
	execSync(`psql "${DATABASE_URL}" -tA -c "${sqlText.replace(/"/g, '\\"')}"`, {
		encoding: 'utf8',
	}).trim()

const ENRICHMENT_RUN_ID = randomUUID()
const SCAN_RUN_ID = randomUUID()

// Each enrichment field pairs its value with the source backing it, exactly as
// the company-enrichment schema defines.
const sourced = (value: string) => ({ value, source_id: 'src-fixture-1' })

const ENRICHMENT_FINDINGS = {
	enrichment: {
		industry: sourced('Restaurant'),
		size_range: sourced('11-50'),
		current_tools: sourced('Paper reservations book'),
	},
	verdict: 'strong_fit',
	verdict_rationale: 'Busy weekend service with no booking software.',
	fit_checks: [
		{
			criterion: 'Takes bookings',
			result: 'pass',
			evidence_quote: 'Reserva la teva taula trucant al restaurant',
			source_id: 'src-fixture-1',
		},
	],
}

const SCAN_FINDINGS = {
	market_summary: {
		total_competitors_found: 3,
		market_maturity: 'fragmented',
		key_differentiators: ['Local sourcing', 'Set-menu pricing'],
		citations: [{ source_id: 'src-fixture-1' }],
	},
	competitors: [
		{
			// Deliberately the bare address, with no source beside it: this is a run
			// stored before a scanned website carried the page it came from. Those rows
			// are never rewritten, so the view has to keep rendering them.
			name: 'Can Ticus',
			website: 'https://canticus.example',
			citations: [{ source_id: 'src-fixture-1' }],
		},
	],
}

const seedRun = (id: string, schemaName: string, findings: unknown): void => {
	const orgId = psql(
		`SELECT organization_id FROM companies WHERE slug='cal-pep-fonda' LIMIT 1`,
	)
	const userId = psql(
		`SELECT id FROM "user" WHERE email='admin@taller.cat' LIMIT 1`,
	)
	expect(orgId, 'taller seeded').not.toBe('')
	expect(userId, 'alice seeded').not.toBe('')
	const json = JSON.stringify(findings).replace(/'/g, "''")
	psql(
		`INSERT INTO research_runs (id, organization_id, kind, query, mode, schema_name, status, findings, created_by, completed_at) VALUES ('${id}', '${orgId}', 'leaf', 'Cal Pep Fonda', 'deep', '${schemaName}', 'succeeded', '${json}'::jsonb, '${userId}', now())`,
	)
}

test.beforeAll(() => {
	seedRun(ENRICHMENT_RUN_ID, 'company_enrichment_v1', ENRICHMENT_FINDINGS)
	seedRun(SCAN_RUN_ID, 'competitor_scan_v1', SCAN_FINDINGS)
})

test.afterAll(() => {
	psql(
		`DELETE FROM research_runs WHERE id IN ('${ENRICHMENT_RUN_ID}', '${SCAN_RUN_ID}')`,
	)
	// Clear the fit state so a rerun starts from the seeded company again.
	psql(
		`UPDATE companies SET fit_verdict=NULL, fit_checks=NULL WHERE slug='cal-pep-fonda'`,
	)
})

test.beforeEach(async ({ page }) => {
	await page.goto('/', { waitUntil: 'commit' })
	await setActiveOrgBySlug(page, 'taller')
})

test.describe('research findings', () => {
	test.describe('when a run enriched a company', () => {
		test('should show the values it found and the evidence behind them @smoke', async ({
			page,
		}) => {
			// GIVEN a finished enrichment run stored against the demo company
			// WHEN its detail page is opened
			await page.goto(`/research/${ENRICHMENT_RUN_ID}`, {
				waitUntil: 'networkidle',
			})

			// THEN the multi-word values render rather than reading as blank
			const enrichment = page.getByTestId('research-enrichment')
			await expect(enrichment).toBeVisible()
			await expect(enrichment).toContainText('11-50')
			await expect(enrichment).toContainText('Paper reservations book')

			// AND the fit verdict carries the quote that decided it
			const fit = page.getByTestId('research-fit')
			await expect(fit).toBeVisible()
			await expect(fit).toContainText('Takes bookings')
			await expect(fit).toContainText('Reserva la teva taula')
		})
	})

	test.describe('when a run judged whether a company fits', () => {
		test('should show each criterion with the quote behind it', async ({
			page,
		}) => {
			// GIVEN the applied fit checks stored on the company, as a run wrote them
			psql(
				`UPDATE companies SET fit_verdict='strong_fit', fit_checks='${JSON.stringify(
					ENRICHMENT_FINDINGS.fit_checks,
				).replace(/'/g, "''")}'::jsonb WHERE slug='cal-pep-fonda'`,
			)

			// WHEN the company page is opened
			await page.goto('/companies/cal-pep-fonda', { waitUntil: 'networkidle' })

			// THEN the fit panel is already open, because a company that has been
			// judged shows its reasoning unasked — clicking the trigger would close
			// it
			const panel = page.getByTestId('company-fit-panel')
			await expect(panel).toBeVisible()
			// AND the criterion and its evidence both render — the quote is the
			// part that silently disappears if the stored names are read wrongly
			await expect(panel).toContainText('Takes bookings')
			await expect(panel).toContainText('Reserva la teva taula')
		})
	})

	test.describe('when a run scanned the competition', () => {
		test('should show the market summary card', async ({ page }) => {
			// GIVEN a finished competitor scan
			// WHEN its detail page is opened
			await page.goto(`/research/${SCAN_RUN_ID}`, { waitUntil: 'networkidle' })

			// THEN the summary renders — it disappears wholesale if its stored
			// names are read under any other spelling
			const summary = page.getByTestId('research-market-summary')
			await expect(summary).toBeVisible()
			await expect(summary).toContainText('fragmented')
			await expect(summary).toContainText('Local sourcing')
		})

		test('should show a competitor stored before websites carried a source', async ({
			page,
		}) => {
			// GIVEN the same scan, whose competitor holds a bare address
			// WHEN its detail page is opened
			await page.goto(`/research/${SCAN_RUN_ID}`, { waitUntil: 'networkidle' })

			// THEN the address still renders as a link — a stored run is never
			// rewritten, so the older shape has to keep working
			await expect(
				page.getByRole('link', { name: 'https://canticus.example' }),
			).toBeVisible()
		})
	})
})
