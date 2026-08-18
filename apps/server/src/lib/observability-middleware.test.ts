import { Cause, Effect, Layer, Logger, References } from 'effect'
import { HttpServerRequest } from 'effect/unstable/http'
import { describe, expect, it } from 'vitest'

import { boundedCause, recordFacts } from '@batuda/observability'

import {
	httpPathPattern,
	withRequestRecord,
} from './observability-middleware.js'

// Drives the middleware with a stub request and reads back the annotations on
// each line it wrote. Annotations live on the fiber, not on the log options, so
// they are read the way the built-in formatters read them.
const runRequest = async <A extends { readonly status: number }, E>(
	app: Effect.Effect<A, E, never>,
	request?: { readonly url?: string; readonly method?: string },
) => {
	const lines: Array<{
		readonly level: string
		readonly message: unknown
		readonly annotations: Record<string, unknown>
	}> = []
	const capture = Layer.provideMerge(
		Layer.succeed(References.MinimumLogLevel, 'Debug'),
	)(
		Logger.layer([
			Logger.make(options => {
				lines.push({
					level: String(options.logLevel),
					message: options.message,
					annotations: {
						...options.fiber.getRef(References.CurrentLogAnnotations),
					},
				})
			}),
		]),
	)
	const stub = {
		url: request?.url ?? '/v1/companies',
		method: request?.method ?? 'GET',
		headers: {},
	} as unknown as HttpServerRequest.HttpServerRequest

	const exit = await Effect.runPromise(
		withRequestRecord(app).pipe(
			Effect.provideService(HttpServerRequest.HttpServerRequest, stub),
			Effect.provide(capture),
			Effect.exit,
		),
	)
	return { lines, exit }
}

// Locks in how request URLs are normalised before they become span attributes
// and log fields: record ids collapse to :id so errors group by route, and the
// query string / fragment are dropped so a secret in `?code=…` never leaks.

describe('httpPathPattern', () => {
	describe('when the url has no dynamic segment or query', () => {
		it('should return the path unchanged', () => {
			// GIVEN a static route
			// WHEN normalised
			// THEN it is returned as-is
			// [httpPathPattern]
			expect(httpPathPattern('/companies')).toBe('/companies')
		})
	})

	describe('when the url embeds a uuid record id', () => {
		it('should replace the uuid with :id', () => {
			// GIVEN a route with a record uuid
			// WHEN normalised
			// THEN the uuid collapses to :id so errors group by route
			// [UUID → :id]
			expect(
				httpPathPattern('/companies/3f2504e0-4f89-41d3-9a0c-0305e82c3301'),
			).toBe('/companies/:id')
		})

		it('should replace every uuid when more than one appears', () => {
			// GIVEN a nested route with two uuids
			// WHEN normalised
			// THEN both collapse to :id (global replace, case-insensitive)
			// [UUID global flag]
			expect(
				httpPathPattern(
					'/orgs/AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE/contacts/3f2504e0-4f89-41d3-9a0c-0305e82c3301',
				),
			).toBe('/orgs/:id/contacts/:id')
		})
	})

	describe('when the url carries a query string', () => {
		it('should drop the query so secrets never reach a span or log', () => {
			// GIVEN an OAuth callback whose query holds a code
			// WHEN normalised
			// THEN only the path survives; the query (and any token in it) is gone
			// [split('?')]
			expect(httpPathPattern('/auth/callback?code=secret&state=xyz')).toBe(
				'/auth/callback',
			)
		})
	})

	describe('when the url is a reset-password link (token in the path)', () => {
		it('should collapse the token segment so it never reaches a log', () => {
			// GIVEN a reset-password URL whose token rides in the path, not the query
			// WHEN normalised
			// THEN the token segment collapses to :token (a raw token in a log line
			//   would be a single-use credential leak)
			// [/auth/reset-password/ branch]
			expect(
				httpPathPattern('/auth/reset-password/eyJhbGciOi-secret-token'),
			).toBe('/auth/reset-password/:token')
		})
	})

	describe('when the url is a magic-link verify (token in the query)', () => {
		it('should drop the token along with the query', () => {
			// GIVEN a magic-link verify URL with the token in the query
			// WHEN normalised
			// THEN only the path survives; the token is gone
			// [split('?')]
			expect(
				httpPathPattern('/auth/magic-link/verify?token=secret-magic-token'),
			).toBe('/auth/magic-link/verify')
		})
	})

	describe('when the url carries a fragment', () => {
		it('should drop the fragment', () => {
			// GIVEN a url with a hash fragment
			// WHEN normalised
			// THEN the fragment is dropped
			// [split('#')]
			expect(httpPathPattern('/pages/about#section')).toBe('/pages/about')
		})
	})
})

