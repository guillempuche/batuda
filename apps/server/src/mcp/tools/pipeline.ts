import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'

import { NextSteps, PipelineSnapshot } from '@batuda/controllers'

import { PipelineService } from '../../services/pipeline'
import { McpPageLimit } from './_result'

const GetPipeline = Tool.make('get_pipeline', {
	description:
		'Get pipeline overview: counts by status, overdue tasks, companies without next action.',
	success: PipelineSnapshot,
})
	.annotate(Tool.Title, 'Pipeline Overview')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const GetNextSteps = Tool.make('get_next_steps', {
	description:
		'Get upcoming tasks, companies with overdue next_action_at, and research runs awaiting review. Used for daily planning. researchAwaitingReview lists finished research nobody in the organization has dealt with yet, newest first — pendingUpdateCount is how many of its proposed CRM changes are still undecided (read them with list_research_proposed_updates, then decide each with resolve_research_proposed_update), and a status of failed, no_reliable_data or succeeded_low_confidence means the run itself needs a look. A run leaves this list once its changes are all decided. This is how research started earlier gets noticed: a run takes minutes, so whoever asked for it is rarely still waiting when it lands. companyId, companyName and companySlug are null for a freeform or scan run that belongs to no single company, and completedAt can be null. limit (default 20) caps each of the three lists separately.',
	parameters: Schema.Struct({
		limit: Schema.optional(McpPageLimit),
	}),
	success: NextSteps,
})
	.annotate(Tool.Title, 'Next Steps')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

export const PipelineTools = Toolkit.make(GetPipeline, GetNextSteps)

export const PipelineHandlersLive = PipelineTools.toLayer(
	Effect.gen(function* () {
		const service = yield* PipelineService
		return {
			get_pipeline: () => service.getPipeline().pipe(Effect.orDie),
			get_next_steps: params =>
				service.getNextSteps(params.limit).pipe(Effect.orDie),
		}
	}),
)
