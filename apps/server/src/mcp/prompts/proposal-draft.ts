import { Effect, Schema } from 'effect'
import { McpServer } from 'effect/ai'
import { SqlClient } from 'effect/sql'

import { companyProfile } from '../company-profile'
import { inMcpOrgScope } from '../org-scope'
import {
	completeCompanySlug,
	completeLang,
	noSuggestions,
} from './_completions'
import { LangParam, langDirective } from './_lang'

export const ProposalDraftPrompt = McpServer.prompt({
	name: 'proposal-draft',
	description:
		'Draft a sales proposal: gathers company profile, products, and interaction history.',
	parameters: {
		slug: Schema.String,
		focus: Schema.optional(Schema.String),
		lang: LangParam,
	},
	completion: {
		slug: completeCompanySlug,
		focus: noSuggestions,
		lang: completeLang,
	},
	content: ({ slug, focus, lang }) =>
		inMcpOrgScope(
			Effect.gen(function* () {
				const rawData = yield* companyProfile(slug)
				const data = rawData as Record<string, unknown>
				const sql = yield* SqlClient.SqlClient
				const products =
					yield* sql`SELECT * FROM products WHERE status = 'active'`

				return `${langDirective(lang)}

You are drafting a sales proposal for ${data['name']}.

## Company Context
${JSON.stringify(data, null, 2)}

## Available Products
${JSON.stringify(products, null, 2)}

${focus ? `## Focus Area: ${focus}` : ''}

Produce:
1. Executive summary addressing their specific pain points
2. Proposed solution matching their product fit
3. Pricing and terms based on available products
4. Implementation timeline
5. Next steps`
			}),
		),
})
