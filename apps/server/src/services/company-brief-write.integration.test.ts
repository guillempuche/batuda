// Live-DB integration test for writing a company's account notes. Whoever writes
// them, nothing is held back by what the last writer left, so what matters is
// that a write replaces the stored text outright rather than adding to it.
//
// Prereq: `pnpm cli services up` — this suite's globalSetup builds and migrates
// the disposable batuda_it database it runs against.

import { randomUUID } from 'node:crypto'

import { Effect, Layer, ManagedRuntime } from 'effect'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CurrentOrg } from '@batuda/controllers'

import { PgLive } from '../db/client'
import { applyTestEnv } from '../test-env'
import { CompanyService } from './companies'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const ORG = `brief-org-${randomUUID()}`

const runtime = ManagedRuntime.make(
	CompanyService.layer.pipe(Layer.provideMerge(PgLive)),
)

let pool: pg.Pool

const seedCompany = async (): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name)
		 VALUES ($1, $2, 'Acme') RETURNING id`,
		[ORG, `acme-${randomUUID()}`],
	)
	return r.rows[0]?.id ?? ''
}

// The single write path every editor of the notes goes through. Who is writing
// makes no difference to it, which is the point of the cases below.
const writeBrief = (id: string, text: string) =>
	runtime.runPromise(
		Effect.gen(function* () {
			const svc = yield* CompanyService
			return yield* svc.update(id, { accountBrief: text })
		}).pipe(
			Effect.provideService(CurrentOrg, {
				id: ORG,
				name: 'b',
				slug: 'b',
				role: 'member',
			}),
		),
	)

const readBrief = async (id: string): Promise<string | null> => {
	const r = await pool.query<{ account_brief: string | null }>(
		`SELECT account_brief FROM companies WHERE id = $1`,
		[id],
	)
	return r.rows[0]?.account_brief ?? null
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
	await pool.query(`DELETE FROM companies WHERE organization_id = $1`, [ORG])
	await pool.end()
	await runtime.dispose()
})

describe('writing the account notes on a company', () => {
	describe('when a second writer follows the first', () => {
		it('should replace the stored text rather than adding to it', async () => {
			// GIVEN notes one side wrote
			const id = await seedCompany()
			await writeBrief(id, 'What I know about Acme.')

			// WHEN the other side rewrites them
			await writeBrief(id, 'What the agent found.')

			// THEN only the later text is stored
			const brief = await readBrief(id)
			expect(brief).toBe('What the agent found.')
		})
	})

	describe('when the notes are rewritten several times over', () => {
		it('should keep only the last text, never accumulating', async () => {
			// GIVEN notes somebody wrote
			const id = await seedCompany()
			await writeBrief(id, 'First.')

			// WHEN they are rewritten twice more
			await writeBrief(id, 'Second.')
			await writeBrief(id, 'Third.')

			// THEN nothing of the earlier rounds survives
			const brief = await readBrief(id)
			expect(brief).toBe('Third.')
			expect(brief).not.toContain('First')
			expect(brief).not.toContain('Second')
		})
	})

	describe('when a writer clears the notes', () => {
		it('should empty them rather than leaving the old text standing', async () => {
			// GIVEN notes somebody wrote
			const id = await seedCompany()
			await writeBrief(id, 'Worth deleting.')

			// WHEN they are emptied
			await writeBrief(id, '')

			// THEN the page is blank
			expect(await readBrief(id)).toBe('')
		})
	})
})
