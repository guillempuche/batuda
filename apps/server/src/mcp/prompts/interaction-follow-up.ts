import { Effect, Schema } from 'effect'
import { McpServer } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import { CompanyService } from '../../services/companies'
import { completeCompanySlug } from './_completions'
import { LangParam, langDirective } from './_lang'

export const InteractionFollowUpPrompt = McpServer.prompt({
	name: 'interaction-follow-up',
	description:
		'Analyze recent interactions with a company and suggest follow-up actions.',
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
			const companyId = data['id'] as string
			const sql = yield* SqlClient.SqlClient
			const interactions = yield* sql`
				SELECT i.*, ct.name as contact_name, ct.role as contact_role
				FROM interactions i LEFT JOIN contacts ct ON i.contact_id = ct.id
				WHERE i.company_id = ${companyId}
				ORDER BY i.date DESC LIMIT 10`
			const openTasks = yield* sql`
				SELECT * FROM tasks
				WHERE company_id = ${companyId} AND completed_at IS NULL
				ORDER BY due_at`

			return `${langDirective(lang)}

You are analyzing interactions for ${data['name']}.

## Company
Status: ${data['status']} | Priority: ${data['priority']} | Industry: ${data['industry']}
Next action: ${data['nextAction'] || 'none'} | Due: ${data['nextActionAt'] || 'not set'}

## Contacts
${JSON.stringify(rawData.contacts, null, 2)}

## Interaction History (most recent first)
${JSON.stringify(interactions, null, 2)}

## Open Tasks
${JSON.stringify(openTasks, null, 2)}

Produce:
1. Relationship trajectory (improving, stalling, declining?)
2. Dropped balls or missed follow-ups
3. 2-3 concrete next actions with specific dates
4. Draft follow-up email if appropriate
5. Flag contacts to re-engage or new contacts to seek`
		}),
})
