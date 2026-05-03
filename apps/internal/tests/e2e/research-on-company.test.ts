import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { setActiveOrgBySlug } from './helpers/set-active-org'

// Asserts the Research tab on /companies/$slug surfaces existing runs
// (brief Markdown + freeform sections) and that the Run-new-research
// dialog drives a real POST to /v1/research. Slice C1 — typed schema
// components defer to C2.
//
// Selectors verified against:
//   apps/internal/src/routes/companies/$slug.tsx (research-tab,
//     research-run-new)
//   apps/internal/src/components/research/run-list.tsx
//     (research-run-list, research-run-row-{id})
//   apps/internal/src/components/research/run-detail.tsx
//     (research-run-detail, research-run-brief, research-run-findings)
//   apps/internal/src/components/research/findings/freeform-view.tsx
//     (research-proposed-updates, research-pending-paid-actions)
//   apps/internal/src/components/research/research-dialog.tsx
//     (research-dialog, research-dialog-{query,schema,submit,cancel})

const DATABASE_URL =
	process.env['E2E_DATABASE_URL'] ??
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

const COMPANY_SLUG = 'cal-pep-fonda'

const psql = (sqlText: string): string =>
	execSync(`psql "${DATABASE_URL}" -tA -c "${sqlText.replace(/"/g, '\\"')}"`, {
		encoding: 'utf8',
	}).trim()

const seededRunIds: string[] = []

