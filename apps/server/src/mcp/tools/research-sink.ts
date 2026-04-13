import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import { ResearchRunContext } from '@engranatge/research'

// ── propose_update ──
// Writes to research_runs.findings.proposed_updates[], NEVER mutates domain rows.

const ProposeUpdate = Tool.make('propose_update', {
	description:
		'Propose a field update for a CRM row. This does NOT modify the row — it records the proposal for human review. Always include citations for every proposed change.',
	parameters: Schema.Struct({
		subject_table: Schema.Literals(['companies', 'contacts']),
		subject_id: Schema.String,
		expected_version: Schema.Number,
		fields: Schema.Unknown,
		reason: Schema.String,
		citations: Schema.Array(
			Schema.Struct({
				source_id: Schema.String,
				quote: Schema.optional(Schema.String),
			}),
		),
	}),
	success: Schema.Struct({
		status: Schema.String,
	}),
})
	.annotate(Tool.Title, 'Propose Update')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

// ── attach_finding ──
// Writes to research_links with link_kind='finding'. Idempotent.

const AttachFinding = Tool.make('attach_finding', {
	description:
		"Link a CRM row to this research run as a finding. Use kind='already_in_db' for rows that match the query, 'discovered' for new entities, 'related' for tangential connections.",
	parameters: Schema.Struct({
		subject_table: Schema.Literals(['companies', 'contacts']),
		subject_id: Schema.String,
		kind: Schema.Literals(['already_in_db', 'discovered', 'related']),
	}),
	success: Schema.Struct({
		status: Schema.String,
	}),
})
	.annotate(Tool.Title, 'Attach Finding')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

// ── propose_paid_action ──
// Records the proposal and returns immediately. Human approves after the run.

const ProposePaidAction = Tool.make('propose_paid_action', {
	description:
		'Propose a paid tool call that requires human approval. Call this instead of the paid tool directly when you receive an ApprovalRequired error. The research continues without the paid data — the human can approve after the run.',
	parameters: Schema.Struct({
		tool: Schema.String,
		args: Schema.Unknown,
		estimated_cents: Schema.Number,
		reason: Schema.String,
	}),
	success: Schema.Struct({
		status: Schema.String,
	}),
})
	.annotate(Tool.Title, 'Propose Paid Action')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

// ── Toolkit + handlers ──

export const ResearchSinkTools = Toolkit.make(
	ProposeUpdate,
	AttachFinding,
	ProposePaidAction,
)

export const ResearchSinkHandlersLive = ResearchSinkTools.toLayer(
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const { researchId } = yield* ResearchRunContext

		return {
			propose_update: params =>
				Effect.gen(function* () {
					// Append to research_runs.findings.proposed_updates[]
					yield* sql`
						UPDATE research_runs
						SET findings = jsonb_set(
							findings,
							'{proposed_updates}',
							COALESCE(findings->'proposed_updates', '[]'::jsonb)
								|| ${JSON.stringify([
									{
										subject_table: params.subject_table,
										subject_id: params.subject_id,
										expected_version: params.expected_version,
										fields: params.fields,
										reason: params.reason,
										citations: params.citations,
										status: 'pending',
									},
								])}::jsonb
						),
						updated_at = now()
						WHERE id = ${researchId}
					`

					yield* Effect.logInfo('propose_update recorded').pipe(
						Effect.annotateLogs({
							research_id: researchId,
							subject_table: params.subject_table,
							subject_id: params.subject_id,
						}),
					)
					return { status: 'proposed' }
				}).pipe(Effect.orDie),

			attach_finding: params =>
				Effect.gen(function* () {
					// Insert into research_links (idempotent)
					yield* sql`
						INSERT INTO research_links (research_id, subject_table, subject_id, link_kind)
						VALUES (${researchId}, ${params.subject_table}, ${params.subject_id}, 'finding')
						ON CONFLICT DO NOTHING
					`

					yield* Effect.logInfo('attach_finding recorded').pipe(
						Effect.annotateLogs({
							research_id: researchId,
							subject_table: params.subject_table,
							subject_id: params.subject_id,
							kind: params.kind,
						}),
					)
					return { status: 'attached' }
				}).pipe(Effect.orDie),

			propose_paid_action: params =>
				Effect.gen(function* () {
					// Append to research_runs.findings.pending_paid_actions[]
					yield* sql`
						UPDATE research_runs
						SET findings = jsonb_set(
							findings,
							'{pending_paid_actions}',
							COALESCE(findings->'pending_paid_actions', '[]'::jsonb)
								|| ${JSON.stringify([
									{
										id: crypto.randomUUID(),
										tool: params.tool,
										args: params.args,
										estimated_cents: params.estimated_cents,
										reason: params.reason,
										status: 'pending',
									},
								])}::jsonb
						),
						updated_at = now()
						WHERE id = ${researchId}
					`

					yield* Effect.logInfo('propose_paid_action recorded').pipe(
						Effect.annotateLogs({
							research_id: researchId,
							tool: params.tool,
							estimated_cents: params.estimated_cents,
						}),
					)
					return { status: 'proposed' }
				}).pipe(Effect.orDie),
		}
	}),
)
