import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { textAtTheStart } from '../../lib/search-text'
import { inMcpOrgScope } from '../org-scope'
import { LANGS } from './_lang'

// An argument a client can ask suggestions for but that takes free text or an
// id, so there is nothing to offer. Said as an empty list, because an argument
// with no suggester at all is answered with an error.
export const noSuggestions = (_input: string) =>
	Effect.succeed<Array<string>>([])

export const completeLang = (input: string) =>
	Effect.succeed(LANGS.filter(lang => lang.startsWith(input.toLowerCase())))

export const completeCompanySlug = (input: string) =>
	inMcpOrgScope(
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
	)
