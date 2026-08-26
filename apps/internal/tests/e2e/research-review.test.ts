import { execSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import { UNDO_WINDOW_MS } from '#/lib/undo-window'
import { DATABASE_URL } from './helpers/database-url'
import { waitForInteractive } from './helpers/hydration'
import { setActiveOrgBySlug } from './helpers/set-active-org'

// Exercises the research review flow on /research (inbox) and
// /research/$id (per-run review): trust badges, provenance, single
// apply/reject, and a bulk "apply all verified" whose batch contains a
// stale-record conflict — the conflict must not abort the rest.
//
// Proposals only exist as JSONB inside a research_runs row (a stub run
// produces none), so the fixture is seeded directly through psql, matching
// research-on-company.test.ts.

const psql = (sqlText: string): string =>
	execSync(`psql "${DATABASE_URL}" -tA -c "${sqlText.replace(/"/g, '\\"')}"`, {
		encoding: 'utf8',
	}).trim()

// An apply is held back for the whole undo window before it is sent, so the
// outcome cannot appear sooner. Derived from the screen's own constant, so
// lengthening the window does not turn these tests red.
const OUTCOME_TIMEOUT_MS = UNDO_WINDOW_MS + 10_000
// That wait does not fit in the 30s every other test gets, so the two applying
// tests ask for the wait plus a normal test's worth of time.
const APPLY_TEST_TIMEOUT_MS = OUTCOME_TIMEOUT_MS + 30_000

const RUN_ID = '9f000000-0000-4000-8000-0000000000e2'
const PU_TRUSTWORTHY = 'aaaaaaaa-0000-4000-8000-0000000000e2'
const PU_NEEDS_REVIEW = 'bbbbbbbb-0000-4000-8000-0000000000e2'
const PU_CONFLICT = 'cccccccc-0000-4000-8000-0000000000e2'

let orgId = ''
let companyId = ''
let userId = ''
let pepContactId = ''

test.beforeAll(() => {
	orgId = psql(`select id from organization where slug='taller' limit 1`)
	companyId = psql(
		`select c.id from companies c where c.organization_id='${orgId}' and c.name='Cal Pep Fonda' limit 1`,
	)
	userId = psql(`select id from "user" where email='admin@taller.cat' limit 1`)
	pepContactId = psql(
		`select id from contacts where company_id='${companyId}' and name='Pep Casals' limit 1`,
	)
})

// The run is seeded under `taller`, and RLS scopes it to the active org. A
// sibling suite may have left Alice on Restaurant, which would render /research
// empty here, so pin the org before each test the way the other authed specs do.
test.beforeEach(async ({ page }) => {
	await page.goto('/', { waitUntil: 'commit' })
	await setActiveOrgBySlug(page, 'taller')
})

// Reset to a clean, all-pending fixture and remove any contacts a prior run
// created, so each test starts from the same state (a re-created person would
// otherwise merge as a duplicate instead of a fresh create).
test.beforeEach(() => {
	psql(
		`delete from contacts where company_id='${companyId}' and name in ('Nuria Vidal','Jordi Garcia')`,
	)
	const findings = JSON.stringify({
		proposed_updates: [
			{
				id: PU_TRUSTWORTHY,
				status: 'pending',
				operation: 'create',
				subject_table: 'contacts',
				reason: 'Discovered CEO with a verified email.',
				fields: {
					name: 'Nuria Vidal',
					company_id: companyId,
					channels: [
						{
							kind: 'email',
							value: 'nuria@calpepfonda.cat',
							verification: 'deliverable',
							confidence: 0.9,
							is_primary: true,
						},
					],
				},
				citations: [{ source_id: 'https://calpepfonda.cat/equip' }],
			},
			{
				id: PU_NEEDS_REVIEW,
				status: 'pending',
				operation: 'create',
				subject_table: 'contacts',
				reason: 'Possible operations manager; email is a guess.',
				fields: {
					name: 'Jordi Garcia',
					company_id: companyId,
					channels: [
						{
							kind: 'email',
							value: 'jordi@calpepfonda.cat',
							verification: 'risky',
							confidence: 0.45,
							is_primary: true,
						},
					],
				},
				citations: [{ source_id: 'https://calpepfonda.cat' }],
			},
			{
				id: PU_CONFLICT,
				status: 'pending',
				operation: 'update',
				subject_table: 'contacts',
				subject_id: pepContactId,
				expected_version: 999,
				reason: 'Update the role from a verified source.',
				fields: {
					role: 'Head Chef',
					channels: [
						{
							kind: 'email',
							value: 'pep@calpepfonda.cat',
							verification: 'deliverable',
							confidence: 0.92,
							is_primary: true,
						},
					],
				},
				citations: [{ source_id: 'https://calpepfonda.cat/equip' }],
			},
		],
	}).replace(/'/g, "''")

	psql(
		`insert into research_runs (id, organization_id, created_by, kind, query, mode, schema_name, status, phase, findings, completed_at, started_at)
		 values ('${RUN_ID}','${orgId}','${userId}','leaf','E2E review fixture','deep','contact_discovery_v1','succeeded',3,'${findings}'::jsonb, now(), now())
		 on conflict (id) do update set findings=excluded.findings, status=excluded.status`,
	)
})

test.afterAll(() => {
	psql(`delete from research_runs where id='${RUN_ID}'`)
	psql(
		`delete from contacts where company_id='${companyId}' and name in ('Nuria Vidal','Jordi Garcia')`,
	)
})

test.describe('research review', () => {
	test.describe('when a run has pending proposals', () => {
		test('should surface them in the cross-run inbox with trust tiers', async ({
			page,
		}) => {
			// GIVEN pending proposals across runs
			// WHEN the reviewer opens the inbox
			await page.goto('/research', { waitUntil: 'networkidle' })

			// THEN the queue shows both trust tiers and a batch action
			await expect(page.getByTestId('research-inbox-trustworthy')).toBeVisible()
			await expect(
				page.getByTestId('research-inbox-needs-review'),
			).toBeVisible()
			await expect(page.getByTestId('research-inbox-apply-all')).toBeVisible()
			// AND a confirmed value is badged as such
			await expect(
				page.getByTestId('research-trust-badge').first(),
			).toContainText('Confirmed')
		})

		test('should show trust badges and provenance on the run review', async ({
			page,
		}) => {
			// GIVEN the run's review screen
			await page.goto(`/research/${RUN_ID}`, { waitUntil: 'networkidle' })

			// THEN the review lists the proposals with a confirmed and a risky badge
			const review = page.getByTestId('research-review')
			await expect(review).toBeVisible()
			await expect(review).toContainText('Confirmed')
			await expect(review).toContainText('Risky')
			// AND each finding traces back to its research source
			await expect(
				page.getByTestId('research-provenance').first(),
			).toContainText('Sourced from research')
		})

		test('should apply a single proposal and show its outcome', async ({
			page,
		}) => {
			test.setTimeout(APPLY_TEST_TIMEOUT_MS)
			// GIVEN the review screen, interactive so the click reaches a live
			// handler rather than an inert server-rendered button
			await page.goto(`/research/${RUN_ID}`, { waitUntil: 'networkidle' })
			await waitForInteractive(page, 'research-review-apply')
			const needsReviewCard = page.getByTestId('research-review-card').filter({
				hasText: 'Jordi Garcia',
			})
			const badge = needsReviewCard.getByTestId('research-outcome-badge')

			// WHEN the reviewer applies the needs-review proposal. Its write is held
			// back for the whole undo window before it reaches the server, so the
			// outcome cannot land until that has run out.
			await needsReviewCard.getByTestId('research-review-apply').click()

			// THEN it enters the CRM (created, or merged if it already existed) and
			// the card shows the outcome the run now stores
			await expect(badge).toBeVisible({ timeout: OUTCOME_TIMEOUT_MS })
			await expect(badge).toHaveAttribute(
				'data-outcome',
				/created|duplicate|applied/,
			)
		})

		test('should keep an applied proposal outcome after a reload', async ({
			page,
		}) => {
			test.setTimeout(APPLY_TEST_TIMEOUT_MS)
			// GIVEN a proposal that has just been applied and shows its outcome
			await page.goto(`/research/${RUN_ID}`, { waitUntil: 'networkidle' })
			await waitForInteractive(page, 'research-review-apply')
			const card = page
				.getByTestId('research-review-card')
				.filter({ hasText: 'Jordi Garcia' })
			const badge = card.getByTestId('research-outcome-badge')
			await card.getByTestId('research-review-apply').click()
			await expect(badge).toBeVisible({ timeout: OUTCOME_TIMEOUT_MS })

			// WHEN the page is reloaded, dropping every in-memory reply
			await page.reload({ waitUntil: 'networkidle' })

			// THEN the card still shows the outcome, read back from the stored run
			// rather than from this session's now-discarded reply
			await expect(badge).toBeVisible()
			await expect(badge).toHaveAttribute(
				'data-outcome',
				/created|duplicate|applied/,
			)
		})

		test('should apply all verified without aborting on a conflict', async ({
			page,
		}) => {
			// GIVEN a batch whose verified set includes a stale-version update, on a
			// screen that is interactive so the bulk action reaches a live handler
			await page.goto(`/research/${RUN_ID}`, { waitUntil: 'networkidle' })
			await waitForInteractive(page, 'research-review-apply-all')

			const created = page
				.getByTestId('research-review-card')
				.filter({ hasText: 'Nuria Vidal' })
				.getByTestId('research-outcome-badge')
			// AND the stale update shows its changed field, not a contact name
			const conflicted = page
				.getByTestId('research-review-card')
				.filter({ hasText: 'Head Chef' })
				.getByTestId('research-outcome-badge')

			// WHEN the reviewer applies every verified proposal in one batch. The
			// bulk write is guarded by a confirm step, so it takes two clicks.
			await page.getByTestId('research-review-apply-all').click()
			await page.getByTestId('research-review-apply-all-confirm').click()

			// THEN the fresh create succeeds
			await expect(created).toBeVisible({ timeout: 15_000 })
			await expect(created).toHaveAttribute('data-outcome', /created|duplicate/)

			// AND the stale update reports a conflict rather than aborting the batch
			await expect(conflicted).toBeVisible()
			await expect(conflicted).toHaveAttribute('data-outcome', 'conflict')
		})
	})
})

// Applying writes more than the fields a proposal lists: on the company a run was
// asked about, it also replaces that company's account brief with what the run
// wrote, and nothing keeps the earlier text. The warning that says so is the only
// place a person finds out before it happens, and it is deliberately quiet on the
// changes it is not true of — so both halves are checked here.
const BRIEF_RUN_ID = '9f000000-0000-4000-8000-0000000000e3'
const PU_ON_SUBJECT = 'dddddddd-0000-4000-8000-0000000000e3'

test.describe('research review, on notes the run would replace', () => {
	test.afterAll(() => {
		psql(`delete from research_runs where id='${BRIEF_RUN_ID}'`)
	})

	const seedBriefRun = (context: string) => {
		const findings = JSON.stringify({
			proposed_updates: [
				{
					id: PU_ON_SUBJECT,
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
		psql(
			`insert into research_runs (id, organization_id, created_by, kind, query, mode, schema_name, status, phase, findings, brief_md, context, completed_at, started_at)
			 values ('${BRIEF_RUN_ID}','${orgId}','${userId}','leaf','E2E brief fixture','deep','company_enrichment_v1','succeeded',3,'${findings}'::jsonb,'## Cal Pep Fonda','${context}'::jsonb, now(), now())
			 on conflict (id) do update set findings=excluded.findings, brief_md=excluded.brief_md, context=excluded.context`,
		)
	}

	test.describe('when the change is about the company the run was asked about', () => {
		test('should say the account brief goes with it', async ({ page }) => {
			// GIVEN a run pinned to that company, which wrote a brief
			seedBriefRun(
				JSON.stringify({
					subjects: [{ table: 'companies', id: companyId }],
				}).replace(/'/g, "''"),
			)

			// WHEN the review is opened
			await page.goto(`/research/${BRIEF_RUN_ID}`, { waitUntil: 'networkidle' })
			await waitForInteractive(page, 'research-review')

			// THEN the warning is on screen, before anything is applied
			await expect(
				page.getByTestId('research-review-brief-warning'),
			).toBeVisible()
		})
	})

	test.describe('when the company was only mentioned, not researched', () => {
		test('should stay quiet, so the warning still means something', async ({
			page,
		}) => {
			// GIVEN the same run with its subject pointing at some other company
			seedBriefRun(
				JSON.stringify({
					subjects: [
						{ table: 'companies', id: '00000000-0000-4000-8000-000000000999' },
					],
				}).replace(/'/g, "''"),
			)

			// WHEN the review is opened
			await page.goto(`/research/${BRIEF_RUN_ID}`, { waitUntil: 'networkidle' })
			await waitForInteractive(page, 'research-review')

			// THEN nothing is claimed about notes this apply would not touch
			await expect(
				page.getByTestId('research-review-brief-warning'),
			).toHaveCount(0)
		})
	})
})
