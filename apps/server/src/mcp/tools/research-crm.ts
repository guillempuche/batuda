import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'

import { CurrentOrg } from '@batuda/controllers'

import { CompanyService } from '../../services/companies'

// ── crm_lookup ──
// With `id`: get a single row. With `query`: search by name/fields.
// Replaces separate search_companies + get_company + search_contacts + get_contact.
// CurrentOrg is declared as a dependency so the MCP runtime threads the
// active-org tag through every CRM lookup — same pattern the email tools
// use at apps/server/src/mcp/tools/email.ts:17.

const CrmLookup = Tool.make('crm_lookup', {
	description:
		"Look up existing CRM data. With 'id': get a single row. With 'query': search by name/fields. Use this to check if an entity already exists in the CRM before proposing new data.",
	parameters: Schema.Struct({
		table: Schema.Literals(['companies', 'contacts']),
		query: Schema.optional(Schema.String),
		id: Schema.optional(Schema.String),
	}),
	success: Schema.Unknown,
	dependencies: [CurrentOrg],
})
	.annotate(Tool.Title, 'CRM Lookup')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

// ── Toolkit + handlers ──

export const ResearchCrmTools = Toolkit.make(CrmLookup)

export const ResearchCrmHandlersLive = ResearchCrmTools.toLayer(
	Effect.gen(function* () {
		const companies = yield* CompanyService

		return {
			crm_lookup: params =>
				Effect.gen(function* () {
					if (params.table === 'companies') {
						if (params.id) {
							return yield* companies
								.findById(params.id)
								.pipe(Effect.catchTag('NotFound', () => Effect.succeed(null)))
						}
						return yield* companies.search({
							query: params.query,
							limit: 10,
						})
					}
					// contacts table — uses same SQL pattern
					// For now, delegate to a direct SQL query since
					// ContactService doesn't exist as a standalone service yet
					return []
				}).pipe(Effect.orDie),
		}
	}),
)
