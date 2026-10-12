import { Effect } from 'effect'
import { McpServer } from 'effect/ai'

import { PipelineService } from '../../services/pipeline'
import { inMcpOrgScope } from '../org-scope'

export const PipelineResource = McpServer.resource({
	uri: 'batuda://pipeline',
	name: 'Pipeline Summary',
	description: 'Pipeline overview: status counts, overdue tasks, next steps.',
	mimeType: 'application/json',
	audience: ['assistant'],
	content: inMcpOrgScope(
		Effect.gen(function* () {
			const service = yield* PipelineService
			const pipeline = yield* service.getPipeline()
			return JSON.stringify(pipeline, null, 2)
		}),
	),
})
