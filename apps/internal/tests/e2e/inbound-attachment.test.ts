import { execSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import { setActiveOrgBySlug } from './helpers/set-active-org'

// Inbound-attachment download path. The seed direct-INSERTs M4
// ("Visit photos attached") on the agent inbox and uploads the bytes
// to MinIO at `messages/<org>/<inbox>/seed/<slug>/attachment-0.bin`,
// with `email_messages.attachments` JSONB pointing at the key. This
// spec opens the resulting thread and exercises the chip click →
// server hands the bytes back through `StorageProvider.get`. M8
// ("Vendor quote — final") is the multi-attachment variant.
//
// Selectors verified against:
//   apps/internal/src/routes/emails/$threadId.tsx
//     (attachment-chip, data-attachment-id)

const DATABASE_URL =
	process.env['E2E_DATABASE_URL'] ??
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'

const psql = (sqlText: string): string =>
	execSync(`psql "${DATABASE_URL}" -tA -c "${sqlText.replace(/"/g, '\\"')}"`, {
		encoding: 'utf8',
	}).trim()

test.describe('inbound attachment chips', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/', { waitUntil: 'commit' })
		await setActiveOrgBySlug(page, 'taller')
	})

	test.describe('when the user opens M4 (single attachment)', () => {
		test('should render one chip and let the user download the bytes', async ({
			page,
		}) => {
			const threadId = psql(
				`SELECT id FROM email_thread_links WHERE subject = 'Visit photos attached' LIMIT 1`,
			)
			expect(threadId, 'seeded M4 thread must exist').not.toBe('')

			await page.goto(`/emails/${threadId}`, { waitUntil: 'networkidle' })

			// THEN one chip renders
			const chips = page.getByTestId('attachment-chip')
			await expect(chips).toHaveCount(1)

			// AND the chip's href resolves to a 200 with non-empty bytes
			const href = await chips.first().getAttribute('href')
			expect(href).toBeTruthy()
			const status = await page.evaluate(async (url: string) => {
				const r = await fetch(url, { credentials: 'include' })
				return { ok: r.ok, length: (await r.arrayBuffer()).byteLength }
			}, href!)
			expect(status.ok).toBe(true)
			expect(status.length).toBeGreaterThan(0)
		})
	})

	test.describe('when the user opens M8 (two attachments)', () => {
		test('should render two chips, each downloadable on its own', async ({
			page,
		}) => {
			const threadId = psql(
				`SELECT id FROM email_thread_links WHERE subject = 'Vendor quote — final' LIMIT 1`,
			)
			expect(threadId, 'seeded M8 thread must exist').not.toBe('')

			await page.goto(`/emails/${threadId}`, { waitUntil: 'networkidle' })

			const chips = page.getByTestId('attachment-chip')
			await expect(chips).toHaveCount(2)

			// Each chip's data-attachment-id should be the index it was
			// uploaded with (0 and 1). We don't assume order — assert the
			// set instead.
			const ids = await chips.evaluateAll(els =>
				els
					.map(e => (e as HTMLElement).dataset['attachmentId'])
					.filter((v): v is string => typeof v === 'string')
					.sort(),
			)
			expect(ids).toEqual(['0', '1'])
		})
	})
})
