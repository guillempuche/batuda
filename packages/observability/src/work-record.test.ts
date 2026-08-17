// A question like "how long did it take, split by how they signed in" can only
// be answered when both facts sit on one line. These pin that facts reported
// from anywhere in a piece of work reach its record — and that code reporting a
// fact with nobody gathering it carries on quietly instead of failing.

import { Effect, Option, Tracer } from 'effect'
import { describe, expect, it } from 'vitest'

import { makeWorkRecord, recordFacts, WorkRecord } from './work-record'

describe('work record', () => {
	describe('when facts are reported from several places', () => {
		it('should hold all of them together', async () => {
			// GIVEN an open record
			const facts = await Effect.runPromise(
				Effect.gen(function* () {
					const record = yield* makeWorkRecord

					// WHEN separate parts of the work each report what they learned
					yield* record.add({ 'http.method': 'GET' })
					yield* record.add({ 'auth.method': 'api_key' })
					yield* record.add({ 'org.id': 'org_123' })

					return yield* record.read
				}),
			)

			// THEN one read gives back the whole story, not three fragments
			expect(facts).toEqual({
				'http.method': 'GET',
				'auth.method': 'api_key',
				'org.id': 'org_123',
			})
		})

		it('should keep the newest value when the same fact is reported twice', async () => {
			// GIVEN a fact that is refined as the work goes on
			const facts = await Effect.runPromise(
				Effect.gen(function* () {
					const record = yield* makeWorkRecord

					// WHEN it is reported again with a better value
					yield* record.add({ 'research.model': 'guess' })
					yield* record.add({ 'research.model': 'the-one-that-answered' })

					return yield* record.read
				}),
			)

			// THEN the later value wins, so the line says what actually happened
			expect(facts['research.model']).toBe('the-one-that-answered')
		})
	})

	describe('when two pieces of work run at once', () => {
		it('should keep their facts apart', async () => {
			// GIVEN two records, as two requests in flight would have
			const [first, second] = await Effect.runPromise(
				Effect.gen(function* () {
					const one = yield* makeWorkRecord
					const other = yield* makeWorkRecord

					// WHEN each records its own org
					yield* one.add({ 'org.id': 'org_one' })
					yield* other.add({ 'org.id': 'org_other' })

					return [yield* one.read, yield* other.read] as const
				}),
			)

			// THEN neither sees the other's tenant — a leak here would put one
			// customer's id on another customer's line
			expect(first).toEqual({ 'org.id': 'org_one' })
			expect(second).toEqual({ 'org.id': 'org_other' })
		})
	})

	describe('when code reports a fact', () => {
		it('should reach the record that is open around it', async () => {
			// GIVEN an open record provided to the work below it
			const facts = await Effect.runPromise(
				Effect.gen(function* () {
					const record = yield* makeWorkRecord

					// WHEN code deep in the call chain reports a fact, without being
					// handed the record itself
					yield* recordFacts({ 'auth.method': 'oauth' }).pipe(
						Effect.provideService(WorkRecord, record),
					)

					return yield* record.read
				}),
			)

			// THEN it lands on the record anyway
			expect(facts).toEqual({ 'auth.method': 'oauth' })
		})

		it('should do nothing when no record is open', async () => {
			// GIVEN work running outside any record — a background fiber, a boot
			// task, a test — where nobody is gathering

			// WHEN it reports a fact anyway
			const outcome = await Effect.runPromise(
				recordFacts({ 'auth.method': 'oauth' }).pipe(Effect.exit),
			)

			// THEN it carries on quietly, because code deep in a call chain cannot
			// know whether anyone upstream opened a record
			expect(outcome._tag).toBe('Success')
		})
	})
})

describe('recordFacts filtering', () => {
	describe('when a fact holds whatever a caller sent', () => {
		it('should keep none of it on the record either', async () => {
			// GIVEN a record open around code that reports the catch-all argument bag
			const facts = await Effect.runPromise(
				Effect.gen(function* () {
					const record = yield* makeWorkRecord

					// WHEN it is reported
					yield* recordFacts({
						tool: 'manage_email_inbox',
						parameters: { password: 'hunter2' },
					}).pipe(Effect.provideService(WorkRecord, record))

					return yield* record.read
				}),
			)

			// THEN the record is filtered the same way a span is — the record leaves
			// on a log line, so without this it would be a way around the scrubbing
			expect(JSON.stringify(facts)).not.toContain('hunter2')
			expect(facts['tool']).toBe('manage_email_inbox')
		})
	})
})

describe('work record size', () => {
	describe('when work reports a fact per item instead of per request', () => {
		it('should stop growing and say how many it turned away', async () => {
			// GIVEN a loop reporting a distinct fact many times over
			const facts = await Effect.runPromise(
				Effect.gen(function* () {
					const record = yield* makeWorkRecord
					for (let index = 0; index < 500; index++) {
						yield* record.add({ [`item.${index}`]: index })
					}
					return yield* record.read
				}),
			)

			// THEN the record stays small and admits what is missing — an unbounded
			// one would put a huge line in front of an exporter that flushes every
			// second, and the real fields would go down with it
			expect(Object.keys(facts).length).toBeLessThanOrEqual(65)
			expect(facts['record.dropped_facts']).toBeGreaterThan(400)
		})

		it('should still let a fact already on the record be refined', async () => {
			// GIVEN a record already filled to the cap
			const facts = await Effect.runPromise(
				Effect.gen(function* () {
					const record = yield* makeWorkRecord
					for (let index = 0; index < 500; index++) {
						yield* record.add({ [`item.${index}`]: index })
					}

					// WHEN a fact that is already there gets a better value
					yield* record.add({ 'item.0': 'refined' })

					return yield* record.read
				}),
			)

			// THEN the refinement lands — refining is not growing, so a full record
			// must not freeze the values already on it
			expect(facts['item.0']).toBe('refined')
		})
	})
})

describe('recordFacts on the span', () => {
	describe('when a fact is reported inside a span', () => {
		it('should reach the span as well as the record', async () => {
			// GIVEN a tracer that keeps what it was told
			const recorded = new Map<string, unknown>()
			const span = {
				_tag: 'Span',
				spanId: 'span',
				traceId: 'trace',
				name: 'test',
				sampled: true,
				parent: Option.none(),
				status: { _tag: 'Started', startTime: 0n },
				attributes: recorded,
				links: [],
				kind: 'internal',
				attribute: (key: string, value: unknown) => recorded.set(key, value),
				event: () => {},
				end: () => {},
				addLinks: () => {},
			} as unknown as Tracer.Span
			const tracer = { span: () => span } as unknown as Tracer.Tracer

			// WHEN a fact is reported inside a span
			await Effect.runPromise(
				recordFacts({ 'org.id': 'org_1' }).pipe(
					Effect.withSpan('unit-of-work'),
					Effect.provideService(Tracer.Tracer, tracer),
				),
			)

			// THEN the span carries it too — three call sites moved off
			// annotateCurrentSpan on the promise that the span half keeps working,
			// so filtering a trace by tenant must not have silently stopped
			expect(recorded.get('org.id')).toBe('org_1')
		})
	})
})
