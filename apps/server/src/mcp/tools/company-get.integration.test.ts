// Live-DB integration test for asking get_company about a company that is not
// there, driven through the real toolkit handler inside an org scope, the way a
// `tools/call` runs. A miss used to reach the database as a malformed id and
// come back to the caller as an internal fault, logged as one.
//
// Prereq: `pnpm cli services up` — the integration runner's globalSetup builds,
// migrates and seeds the disposable database this suite runs against.

import { randomUUID } from 'node:crypto'

import { Cause, Effect, Layer, ManagedRuntime, Stream } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { SqlClient } from 'effect/sql'
import { afterAll, describe, expect, it } from 'vitest'

import { TimelineActivityService } from '@batuda/timeline'

import { PgLive } from '../../db/client'
import { EnvVars } from '../../lib/env'
import { enterOrgScope } from '../../middleware/org'
import { CompanyService } from '../../services/companies'
import { Geocoder } from '../../services/geocoder'
import { applyTestEnv } from '../../test-env'
import { CurrentUser } from '../current-user'
import { isToolMessage } from '../tool-message'
import { CompanyHandlersLive, CompanyTools } from './companies'

applyTestEnv()

const Handlers = CompanyHandlersLive.pipe(
	Layer.provide(CompanyService.layer),
	Layer.provide(TimelineActivityService.layer),
	Layer.provide(Geocoder.layer),
	Layer.provide(FetchHttpClient.layer),
)

const runtime = ManagedRuntime.make(PgLive.pipe(Layer.provide(EnvVars.layer)))

// An organisation with nothing in it, so every lookup is a miss.
const org = {
	id: randomUUID(),
	name: 'Nobody Here',
	slug: `nobody-${randomUUID()}`,
}
const actorId = randomUUID()

// What the call answered with: the sentence written for the caller, or a note
// that the failure was not one.
const askFor = (idOrSlug: string): Promise<string> =>
	runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return yield* enterOrgScope(sql, { org, userId: actorId })(
				Effect.gen(function* () {
					const toolkit = yield* CompanyTools
					const stream = yield* toolkit.handle('get_company', {
						id_or_slug: idOrSlug,
					} as never)
					yield* Stream.runCollect(stream)
					return 'the call found a company'
				}).pipe(
					Effect.provideService(CurrentUser, {
						userId: actorId,
						email: `${actorId}@nobody.local`,
						name: 'Nobody',
						isAgent: true,
					}),
					Effect.provide(Handlers),
					Effect.catchCause(cause => {
						const failure = Cause.squash(cause)
						return Effect.succeed(
							isToolMessage(failure)
								? failure.message
								: `not a message written for the caller: ${String(failure)}`,
						)
					}),
				),
			)
		}),
	)

afterAll(() => runtime.dispose())

describe('get_company asked about a company that is not there', () => {
	describe('when it is given a slug nothing has', () => {
		it('should say so and point at search, not fail as an internal fault', async () => {
			// GIVEN an organisation with no company under that slug
			// WHEN an assistant asks for it
			const answer = await askFor('no-such-company')

			// THEN it is told plainly, with where to look, rather than handed an
			// internal error from the database refusing the slug as an id
			expect(answer).toContain('"no-such-company"')
			expect(answer).toContain('search_companies')
		})
	})

	describe('when it is given an id nothing has', () => {
		it('should answer the same way', async () => {
			// GIVEN an id shaped like one that matches no company here
			const id = randomUUID()

			// WHEN an assistant asks for it
			const answer = await askFor(id)

			// THEN it gets the same plain answer
			expect(answer).toContain(`"${id}"`)
			expect(answer).toContain('search_companies')
		})
	})
})