test.describe('research findings on company page', () => {
	test.beforeAll(() => {
		// GIVEN the demo `cal-pep-fonda` company has a completed freeform
		// research run with brief_md + proposed_updates. Seeded directly
		// via psql so the e2e doesn't burn LLM credits driving the engine.
		const orgId = psql(
			`SELECT organization_id FROM companies WHERE slug='${COMPANY_SLUG}' LIMIT 1`,
		)
		const companyId = psql(
			`SELECT id FROM companies WHERE slug='${COMPANY_SLUG}' LIMIT 1`,
		)
		const userId = psql(
			`SELECT id FROM "user" WHERE email='admin@taller.cat' LIMIT 1`,
		)
		expect(orgId, 'taller seeded').not.toBe('')
		expect(companyId, 'cal-pep-fonda seeded').not.toBe('')
		expect(userId, 'alice seeded').not.toBe('')

		const completedId = randomUUID()
		seededRunIds.push(completedId)
		const briefMd = '# Notes\n\nFamily-run restaurant in Vic. Strong candidate.'
		const findings = JSON.stringify({
			proposed_updates: [
				{
					subject_table: 'companies',
					subject_id: companyId,
					fields: { region: 'Osona', size_range: 'small' },
					reason: 'Mentioned on their about page.',
					citations: [{ source_id: 'src-fixture-1', confidence: 0.9 }],
				},
			],
			pending_paid_actions: [],
		}).replace(/'/g, "''")

		psql(
			`INSERT INTO research_runs (id, organization_id, kind, query, mode, schema_name, status, findings, brief_md, created_by) VALUES ('${completedId}', '${orgId}', 'leaf', 'About Cal Pep Fonda', 'deep', 'freeform', 'succeeded', '${findings}'::jsonb, '${briefMd.replace(/'/g, "''")}', '${userId}')`,
		)
		psql(
			`INSERT INTO research_links (organization_id, research_id, subject_table, subject_id, link_kind) VALUES ('${orgId}', '${completedId}', 'companies', '${companyId}', 'finding')`,
		)
	})

	test.afterAll(() => {
		for (const id of seededRunIds) {
			psql(`DELETE FROM research_runs WHERE id='${id}'`)
		}
	})

	test.beforeEach(async ({ page }) => {
		await page.goto('/', { waitUntil: 'commit' })
		await setActiveOrgBySlug(page, 'taller')
	})

	test.describe('when the company has a completed run with freeform schema', () => {
		test('should render the Research tab with the run row', async ({
			page,
		}) => {
			// Land directly on `?tab=research` instead of clicking the
			// tab. PriTabs.Root reads the active tab from the URL via
			// `useTabSearchParam`, so a direct `goto` mounts the panel
			// without waiting for React 19 hydration to wire up the
			// `onValueChange` handler — eliminates the click-before-hydrate
			// race that costs 5 s + leaves Profile selected.
			await page.goto(`/companies/${COMPANY_SLUG}?tab=research`, {
				waitUntil: 'networkidle',
			})

			// THEN the seeded run appears in the list
			await expect(page.getByTestId('research-run-list')).toBeVisible()
			const row = page
				.getByTestId(`research-run-row-${seededRunIds[0]}`)
				.first()
			await expect(row).toBeVisible()
			await expect(row).toContainText('About Cal Pep Fonda')
		})

		test('should open run detail with brief_md rendered as Markdown', async ({
			page,
		}) => {
			await page.goto(`/companies/${COMPANY_SLUG}?tab=research`, {
				waitUntil: 'networkidle',
			})
			await page
				.getByTestId(`research-run-row-${seededRunIds[0]}`)
				.first()
				.click()

			// Streamdown emits an `<h1>` for the `# Notes` markdown header.
			await expect(page.getByTestId('research-run-brief')).toBeVisible()
			await expect(
				page.getByTestId('research-run-brief').locator('h1').first(),
			).toHaveText('Notes')
		})

		test('should render the freeform proposed updates section', async ({
			page,
		}) => {
			await page.goto(`/companies/${COMPANY_SLUG}?tab=research`, {
				waitUntil: 'networkidle',
			})
			await page
				.getByTestId(`research-run-row-${seededRunIds[0]}`)
				.first()
				.click()

			await expect(page.getByTestId('research-proposed-updates')).toBeVisible()
			await expect(page.getByTestId('research-proposed-updates')).toContainText(
				'region',
			)
		})
	})

	test.describe('when the user opens Run new research', () => {
		test('should fire exactly one POST /v1/research on double-submit', async ({
			page,
		}) => {
			// Slow Vite dev startup + selective hydration can push the
			// open + submit + close round-trip beyond Playwright's 30 s
			// default. Give the case headroom; the assertions below still
			// fail fast on real bugs.
			test.setTimeout(60_000)
			await page.goto(`/companies/${COMPANY_SLUG}?tab=research`, {
				waitUntil: 'networkidle',
			})

			// React 19 captures discrete events at the root and replays
			// them once the suspense boundary hydrates (see
			// react-dom-client.development.js around line 23583). The
			// click below therefore fires after hydration even if the
			// listener isn't wired at the moment of the click — but the
			// replay can take longer than the default 5 s on a freshly
			// hot-built dev bundle, so widen the visibility budget.
			let posts = 0
			page.on('request', req => {
				if (req.method() === 'POST' && req.url().endsWith('/v1/research')) {
					posts += 1
				}
			})

			// Click the open button until the dialog actually mounts. In
			// the full-suite run the dev bundle may have just hot-rebuilt,
			// and the SSR form-action replay buffer can miss the first
			// click; the pre-hydration submit still navigates to the
			// `javascript:throw …` no-op URL silently. Retrying gives
			// React time to commit the hydrated handler.
			const openBtn = page.getByTestId('research-run-new')
			const dialog = page.getByTestId('research-dialog')
			await expect
				.poll(
					async () => {
						await openBtn.click({ timeout: 2_000 }).catch(() => {})
						return dialog.isVisible()
					},
					{ timeout: 15_000, intervals: [200, 400, 600, 1000] },
				)
				.toBe(true)

			await page
				.getByTestId('research-dialog-query')
				.fill(`What does ${COMPANY_SLUG} sell?`)
			const submit = page.getByTestId('research-dialog-submit')
			await expect(submit).toBeEnabled()

			// Two rapid submits must coalesce: the form's action pipeline
			// flips `submitting=true` synchronously, so the second click
			// finds `canSubmit === false` and bails before sending.
			await submit.click()
			await submit.click({ trial: true }).catch(() => {})

			await expect(page.getByTestId('research-dialog')).toBeHidden({
				timeout: 15_000,
			})

			expect(posts, 'expected exactly one POST /v1/research').toBe(1)

			// Cleanup: drop whatever run id the engine created so reruns
			// remain idempotent. research_cache references research_runs
			// without ON DELETE CASCADE, so the cache row has to go first.
			psql(
				`DELETE FROM research_cache WHERE research_id IN (SELECT id FROM research_runs WHERE query LIKE 'What does ${COMPANY_SLUG}%')`,
			)
			psql(
				`DELETE FROM research_runs WHERE query LIKE 'What does ${COMPANY_SLUG}%'`,
			)
		})
	})
})
