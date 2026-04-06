import { Effect } from 'effect'
import { McpServer } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import { PipelineService } from '../../services/pipeline'
import { LangParam, langDirective } from './_lang'

export const DailyBriefingPrompt = McpServer.prompt({
	name: 'daily-briefing',
	description:
		'Daily CRM briefing: pipeline health, overdue tasks, upcoming actions, companies needing attention.',
	parameters: {
		lang: LangParam,
	},
	content: ({ lang }) =>
		Effect.gen(function* () {
			const pipeline = yield* PipelineService
			const data = yield* pipeline.getPipeline()
			const next = yield* pipeline.getNextSteps(15)
			const sql = yield* SqlClient.SqlClient
			const recent = yield* sql`
				SELECT i.*, c.name as company_name, c.slug as company_slug
				FROM interactions i JOIN companies c ON i.company_id = c.id
				WHERE i.date >= now() - interval '3 days'
				ORDER BY i.date DESC LIMIT 20`

			return `${langDirective(lang)}

Daily CRM briefing:

## Pipeline
${JSON.stringify(data, null, 2)}

## Next Steps & Overdue
${JSON.stringify(next, null, 2)}

## Recent Interactions (3 days)
${JSON.stringify(recent, null, 2)}

Produce:
1. Pipeline health (bottlenecks, status changes)
2. Urgent: overdue tasks needing immediate action
3. Today's priorities
4. Companies at risk (stale, no recent contact)
5. Quick wins
6. Suggested schedule`
		}),
})
