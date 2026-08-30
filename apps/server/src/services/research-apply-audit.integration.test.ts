// Live-DB integration test for the audit entry written when a research
// suggestion is applied to a CRM row: the ResearchProposalApplied timeline
// event lands as a research_applied activity linked to the run and the subject.
//
// Prereq: `pnpm cli services up` — this suite's globalSetup builds and migrates
// the disposable batuda_it database it runs against.

import { randomUUID } from 'node:crypto'

import { Effect, Layer } from 'effect'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CurrentOrg } from '@batuda/controllers'
import {
	ResearchProposalApplied,
	TimelineActivityService,
} from '@batuda/timeline'

import { PgLive } from '../db/client'
import { applyTestEnv } from '../test-env'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string
const ORG = `audit-org-${randomUUID()}`

let pool: pg.Pool

const deps = TimelineActivityService.layer.pipe(Layer.provideMerge(PgLive))

const record = (event: ResearchProposalApplied) =>
	Effect.gen(function* () {
		const timeline = yield* TimelineActivityService
		return yield* timeline.record(event).pipe(
			Effect.provideService(CurrentOrg, {
				id: ORG,
				name: 'audit',
				slug: 'audit',
				role: 'member',
			}),
		)
	}).pipe(Effect.provide(deps), Effect.orDie, Effect.runPromise)

const seedCompany = async (): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name)
		 VALUES ($1, $2, 'Acme') RETURNING id`,
		[ORG, `acme-${randomUUID()}`],
	)
	return r.rows[0]!.id
}

const seedContact = async (companyId: string): Promise<string> => {
	const r = await pool.query<{ id: string }>(
		`INSERT INTO contacts (organization_id, company_id, name)
		 VALUES ($1, $2, 'Ada') RETURNING id`,
		[ORG, companyId],
	)
	return r.rows[0]!.id
}

interface ActivityRow {
	kind: string
	entity_type: string
	entity_id: string
	company_id: string | null
	contact_id: string | null
	actor_user_id: string | null
	payload: {
		operation?: string
		subjectTable?: string
		subjectId?: string
		appliedFields?: string[]
	}
}

const activityFor = async (runId: string): Promise<ActivityRow | undefined> => {
	const r = await pool.query<ActivityRow>(
		`SELECT kind, entity_type, entity_id, company_id, contact_id,
		        actor_user_id, payload
		 FROM timeline_activity WHERE entity_id = $1 AND organization_id = $2`,
		[runId, ORG],
	)
	return r.rows[0]
}

beforeAll(() => {
	pool = new pg.Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
	await pool.query(`DELETE FROM timeline_activity WHERE organization_id = $1`, [
		ORG,
	])
	await pool.query(`DELETE FROM companies WHERE organization_id = $1`, [ORG])
	await pool.end()
})

describe('ResearchProposalApplied audit entry', () => {
	describe('when a discovered contact is created from a run', () => {
		it('should record a research_applied activity linked to the run, contact, and company', async () => {
			// GIVEN a run that created a contact under a company
			const companyId = await seedCompany()
			const contactId = await seedContact(companyId)
			const runId = randomUUID()

			// WHEN the apply is recorded
			await record(
				new ResearchProposalApplied({
					researchRunId: runId,
					companyId,
					contactId,
					subjectTable: 'contacts',
					subjectId: contactId,
					operation: 'created',
					appliedFields: ['name', 'role'],
					actorUserId: 'user-1',
					occurredAt: new Date(),
				}),
			)

			// THEN a research_applied row ties the run to the contact + company,
			// naming who applied it and which fields changed
			const row = await activityFor(runId)
			expect(row?.kind).toBe('research_applied')
			expect(row?.entity_type).toBe('research_run')
			expect(row?.entity_id).toBe(runId)
			expect(row?.company_id).toBe(companyId)
			expect(row?.contact_id).toBe(contactId)
			expect(row?.actor_user_id).toBe('user-1')
			expect(row?.payload.operation).toBe('created')
			expect(row?.payload.subjectTable).toBe('contacts')
			expect(row?.payload.appliedFields).toEqual(['name', 'role'])
		})
	})

	describe('when a company field is updated from a run', () => {
		it('should link the activity to the company with no contact', async () => {
			// GIVEN a run that updated a company field
			const companyId = await seedCompany()
			const runId = randomUUID()

			// WHEN the apply is recorded
			await record(
				new ResearchProposalApplied({
					researchRunId: runId,
					companyId,
					contactId: null,
					subjectTable: 'companies',
					subjectId: companyId,
					operation: 'updated',
					appliedFields: ['industry'],
					actorUserId: 'user-2',
					occurredAt: new Date(),
				}),
			)

			// THEN the row points at the company alone
			const row = await activityFor(runId)
			expect(row?.company_id).toBe(companyId)
			expect(row?.contact_id).toBeNull()
			expect(row?.payload.operation).toBe('updated')
		})
	})

	describe('when the apply had no human actor (auto-applied)', () => {
		it('should record a null actor', async () => {
			// GIVEN a run whose proposal was auto-applied by policy, no user
			const companyId = await seedCompany()
			const runId = randomUUID()

			// WHEN the apply is recorded with no actor
			await record(
				new ResearchProposalApplied({
					researchRunId: runId,
					companyId,
					contactId: null,
					subjectTable: 'companies',
					subjectId: companyId,
					operation: 'updated',
					appliedFields: ['website'],
					actorUserId: null,
					occurredAt: new Date(),
				}),
			)

			// THEN the trail shows the change had no human author
			const row = await activityFor(runId)
			expect(row?.actor_user_id).toBeNull()
		})
	})
})
