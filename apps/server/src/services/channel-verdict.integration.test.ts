// PgLive reads DATABASE_URL via Config at layer-build time. Default to the
// integration database so the suite runs without a loaded env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { VerificationVerdict } from '@batuda/domain'

import { PgLive } from '../db/client'
import repairVerdicts from '../db/migrations/0063_channel_verification_vocabulary'
import { writeChannels } from './channels'

// What survives a write, and what the repair migration does to what is already
// stored.
//
// Both are about the same asymmetry: an address with no verdict is sent to
// without comment, while any verdict other than `deliverable` makes the send path
// stop and ask. So losing a verdict is not a cosmetic slip — it quietly reopens
// an address a check had ruled out. The migration is run here rather than copied,
// so the statements that ship are the ones under test.
//
// Prereq: `pnpm cli services up` so Postgres is reachable.

const DATABASE_URL = process.env['DATABASE_URL'] as string

let pool: pg.Pool
const ORG = `verdict-org-${randomUUID()}`
let company: string

const run = <A>(effect: Effect.Effect<A, unknown, SqlClient.SqlClient>) =>
	effect.pipe(Effect.provide(PgLive), Effect.runPromise)

const subject = () => ({ table: 'companies' as const, id: company })

const write = (channel: {
	kind: string
	value: string
	verification?: VerificationVerdict
	confidence?: number
}) =>
	run(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* writeChannels(sql, ORG, subject(), [channel])
		}),
	)

