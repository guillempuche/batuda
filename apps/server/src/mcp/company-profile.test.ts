import { Cause, Effect, Exit, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { CurrentOrg, NotFound } from '@batuda/controllers'

import { CompanyService } from '../services/companies'
import { companyProfile } from './company-profile'

// A company lookup that knows no company at all — which is also how one owned
// by another organisation reads, since row-level security hides it.
const NoCompanies = Layer.mergeAll(
	Layer.succeed(CompanyService, {
		getWithRelations: (slug: string) =>
			Effect.fail(new NotFound({ entity: 'company', id: slug })),
	} as never),
	Layer.succeed(CurrentOrg, {
		id: 'org-1',
		name: 'Acme',
		slug: 'acme',
		role: 'member',
	} as never),
)

// The text a client is shown when a resource or prompt fails: the library takes
// it from the first error the failure prints as.
const shownText = (exit: Exit.Exit<unknown, unknown>) =>
	Exit.isFailure(exit) ? Cause.prettyErrors(exit.cause)[0]?.message : undefined

describe('companyProfile', () => {
	describe('when the slug names no company here', () => {
		it('should stop with a sentence naming the slug, not an empty error', async () => {
			// GIVEN a slug that matches no company the organisation can see
			// WHEN the profile is read for a resource or a prompt
			const exit = await Effect.runPromiseExit(
				companyProfile('ghost-co').pipe(Effect.provide(NoCompanies)),
			)

			// THEN the client is shown which company was missing, rather than an
			// internal error with no text that it can only retry
			expect(shownText(exit)).toBe('Company ghost-co not found')
		})
	})
})
