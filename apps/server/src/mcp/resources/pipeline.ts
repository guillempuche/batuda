import { Effect } from 'effect'
import { McpServer } from 'effect/unstable/ai'

import { PipelineService } from '../../services/pipeline'

export const PipelineResource = McpServer.resource({
	uri: 'forja://pipeline',
	name: 'Pipeline Summary',
	description: 'Pipeline overview: status counts, overdue tasks, next steps',
	content: Effect.gen(function* () {
		const service = yield* PipelineService
		const pipeline = yield* service.getPipeline()
		return JSON.stringify(pipeline, null, 2)
	}),
})
