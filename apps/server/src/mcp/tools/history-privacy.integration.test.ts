// What a company's history says about mail nobody else may read.
//
// A company's page and the history tools show what has happened with that
// company: mail sent, mail received, calls, notes. When the mail landed in
// somebody's private mailbox, the entry about it — its subject, its first two
// hundred characters, even that it happened — is theirs alone, so the rule that
// hides the message hides the entry with it.
//
// Everything else on the history is untouched, which is the other half of this:
// a rule that hid calls and notes as well would be a worse bug than the leak.
//
// Prereq: `pnpm cli services up` and `pnpm cli db migrate`.

process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda_it'

import { randomUUID } from 'node:crypto'

import { Effect, Layer, Stream } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CurrentOrg, SessionContext } from '@batuda/controllers'
import { TimelineActivityService } from '@batuda/timeline'

import { PgLive } from '../../db/client.js'
import { enterOrgScope } from '../../middleware/org.js'
import { InteractionHandlersLive, InteractionTools } from './interactions.js'
import { TimelineHandlersLive, TimelineTools } from './timeline.js'

const DATABASE_URL = process.env['DATABASE_URL'] as string
const ORG = `history-privacy-${randomUUID().slice(0, 8)}`
const OWNER = 'history-owner'
const COLLEAGUE = 'history-colleague'

const PRIVATE_SUBJECT = 'What we settled privately'
const SHARED_SUBJECT = 'Roof quote'
const CALL_SUBJECT = 'Rang about the roof'

let pool: pg.Pool
let companyId: string

const asUser = (userId: string) =>
	Layer.mergeAll(
		Layer.succeed(CurrentOrg, {
			id: ORG,
			name: 'History Privacy Test',
			slug: 'history-privacy-test',
			role: 'member',
		} as never),
		Layer.succeed(SessionContext, {
			userId,
			email: `${userId}@test.local`,
			name: undefined,
			isAgent: false,
		} as never),
	)

/** What one person can read of the company's history, through the tools. */
const historyFor = (userId: string) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* enterOrgScope(sql, {
				org: { id: ORG, name: 'History Privacy Test', slug: 'x' } as never,
				userId,
				role: 'member',
			})(
				Effect.gen(function* () {
					const timeline = yield* TimelineTools
					const interactions = yield* InteractionTools
					const timelineStream = yield* timeline.handle('list_timeline', {
						company_id: companyId,
					} as never)
					const [timelinePage] = yield* Stream.runCollect(timelineStream)
					const interactionStream = yield* interactions.handle(
						'list_interactions',
						{ company_id: companyId } as never,
					)
					const [interactionPage] = yield* Stream.runCollect(interactionStream)
					return {
						timeline: JSON.stringify(timelinePage?.result ?? []),
						interactions: JSON.stringify(interactionPage?.result ?? []),
					}
				}).pipe(
					Effect.provide(
						Layer.mergeAll(
							TimelineHandlersLive.pipe(Layer.provide(PgLive)),
							InteractionHandlersLive.pipe(
								Layer.provide(PgLive),
								// Logging an interaction needs it; nothing here logs one.
								Layer.provide(
									Layer.succeed(TimelineActivityService, {
										record: () => Effect.void,
									} as never),
								),
							),
						),
					),
					Effect.provide(asUser(userId)),
					Effect.orDie,
				) as Effect.Effect<
					{ timeline: string; interactions: string },
					never,
					CurrentOrg | SqlClient.SqlClient
				>,
			)
		}).pipe(Effect.provide(PgLive)),
	)

const insertInbox = async (email: string, isPrivate: boolean) => {
	const rows = await pool.query<{ id: string }>(
		`INSERT INTO inboxes
		 (organization_id, owner_user_id, email, is_private,
		  imap_host, imap_port, imap_security, smtp_host, smtp_port, smtp_security,
		  username, password_ciphertext, password_nonce, password_tag)
		 VALUES ($1, $2, $3, $4, 'imap.test', 993, 'tls', 'smtp.test', 465, 'tls', $3,
		         '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea)
		 RETURNING id`,
		[ORG, OWNER, email, isPrivate],
	)
	return rows.rows[0]!.id
}

