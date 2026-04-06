import { Effect, Schema } from 'effect'
import { McpServer } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import { CompanyService } from '../../services/companies'
import { completeCompanySlug } from './_completions'
import { LangParam, langDirective } from './_lang'

export const CompanyResearchPrompt = McpServer.prompt({
	name: 'company-research',
	description:
		'Build a research brief for a company: profile, contacts, interactions, documents.',
	parameters: {
		slug: Schema.String,
		lang: LangParam,
	},
	completion: { slug: completeCompanySlug },
	content: ({ slug, lang }) =>
		Effect.gen(function* () {
			const service = yield* CompanyService
			const rawData = yield* service.getWithRelations(slug)
			const data = rawData as Record<string, unknown>
			const sql = yield* SqlClient.SqlClient
			const companyId = data['id'] as string
			const docs =
				yield* sql`SELECT id, type, title FROM documents WHERE company_id = ${companyId}`
			const tasks =
				yield* sql`SELECT * FROM tasks WHERE company_id = ${companyId} AND completed_at IS NULL ORDER BY due_at`

			return `${langDirective(lang)}

You are preparing a research brief for ${data['name']}.

## Company Profile
${JSON.stringify(data, null, 2)}

## Open Tasks
${JSON.stringify(tasks, null, 2)}

## Documents
${JSON.stringify(docs, null, 2)}

Produce:
1. Company overview (industry, size, status, priority)
2. Key contacts and their roles
3. Interaction history summary and relationship trajectory
4. Pain points and product fit analysis
5. Open tasks and pending actions
6. Recommended next steps and talking points`
		}),
})
