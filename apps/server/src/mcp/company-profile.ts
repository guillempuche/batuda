import { Effect } from 'effect'

import { CompanyService } from '../services/companies'

/**
 * A company with its contacts and recent history, read for an MCP resource or
 * prompt by its slug.
 *
 * A slug that names no company here stops with a sentence the client can show.
 * Left as it is, the not-found failure carries no message, and the client is
 * handed an internal error with empty text. A company another organisation
 * owns reads as missing too, so the answer says nothing about which companies
 * exist elsewhere.
 */
export const companyProfile = (slug: string) =>
	CompanyService.use(service => service.getWithRelations(slug)).pipe(
		Effect.catchTag('NotFound', () => Effect.die(`Company ${slug} not found`)),
	)
