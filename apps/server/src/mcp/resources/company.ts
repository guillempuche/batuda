import { Effect, Schema } from 'effect'
import { McpSchema, McpServer } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import { textAtTheStart } from '../../lib/search-text'
import { CompanyService } from '../../services/companies'

const slugParam = McpSchema.param('slug', Schema.String)

export const CompanyResource =
	McpServer.resource`batuda://company/${slugParam}`({
		name: 'Company Profile',
		description:
			'Full company profile with contacts and recent interactions, compressed for LLM context.',
		mimeType: 'application/json',
		audience: ['assistant'],
		completion: {
			slug: (input: string) =>
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					const rows = yield* sql<{ slug: string }>`
							SELECT slug FROM companies
							WHERE slug ILIKE ${textAtTheStart(input)}
								AND deleted_at IS NULL
							ORDER BY updated_at DESC LIMIT 10
						`
					return rows.map(row => row.slug)
				}),
		},
		content: Effect.fn(function* (_uri, slug) {
			const service = yield* CompanyService
			const data = yield* service.getWithRelations(slug)
			return JSON.stringify(data, null, 2)
		}),
	})