const stored = async (
	address: string,
): Promise<{ verification: string | null; confidence: number | null }> => {
	const r = await pool.query<{
		verification: string | null
		confidence: number | null
	}>(
		`SELECT verification, confidence FROM channels
		 WHERE subject_id = $1 AND address = $2`,
		[company, address],
	)
	return r.rows[0]!
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
	const c = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name)
		 VALUES ($1, $2, 'Cristalls Roca') RETURNING id`,
		[ORG, `cristalls-roca-${randomUUID()}`],
	)
	company = c.rows[0]!.id
}, 30_000)

afterAll(async () => {
	await pool.query(`DELETE FROM channels WHERE organization_id = $1`, [ORG])
	await pool.query(`DELETE FROM companies WHERE organization_id = $1`, [ORG])
	await pool.end()
})

describe('what a verdict survives', () => {
	describe('when an address is saved again without one', () => {
		it('should keep the verdict and the score already on file', async () => {
			// GIVEN an address a check ruled out
			await write({
				kind: 'email',
				value: 'tancat@cristalls.cat',
				verification: 'undeliverable',
				confidence: 90,
			})

			// WHEN the same address is written again saying nothing about it — the
			// ordinary "re-save this person's addresses" call
			await write({ kind: 'email', value: 'tancat@cristalls.cat' })

			// THEN the ruling stands. Erased, it would read as "never checked",
			// which is the one state mail goes out on without comment.
			expect(await stored('tancat@cristalls.cat')).toEqual({
				verification: 'undeliverable',
				confidence: 90,
			})
		})
	})

	describe('when a later check reaches a different conclusion', () => {
		it('should take the new verdict and the score that came with it', async () => {
			// GIVEN the same address, now re-checked and merely doubtful
			await write({
				kind: 'email',
				value: 'tancat@cristalls.cat',
				verification: 'risky',
			})

			// THEN the fresh ruling replaces the old one, and the old score goes
			// with the claim it belonged to rather than lending weight to this one
			expect(await stored('tancat@cristalls.cat')).toEqual({
				verification: 'risky',
				confidence: null,
			})
		})
	})

	describe('when only a score arrives', () => {
		it('should refresh the score and leave the verdict alone', async () => {
			// GIVEN an address with a verdict on file
			// WHEN something records a score without re-stating the verdict
			await write({
				kind: 'email',
				value: 'tancat@cristalls.cat',
				confidence: 40,
			})
			// THEN the verdict stands and the score is the new one
			expect(await stored('tancat@cristalls.cat')).toEqual({
				verification: 'risky',
				confidence: 40,
			})
		})
	})
})

describe('putting stored verdicts right', () => {
	let orphan: string

	beforeAll(async () => {
		// Nothing can write a wrong word while the check is on, so it comes off to
		// build the state the repair exists to put right. Test files run one at a
		// time, so nothing else is writing while it is off.
		await pool.query(
			`ALTER TABLE channels DROP CONSTRAINT channels_verification_chk`,
		)

		try {
			// Words that reached the column while it was free text, plus the two
			// that must come through untouched.
			await pool.query(
				`INSERT INTO channels (organization_id, subject_table, subject_id, channel, address, verification, confidence)
				 VALUES
				   ($1, 'companies', $2, 'email', 'a@repair.cat', 'inferred', 55),
				   ($1, 'companies', $2, 'email', 'b@repair.cat', 'Deliverable', 80),
				   ($1, 'companies', $2, 'email', 'c@repair.cat', NULL, NULL),
				   ($1, 'companies', $2, 'email', 'd@repair.cat', 'risky', 30)`,
				[ORG, company],
			)
			// A channel whose contact is already gone — what deleting somebody
			// leaves behind, since nothing cascades off a polymorphic key.
			const gone = randomUUID()
			const o = await pool.query<{ id: string }>(
				`INSERT INTO channels (organization_id, subject_table, subject_id, channel, address, status)
				 VALUES ($1, 'contacts', $2, 'email', 'orfe@repair.cat', 'bounced') RETURNING id`,
				[ORG, gone],
			)
			orphan = o.rows[0]!.id

			await run(repairVerdicts)
		} finally {
			// Back on whatever happened above, so a throw midway cannot leave the
			// database open for every suite that runs after this one. Putting it
			// back is itself a check that the repair left nothing it refuses — and
			// failing here still fails the suite.
			await pool.query(
				`ALTER TABLE channels ADD CONSTRAINT channels_verification_chk
				 CHECK (verification IS NULL OR verification IN
				   ('deliverable','risky','catch_all','undeliverable','unknown'))`,
			)
		}
	})

	describe('when a verdict is only mis-spelled', () => {
		it('should repair it rather than demote it', async () => {
			// GIVEN a real verdict written with a capital
			// THEN it is read as what it plainly says, so an address a check had
			// cleared is not left carrying a warning
			expect(await stored('b@repair.cat')).toEqual({
				verification: 'deliverable',
				confidence: 80,
			})
		})
	})

	describe('when a word is not a verdict at all', () => {
		it('should record doubt about it and keep the score', async () => {
			// GIVEN "inferred" — a pattern-guessed address nothing in the app knows
			// how to read
			// THEN it carries doubt, because a word nobody recognises is something
			// somebody wrote rather than a check that came back. Not "unknown", which
			// would claim a check ran and settled nothing. The score is about the
			// address, not the wording, so it stays.
			expect(await stored('a@repair.cat')).toEqual({
				verification: 'risky',
				confidence: 55,
			})
		})
	})

	describe('when nobody has checked an address at all', () => {
		it('should leave it untouched', async () => {
			// GIVEN a hand-typed address with no verdict — almost every address on
			// file
			// THEN it stays that way. Folding these into "unverified" would put a
			// warning on the whole book, and nothing here could put it back.
			expect(await stored('c@repair.cat')).toEqual({
				verification: null,
				confidence: null,
			})
		})

		it('should leave a verdict that was already right alone', async () => {
			expect(await stored('d@repair.cat')).toEqual({
				verification: 'risky',
				confidence: 30,
			})
		})
	})

	describe('when a channel belongs to somebody who is gone', () => {
		it('should remove it, and leave the live ones', async () => {
			// GIVEN an address hanging off a contact that no longer exists, holding a
			// bounce the send gate still honours organisation-wide
			const left = await pool.query(`SELECT id FROM channels WHERE id = $1`, [
				orphan,
			])
			// THEN it is gone — nobody could have lifted that block, because the only
			// way to lift one names a contact who is not there
			expect(left.rowCount).toBe(0)
			// AND the addresses that still belong to somebody are untouched
			const live = await pool.query(
				`SELECT id FROM channels WHERE organization_id = $1 AND subject_table = 'companies'`,
				[ORG],
			)
			expect(live.rowCount).toBeGreaterThan(0)
		})
	})
})

describe('a word the vocabulary does not contain', () => {
	describe('when something writes one straight to the table', () => {
		it('should be refused by the database, not stored', async () => {
			// GIVEN an address with a verdict on it
			await write({
				kind: 'email',
				value: 'backstop@cristalls.cat',
				verification: 'risky',
			})

			// WHEN a verdict outside the five words is written past the app — a
			// hand-run repair or a one-off script, which is how the wrong words the
			// repair had to clean up got in
			const badWrite = pool.query(
				`UPDATE channels SET verification = 'Deliverable'
				 WHERE subject_id = $1 AND address = $2`,
				[company, 'backstop@cristalls.cat'],
			)

			// THEN it does not land, and the verdict already there is untouched
			await expect(badWrite).rejects.toThrow(
				/channels_verification_chk|check constraint/i,
			)
			expect(await stored('backstop@cristalls.cat')).toEqual({
				verification: 'risky',
				confidence: null,
			})
		})
	})

	describe('when the verdict is taken off entirely', () => {
		it('should allow it, since no verdict is a state an address can be in', async () => {
			// GIVEN the same address, still carrying a verdict
			// WHEN the verdict is cleared
			await pool.query(
				`UPDATE channels SET verification = NULL
				 WHERE subject_id = $1 AND address = $2`,
				[company, 'backstop@cristalls.cat'],
			)

			// THEN nothing objects — "nobody has checked" is not a bad word, it is
			// the absence of one, and the check has to leave room for it
			expect(await stored('backstop@cristalls.cat')).toEqual({
				verification: null,
				confidence: null,
			})
		})
	})
})
