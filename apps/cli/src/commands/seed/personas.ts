import { Effect } from 'effect'

import type { SeedCtx } from './shared'

// Spread ownership and activity off the admin (Alice) onto Carol and Bea so each
// member's "my tasks" / "my research" / activity-feed views have real data, and
// project a few more activity kinds from tasks and proposals so the unified
// timeline shows the variety it is designed for — not just calls and system
// events. Runs last, after every entity it reads has been seeded. Full-preset
// entities (research runs, proposals) simply match no rows under minimal.
export const seedPersonaActivity = ({
	sql,
	tallerOrgId,
	restaurantOrgId,
}: SeedCtx) =>
	Effect.gen(function* () {
		const users = yield* sql<{ id: string; email: string }>`
			SELECT id, email FROM "user"
			WHERE email IN ('colleague@taller.cat', 'boss@batuda.dev', 'admin@restaurant.demo')
		`
		const byEmail = new Map(users.map(u => [u.email, u.id]))
		const carol = byEmail.get('colleague@taller.cat')
		const bea = byEmail.get('boss@batuda.dev')
		const bob = byEmail.get('admin@restaurant.demo')
		if (!carol || !bea) return

		yield* Effect.logInfo('Attributing work + activity to personas...')

		yield* sql`
			UPDATE tasks SET assignee_id = ${carol}
			WHERE id IN (
				SELECT id FROM tasks WHERE organization_id = ${tallerOrgId}
				ORDER BY created_at LIMIT 3
			)
		`
		yield* sql`
			UPDATE tasks SET assignee_id = ${bea}
			WHERE id IN (
				SELECT id FROM tasks
				WHERE organization_id = ${tallerOrgId} AND assignee_id IS NULL
				ORDER BY created_at LIMIT 2
			)
		`
		yield* sql`
			UPDATE research_runs SET created_by = ${carol}
			WHERE id IN (
				SELECT id FROM research_runs WHERE organization_id = ${tallerOrgId}
				ORDER BY created_at LIMIT 4
			)
		`
		yield* sql`
			UPDATE research_runs SET created_by = ${bea}
			WHERE id IN (
				SELECT id FROM research_runs WHERE organization_id = ${tallerOrgId}
				ORDER BY created_at DESC LIMIT 3
			)
		`
		if (bob && restaurantOrgId !== null) {
			yield* sql`
				UPDATE research_runs SET created_by = ${bob}
				WHERE organization_id = ${restaurantOrgId}
			`
		}
		yield* sql`
			UPDATE timeline_activity SET actor_user_id = ${carol}
			WHERE id IN (
				SELECT id FROM timeline_activity WHERE organization_id = ${tallerOrgId}
				ORDER BY occurred_at LIMIT 6
			)
		`
		yield* sql`
			UPDATE timeline_activity SET actor_user_id = ${bea}
			WHERE id IN (
				SELECT id FROM timeline_activity
				WHERE organization_id = ${tallerOrgId} AND actor_user_id IS NULL
				ORDER BY occurred_at DESC LIMIT 4
			)
		`

		// Project task and proposal activity so the feed shows kinds beyond
		// call_logged / system_event (which the interaction projection emits).
		yield* sql`
			INSERT INTO timeline_activity (organization_id, kind, entity_type, entity_id, company_id, contact_id, occurred_at, summary, actor_user_id)
			SELECT ${tallerOrgId}, 'task_created', 'task', id, company_id, contact_id, created_at, 'Task created: ' || title, ${carol}
			FROM tasks WHERE organization_id = ${tallerOrgId} ORDER BY created_at LIMIT 4
		`
		yield* sql`
			INSERT INTO timeline_activity (organization_id, kind, entity_type, entity_id, company_id, contact_id, occurred_at, summary, actor_user_id)
			SELECT ${tallerOrgId}, 'task_completed', 'task', id, company_id, contact_id, completed_at, 'Task completed: ' || title, ${carol}
			FROM tasks WHERE organization_id = ${tallerOrgId} AND status = 'done'
		`
		yield* sql`
			INSERT INTO timeline_activity (organization_id, kind, entity_type, entity_id, company_id, occurred_at, summary, actor_user_id)
			SELECT ${tallerOrgId}, 'proposal_sent', 'proposal', id, company_id, COALESCE(sent_at, created_at), 'Proposal sent: ' || title, ${bea}
			FROM proposals WHERE organization_id = ${tallerOrgId} AND status IN ('sent', 'viewed', 'accepted', 'negotiating') ORDER BY created_at LIMIT 3
		`

		yield* Effect.logInfo(
			'  spread tasks/research/timeline to Carol + Bea (+ restaurant runs to Bob) and projected task/proposal activity',
		)
	})
