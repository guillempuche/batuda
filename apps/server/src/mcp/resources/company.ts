import { Effect, Schema } from 'effect'
import { McpServer } from 'effect/unstable/ai'

import { CompanyService } from '../../services/companies'

const slugParam = Schema.String

export const CompanyResource =
	McpServer.resource`batuda://company/${slugParam}`({
		name: 'Company Profile',
		description: 'Full company profile compressed for LLM context',
		content: Effect.fn(function* (_uri, slug) {
			const service = yield* CompanyService
			const data = yield* service.getWithRelations(slug)
			return JSON.stringify(data, null, 2)
		}),
	})
