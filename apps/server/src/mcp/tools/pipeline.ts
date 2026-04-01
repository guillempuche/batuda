import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'

import { PipelineService } from '../../services/pipeline'

const GetPipeline = Tool.make('get_pipeline', {
	description:
		'Get pipeline overview: counts by status, overdue tasks, companies without next action.',
	success: Schema.Unknown,
})

const GetNextSteps = Tool.make('get_next_steps', {
	description:
		'Get upcoming tasks and companies with overdue next_action_at. Used for daily planning.',
	parameters: Schema.Struct({
		limit: Schema.optional(Schema.Number),
	}),
	success: Schema.Unknown,
})

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