/** A message, the history entry about it, and the same on the CRM's own list. */
const seedMailWithHistory = async (args: {
	readonly inboxId: string
	readonly subject: string
}) => {
	const messageId = `<${randomUUID()}@history.test>`
	const message = await pool.query<{ id: string }>(
		`INSERT INTO email_messages
		 (organization_id, inbox_id, message_id, thread_key, direction, folder,
		  raw_rfc822_ref, subject, received_at, text_preview, text_body, status, company_id)
		 VALUES ($1, $2, $3, $3, 'inbound', 'INBOX', 'history-test', $4, now(),
		         $5, $5, 'normal', $6)
		 RETURNING id`,
		[
			ORG,
			args.inboxId,
			messageId,
			args.subject,
			`${args.subject} — preview`,
			companyId,
		],
	)
	const id = message.rows[0]!.id
	await pool.query(
		`INSERT INTO timeline_activity
		 (organization_id, kind, entity_type, entity_id, company_id, occurred_at, summary, payload)
		 VALUES ($1, 'email_received', 'email_message', $2, $3, now(), $4, $5::jsonb)`,
		[
			ORG,
			id,
			companyId,
			`${args.subject} — preview`,
			JSON.stringify({ subject: args.subject }),
		],
	)
	await pool.query(
		`INSERT INTO interactions
		 (organization_id, company_id, date, channel, direction, type, subject, summary, email_message_id)
		 VALUES ($1, $2, now(), 'email', 'inbound', 'email', $3, $4, $5)`,
		[ORG, companyId, args.subject, `${args.subject} — preview`, id],
	)
	return id
}

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
	const company = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name, status)
		 VALUES ($1, $2, 'History Privacy Co', 'prospect') RETURNING id`,
		[ORG, `history-privacy-${ORG}`],
	)
	companyId = company.rows[0]!.id

	const sharedInboxId = await insertInbox(`team-${ORG}@history.test`, false)
	const privateInboxId = await insertInbox(`mine-${ORG}@history.test`, true)

	await seedMailWithHistory({ inboxId: sharedInboxId, subject: SHARED_SUBJECT })
	await seedMailWithHistory({
		inboxId: privateInboxId,
		subject: PRIVATE_SUBJECT,
	})

	// Something on the history that is not mail at all.
	await pool.query(
		`INSERT INTO timeline_activity
		 (organization_id, kind, entity_type, entity_id, company_id, occurred_at, summary, payload)
		 VALUES ($1, 'call_logged', 'interaction', gen_random_uuid(), $2, now(), $3, '{}'::jsonb)`,
		[ORG, companyId, CALL_SUBJECT],
	)
	await pool.query(
		`INSERT INTO interactions
		 (organization_id, company_id, date, channel, direction, type, subject)
		 VALUES ($1, $2, now(), 'phone', 'outbound', 'call', $3)`,
		[ORG, companyId, CALL_SUBJECT],
	)
})

afterAll(async () => {
	await pool.query(`DELETE FROM interactions WHERE organization_id = $1`, [ORG])
	await pool.query(`DELETE FROM timeline_activity WHERE organization_id = $1`, [
		ORG,
	])
	await pool.query(`DELETE FROM email_messages WHERE organization_id = $1`, [
		ORG,
	])
	await pool.query(`DELETE FROM inboxes WHERE organization_id = $1`, [ORG])
	await pool.query(`DELETE FROM companies WHERE organization_id = $1`, [ORG])
	await pool.end()
})

describe("a company's history and private mail [migration 0073]", () => {
	describe('when a colleague reads the history', () => {
		it('should say nothing about mail that came into a private mailbox', async () => {
			// GIVEN one shared message and one private, both on this company
			// WHEN a colleague reads the history and the interactions
			const seen = await historyFor(COLLEAGUE)
			// THEN neither the subject nor the preview of the private one is there
			expect(seen.timeline).not.toContain(PRIVATE_SUBJECT)
			expect(seen.interactions).not.toContain(PRIVATE_SUBJECT)
		})

		it('should still show mail the team shares', async () => {
			// GIVEN the same company
			// WHEN a colleague reads it
			const seen = await historyFor(COLLEAGUE)
			// THEN the shared conversation is on the history as before
			expect(seen.timeline).toContain(SHARED_SUBJECT)
			expect(seen.interactions).toContain(SHARED_SUBJECT)
		})

		it('should leave everything that is not mail alone', async () => {
			// GIVEN a logged call on the same company
			// WHEN a colleague reads the history
			const seen = await historyFor(COLLEAGUE)
			// THEN it is there: a rule that hid calls and notes would be worse
			// than the leak it was written for
			expect(seen.timeline).toContain(CALL_SUBJECT)
			expect(seen.interactions).toContain(CALL_SUBJECT)
		})
	})

	describe('when the mailbox owner reads the same history', () => {
		it('should show their own mail', async () => {
			// GIVEN the private message is theirs
			// WHEN they read the history
			const seen = await historyFor(OWNER)
			// THEN they see all of it
			expect(seen.timeline).toContain(PRIVATE_SUBJECT)
			expect(seen.interactions).toContain(PRIVATE_SUBJECT)
			expect(seen.timeline).toContain(SHARED_SUBJECT)
		})
	})
})
