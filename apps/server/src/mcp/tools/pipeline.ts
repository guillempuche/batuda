import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'

import {
	NextSteps,
	PipelineSnapshot,
	PRIORITY_AT_LEAST_BOUNDS,
	STALE_DAYS_BOUNDS,
} from '@batuda/controllers'

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
		'Get the daily planning lists: upcoming tasks, the three company attention lists, and research runs awaiting review. A company appears on at most ONE of the three company lists, most urgent first, so the same company is never reported twice: overdueCompanies has missed its next_action_at date; staleCompanies is mid-chase (contacted, responded, meeting or proposal) and has not been heard from in staleDays, or never at all; highPriority is priority <= priorityAtLeast with nothing scheduled at all. Companies with status closed or dead appear on none of them. staleDays (default 14) is how long a company may go quiet before it counts — raise it for long sales cycles, lower it for fast-turnaround trades. priorityAtLeast (default 1) reads as importance, not the stored number: 1 is the hottest, so 2 takes priorities 1 and 2. researchAwaitingReview lists finished research nobody in the organization has dealt with yet, newest first — pendingUpdateCount is how many of its proposed CRM changes are still undecided — read them with list_research_proposed_updates, but applying one writes to the customer’s records and so asks the person first, which most chat clients cannot do: summarise what is proposed and point them at /research/<run id> to decide there. A status of failed, no_reliable_data or succeeded_low_confidence means the run itself needs a look. A run leaves this list once its changes are all decided. This is how research started earlier gets noticed: a run takes minutes, so whoever asked for it is rarely still waiting when it lands. companyId, companyName and companySlug are null for a freeform or scan run that belongs to no single company, and completedAt can be null. counts reports how many rows match each list in total, one entry per list, which is what to quote when summarising; limit (default 20) caps each list separately and the matching *Truncated flag says which lists had more rows than were returned, so ask again with a higher limit before reporting a list as complete.',
	parameters: Schema.Struct({
		limit: Schema.optional(McpPageLimit),
		// Same bounds the HTTP route enforces, taken from it rather than repeated,
		// so an agent and a browser are never told different limits. The numbers
		// arrive already parsed here, which is why the schema is not the
		// from-a-string one the query string needs.
		staleDays: Schema.optional(
			Schema.Number.pipe(
				Schema.check(Schema.isInt(), Schema.isBetween(STALE_DAYS_BOUNDS)),
			),
		),
		priorityAtLeast: Schema.optional(
			Schema.Number.pipe(
				Schema.check(
					Schema.isInt(),
					Schema.isBetween(PRIORITY_AT_LEAST_BOUNDS),
				),
			),
		),
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
				service
					.getNextSteps(params.limit, {
						staleDays: params.staleDays,
						priorityAtLeast: params.priorityAtLeast,
					})
					.pipe(Effect.orDie),
		}
	}),
)