// The whole point of the work record is that a fact learned mid-request ends up
// on the SAME line as the outcome, because two lines cannot be grouped as one.
// These pin that, and pin that the request's own identity always wins.
describe('withRequestRecord', () => {
	describe('when the request records a fact on the way through', () => {
		it('should put the fact on the same line as the outcome', async () => {
			// GIVEN a request that learns how the caller signed in, deep inside
			const { lines } = await runRequest(
				recordFacts({ 'auth.method': 'api_key' }).pipe(
					Effect.as({ status: 200 }),
				),
			)

			// WHEN it completes
			const completion = lines.find(
				line => line.annotations['event'] === 'http.request',
			)

			// THEN the fact, the outcome and the route are all on one line — this is
			// what makes "how long did it take, split by how they signed in" a
			// question with an answer
			expect(completion?.annotations['auth.method']).toBe('api_key')
			expect(completion?.annotations['http.status']).toBe(200)
			expect(completion?.annotations['http.path_pattern']).toBe('/v1/companies')
			expect(completion?.annotations['request.id']).toEqual(expect.any(String))
		})

		it('should not let a recorded fact shadow which request the line is for', async () => {
			// GIVEN a request that records keys clashing with the request's identity
			const { lines } = await runRequest(
				recordFacts({
					'request.id': 'IMPOSTOR',
					'http.path_pattern': '/impostor',
					event: 'impostor',
				}).pipe(Effect.as({ status: 200 })),
			)

			// WHEN it completes
			const completion = lines.find(
				line => line.annotations['event'] === 'http.request',
			)

			// THEN the middleware's own values win — a wrong request id or route
			// silently breaks tying a request's lines together
			expect(completion).toBeDefined()
			expect(completion?.annotations['request.id']).not.toBe('IMPOSTOR')
			expect(completion?.annotations['http.path_pattern']).toBe('/v1/companies')
		})
	})

	describe('when the response is a server error', () => {
		it('should log at error level and name it as one', async () => {
			// GIVEN a handler answering 500
			const { lines } = await runRequest(
				recordFacts({ 'org.id': 'org_1' }).pipe(Effect.as({ status: 503 })),
			)

			// WHEN it completes
			const completion = lines.find(
				line => line.annotations['event'] !== undefined,
			)

			// THEN it surfaces as an error and still carries the gathered facts
			expect(completion?.annotations['event']).toBe('http.server_error')
			expect(completion?.annotations['http.status']).toBe(503)
			expect(completion?.annotations['org.id']).toBe('org_1')
			expect(completion?.level).toBe('Error')
		})
	})

	describe('when the request dies without producing a response', () => {
		it('should still leave one findable line carrying the facts', async () => {
			// GIVEN a request that records a fact and then dies
			const { lines } = await runRequest(
				recordFacts({ 'org.id': 'org_1' }).pipe(
					Effect.andThen(Effect.die(new Error('boom'))),
				) as Effect.Effect<{ readonly status: number }, never, never>,
			)

			// WHEN the defect escapes
			const defect = lines.find(
				line => line.annotations['event'] === 'http.defect',
			)

			// THEN the crash is still findable by event and still says which tenant
			// and which route it happened on — the completion line never runs, so
			// without this a hard failure would leave nothing groupable
			expect(defect).toBeDefined()
			expect(defect?.annotations['org.id']).toBe('org_1')
			expect(defect?.annotations['http.path_pattern']).toBe('/v1/companies')
			expect(defect?.level).toBe('Error')
		})
	})

	describe('when the client disconnects', () => {
		it('should not log an error, because that is not a failure', async () => {
			// GIVEN a request interrupted part-way, as a closed tab does
			const { lines } = await runRequest(
				Effect.interrupt as Effect.Effect<
					{ readonly status: number },
					never,
					never
				>,
			)

			// THEN nothing is logged at error level — an interrupt tripping error
			// alerts would make every closed tab look like an outage
			expect(lines.filter(line => line.level === 'Error')).toHaveLength(0)
		})
	})
})

describe('boundedCause', () => {
	describe('when the cause is enormous', () => {
		it('should cap it and say how much was cut', () => {
			// GIVEN a defect whose message carries a whole payload
			const cause = Cause.die(new Error('x'.repeat(20_000)))

			// WHEN it is rendered for the log line
			const text = boundedCause(cause)

			// THEN it is bounded — an unbounded one would ship the payload to the
			// exporter, which flushes every second
			expect(text.length).toBeLessThan(4_200)
			expect(text).toContain('more characters')
		})
	})

	describe('when the cause is ordinary', () => {
		it('should keep it whole', () => {
			// GIVEN a normal failure
			const cause = Cause.die(new Error('connection refused'))

			// WHEN rendered
			// THEN nothing is cut — the cause is the most useful thing a crash
			// leaves behind
			expect(boundedCause(cause)).toContain('connection refused')
			expect(boundedCause(cause)).not.toContain('more characters')
		})
	})
})
