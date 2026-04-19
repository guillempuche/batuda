import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'

import { ResearchService, type SystemDefaults } from '@batuda/research'

import { EnvVars } from '../../lib/env'

// ── start_research (async) ──

const StartResearch = Tool.make('start_research', {
	description:
		'Start a research run. Returns an ID immediately — use get_research to poll for results. Best for long-running research where you want to do other work while waiting.',
	parameters: Schema.Struct({
		query: Schema.String,
		context: Schema.optional(Schema.Unknown),
		schema_name: Schema.optional(Schema.String),
	}),
	success: Schema.Struct({
		id: Schema.String,
		status: Schema.String,
	}),
})
	.annotate(Tool.Title, 'Start Research')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

// ── get_research ──

const GetResearch = Tool.make('get_research', {
	description:
		'Get the current state of a research run. Returns status, findings (if complete), cost, and sources.',
	parameters: Schema.Struct({
		id: Schema.String,
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Get Research')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

// ── research_sync (blocking) ──

const ResearchSync = Tool.make('research_sync', {
	description:
		'Run research to completion and return full findings inline. Blocks until done or timeout. Best for short research that fits in a single tool call.',
	parameters: Schema.Struct({
		query: Schema.String,
		context: Schema.optional(Schema.Unknown),
		schema_name: Schema.optional(Schema.String),
		max_wait_seconds: Schema.optional(Schema.Number),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Research (Sync)')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

// ── Toolkit + handlers ──

export const ResearchMcpTools = Toolkit.make(
	StartResearch,
	GetResearch,
	ResearchSync,
)

export const ResearchMcpHandlersLive = ResearchMcpTools.toLayer(
	Effect.gen(function* () {
		const svc = yield* ResearchService
		const env = yield* EnvVars

		const systemDefaults: SystemDefaults = {
			budgetCents: env.RESEARCH_DEFAULT_BUDGET_CENTS,
			paidBudgetCents: env.RESEARCH_DEFAULT_PAID_BUDGET_CENTS,
			autoApprovePaidCents: env.RESEARCH_DEFAULT_AUTO_APPROVE_PAID_CENTS,
			paidMonthlyCapCents: env.RESEARCH_DEFAULT_PAID_MONTHLY_CAP_CENTS,
			hardCeiling: env.RESEARCH_MONTHLY_CAP_HARD_CEILING_CENTS,
		}

		return {
			start_research: params =>
				Effect.gen(function* () {
					// MCP calls use a system user for now
					const userId = 'mcp-system'
					const result = yield* svc.create(
						userId,
						{
							query: params.query,
							context: params.context as any,
							schemaName: params.schema_name,
						},
						systemDefaults,
					)
					return result
				}).pipe(Effect.orDie),

			get_research: params =>
				Effect.gen(function* () {
					const run = yield* svc.get(params.id)
					return run ?? { error: 'not found' }
				}).pipe(Effect.orDie),

			research_sync: params =>
				Effect.gen(function* () {
					const userId = 'mcp-system'
					const { id } = yield* svc.create(
						userId,
						{
							query: params.query,
							context: params.context as any,
							schemaName: params.schema_name,
						},
						systemDefaults,
					)

					// Poll until the run reaches a terminal status or we exceed
					// the caller's timeout (default 2 minutes).
					const maxWaitMs = (params.max_wait_seconds ?? 120) * 1000
					const startedAt = Date.now()

					let run = yield* svc.get(id)
					while (
						run &&
						['queued', 'running'].includes(
							(run as { status: string }).status,
						) &&
						Date.now() - startedAt < maxWaitMs
					) {
						yield* Effect.sleep('2 seconds')
						run = yield* svc.get(id)
					}

					return run ?? { error: 'not found' }
				}).pipe(Effect.orDie),
		}
	}),
)
