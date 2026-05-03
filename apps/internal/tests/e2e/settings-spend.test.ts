import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { setActiveOrgBySlug } from './helpers/set-active-org'

// Asserts /settings/organization/spend renders aggregated paid-research
// spend and re-fetches when the range toggle changes. Slice B.
//
// Selectors verified against:
//   apps/internal/src/routes/settings/organization/index.tsx
//     (settings-org-spend-link)
//   apps/internal/src/routes/settings/organization/spend.tsx
//     (settings-spend-{total,by-provider,by-user,by-tool,
//      range-month,range-30d,range-all})

const DATABASE_URL =
	process.env['E2E_DATABASE_URL'] ??
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

const psql = (sqlText: string): string =>
	execSync(`psql "${DATABASE_URL}" -tA -c "${sqlText.replace(/"/g, '\\"')}"`, {
		encoding: 'utf8',
	}).trim()

const seededKeys: string[] = []

test.describe('org spend dashboard', () => {
	test.beforeAll(() => {
		// GIVEN three paid_spend rows for taller — two providers, two tools,
		// one user. Seeded under app_user with app.current_org_id set so the
		// org_isolation_research_paid_spend RLS policy approves the inserts.
		const orgId = psql(
			`SELECT id FROM organization WHERE slug='taller' LIMIT 1`,
		)
		const userId = psql(
			`SELECT id FROM "user" WHERE email='admin@taller.cat' LIMIT 1`,
		)
		const researchId = psql(
			`SELECT id FROM research_runs WHERE organization_id='${orgId}' LIMIT 1`,
		)
		expect(orgId).not.toBe('')
		expect(userId).not.toBe('')
		expect(researchId).not.toBe('')

		const rows: Array<{
			provider: string
			tool: string
			cents: number
		}> = [
			{ provider: 'brave', tool: 'search', cents: 250 },
			{ provider: 'firecrawl', tool: 'scrape', cents: 510 },
			{ provider: 'brave', tool: 'search', cents: 80 },
		]
		for (const r of rows) {
			const key = `e2e-spend-${randomUUID()}`
			seededKeys.push(key)
			psql(
				`INSERT INTO research_paid_spend
					(organization_id, research_id, user_id, provider, tool,
					 idempotency_key, amount_cents, args, auto_approved)
				VALUES (
					'${orgId}', '${researchId}', '${userId}', '${r.provider}', '${r.tool}',
					'${key}', ${r.cents}, '{}'::jsonb, true
				)`,
			)
		}
	})

	test.afterAll(() => {
		for (const key of seededKeys) {
			psql(`DELETE FROM research_paid_spend WHERE idempotency_key='${key}'`)
		}
	})

	test.describe('when the active user is an owner', () => {
		// Storage state from auth.setup.ts is Alice's; the activeOrg flip
		// must run BEFORE each test so the dashboard renders against
		// taller's seeded paid_spend rows.
		test.beforeEach(async ({ page }) => {
			await page.goto('/', { waitUntil: 'commit' })
			await setActiveOrgBySlug(page, 'taller')
		})

		test('should render the Spend nav row on the org settings landing', async ({
			page,
		}) => {
			// WHEN Alice opens /settings/organization
			await page.goto('/settings/organization', { waitUntil: 'networkidle' })
			// THEN the Spend nav row is visible
			await expect(page.getByTestId('settings-org-spend-link')).toBeVisible()
		})

		test('should render the month total + provider bars + user/tool tables', async ({
			page,
		}) => {
			// WHEN Alice opens the Spend dashboard with All-time range so the
			// seeded rows are guaranteed to be in the window
			await page.goto('/settings/organization/spend', {
				waitUntil: 'networkidle',
			})
			await page.getByTestId('settings-spend-range-all').click()

			// THEN the total card renders the aggregated spend
			const total = page.getByTestId('settings-spend-total')
			await expect(total).toBeVisible()
			await expect(total).toContainText(/€\d/)

			// AND the provider bars render with the seeded providers
			const byProvider = page.getByTestId('settings-spend-by-provider')
			await expect(byProvider).toContainText('brave')
			await expect(byProvider).toContainText('firecrawl')

			// AND the user table includes Alice's row (3 calls — the three
			// seeded rows above)
			const byUser = page.getByTestId('settings-spend-by-user')
			await expect(byUser).toContainText(/3/)

			// AND the tool table lists the two seeded tools
			const byTool = page.getByTestId('settings-spend-by-tool')
			await expect(byTool).toContainText('search')
			await expect(byTool).toContainText('scrape')
		})

		test('should re-fetch spend on range toggle (network call to /v1/research/spend?range=…)', async ({
			page,
		}) => {
			await page.goto('/settings/organization/spend', {
				waitUntil: 'networkidle',
			})

			// WHEN Alice toggles to "Last 30 days"
			const requestPromise = page.waitForRequest(
				req =>
					req.url().includes('/v1/research/spend') &&
					req.url().includes('range=30d'),
				{ timeout: 5_000 },
			)
			await page.getByTestId('settings-spend-range-30d').click()

			// THEN a fresh network call lands with range=30d
			const req = await requestPromise
			expect(req.url()).toContain('range=30d')
		})
	})

	test.describe('when the active user is a regular member', () => {
		// Drop Alice's storageState for this case so the explicit Carol
		// sign-in below isn't bounced by the already-authed redirect in
		// __root.tsx → /login.
		test.use({ storageState: { cookies: [], origins: [] } })

		test('should hide the Spend nav row on the org settings landing', async ({
			page,
		}) => {
			// GIVEN Carol's session (member, not owner/admin in taller)
			await page.goto('/login', { waitUntil: 'commit' })
			await page.getByTestId('login-email').fill('colleague@taller.cat')
			await page.getByTestId('login-password').fill('batuda-dev-2026')
			await page.getByTestId('login-submit').click()
			await page.waitForURL(/\/$/)
			await setActiveOrgBySlug(page, 'taller')

			// WHEN Carol opens /settings/organization
			await page.goto('/settings/organization', { waitUntil: 'networkidle' })

			// THEN the Spend nav row is NOT in the DOM
			await expect(page.getByTestId('settings-org-spend-link')).toHaveCount(0)
		})
	})
})
