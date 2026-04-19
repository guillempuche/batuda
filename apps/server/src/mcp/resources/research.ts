import { Effect, Schema } from 'effect'
import { McpSchema, McpServer } from 'effect/unstable/ai'

import { ResearchService } from '@batuda/research'

const idParam = McpSchema.param('id', Schema.String)

export const ResearchResource =
	McpServer.resource`batuda://research/${idParam}`({
		name: 'Research Run',
		description:
			'Full research run with findings, brief, sources, and tool log.',
		mimeType: 'application/json',
		audience: ['assistant'],
		content: Effect.fn(function* (_uri, id) {
			const svc = yield* ResearchService
			const run = yield* svc.get(id)
			return JSON.stringify(run, null, 2)
		}),
	})
