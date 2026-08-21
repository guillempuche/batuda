import { ConfigProvider, Effect, Exit, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
import {
	HttpClient,
	HttpClientError,
	type HttpClientRequest,
	HttpClientResponse,
} from 'effect/unstable/http'
import { describe, expect, it } from 'vitest'

import {
	blockedReasonForCause,
	originOf,
	type ProviderEndpoint,
	probeReachability,
	type ReachabilityResult,
	reachableDetail,
	researchProviderEndpoints,
	unreachableDetail,
} from './reachability'

// The shape `fetch` really produces when a connection never arrives: a bland
// TypeError with the system code one link down. Taken from the errors a live
// run against an unresolvable name, a closed port and an expired certificate
// actually raised.
const fetchFailure = (code: string, message: string): unknown => {
	const inner = new Error(message)
	Object.assign(inner, { code })
	return new TypeError('fetch failed', { cause: inner })
}

const answeringClient = (
	sent: HttpClientRequest.HttpClientRequest[],
	status: number,
): HttpClient.HttpClient =>
	HttpClient.makeWith<
		HttpClientError.HttpClientError,
		never,
		HttpClientError.HttpClientError,
		never
	>(
		effect =>
			Effect.flatMap(effect, request => {
				sent.push(request)
				return Effect.succeed(
					HttpClientResponse.fromWeb(request, new Response(null, { status })),
				)
			}),
		Effect.succeed,
	)

const failingClient = (
	cause: unknown,
	attempts: { count: number } = { count: 0 },
): HttpClient.HttpClient =>
	HttpClient.makeWith<
		HttpClientError.HttpClientError,
		never,
		HttpClientError.HttpClientError,
		never
	>(
		effect =>
			Effect.flatMap(effect, request => {
				attempts.count += 1
				return Effect.fail(
					new HttpClientError.HttpClientError({
						reason: new HttpClientError.TransportError({ request, cause }),
					}),
				)
			}),
		Effect.succeed,
	)

const silentClient: HttpClient.HttpClient = HttpClient.makeWith<
	HttpClientError.HttpClientError,
	never,
	HttpClientError.HttpClientError,
	never
>(effect => Effect.flatMap(effect, () => Effect.never), Effect.succeed)

const GROQ: ProviderEndpoint = {
	label: 'agent slot 1 (groq)',
	origin: 'https://api.groq.com',
}
const BRAVE: ProviderEndpoint = {
	label: 'search slot 1 (brave)',
	origin: 'https://api.search.brave.com',
}

const probe = (
	endpoints: ReadonlyArray<ProviderEndpoint>,
	client: HttpClient.HttpClient,
): Promise<ReadonlyArray<ReachabilityResult>> =>
	Effect.runPromise(
		probeReachability(endpoints).pipe(
			Effect.provideService(HttpClient.HttpClient, client),
		),
	)

const resultFor = (
	results: ReadonlyArray<ReachabilityResult>,
	origin: string,
): ReachabilityResult | undefined =>
	results.find(result => result.origin === origin)

describe('what kept a request from arriving', () => {
	describe('when the vendor name does not resolve', () => {
		it('should read as a name lookup, the shape a VPN or DNS filter leaves', () => {
			// GIVEN the error a lookup that found nothing raises
			// WHEN read
			// THEN the operator is pointed at name resolution
			expect(
				blockedReasonForCause(
					fetchFailure('ENOTFOUND', 'getaddrinfo ENOTFOUND api.groq.com'),
				),
			).toBe('dns')
		})
	})

	describe('when nothing is listening', () => {
		it('should read as a refused connection', () => {
			// GIVEN a closed port
			expect(
				blockedReasonForCause(
					fetchFailure('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:54321'),
				),
			).toBe('refused')
		})
	})

	describe('when the secure connection could not be set up', () => {
		it('should read as a handshake, which is what a proxy opening traffic leaves', () => {
			// GIVEN the certificate a company proxy substitutes for the vendor's
			expect(
				blockedReasonForCause(
					fetchFailure(
						'SELF_SIGNED_CERT_IN_CHAIN',
						'self-signed certificate in certificate chain',
					),
				),
			).toBe('tls')
		})
	})

	describe('when the transport itself gave up waiting', () => {
		it('should read as a timeout', () => {
			// GIVEN a connection that never completed
			expect(
				blockedReasonForCause(
					fetchFailure('UND_ERR_CONNECT_TIMEOUT', 'Connect Timeout Error'),
				),
			).toBe('timeout')
		})
	})

	describe('when the code is only in the wording', () => {
		it('should still read it, since not every transport sets a code', () => {
			// GIVEN an error carrying the reason in its text alone
			// WHEN read — THEN the text is enough
			expect(
				blockedReasonForCause(new Error('read ECONNRESET from the socket')),
			).toBe('refused')
		})
	})

	describe('when nothing about the error is recognisable', () => {
		it('should say so rather than guess', () => {
			// GIVEN an error that names no known cause
			// THEN it is reported as unknown, which still reads as unreachable
			expect(blockedReasonForCause(new Error('something went wrong'))).toBe(
				'unknown',
			)
		})

		it('should hold up when the error is not an object at all', () => {
			// GIVEN a thrown string, and nothing thrown
			expect(blockedReasonForCause('boom')).toBe('unknown')
			expect(blockedReasonForCause(null)).toBe('unknown')
			expect(blockedReasonForCause(undefined)).toBe('unknown')
		})
	})

	describe('when an error blames itself', () => {
		it('should stop walking rather than hang', () => {
			// GIVEN a chain that points back at its own start
			const looping = new Error('outer')
			const inner = new Error('inner', { cause: looping })
			Object.assign(looping, { cause: inner })

			// WHEN read — THEN it finishes, reporting what it could tell
			expect(blockedReasonForCause(looping)).toBe('unknown')
		})
	})

	describe('when the reason is buried several links down', () => {
		it('should find it', () => {
			// GIVEN a wrapper around a wrapper around the system error
			const system = Object.assign(new Error('connect ETIMEDOUT'), {
				code: 'ETIMEDOUT',
			})
			const middle = new Error('socket hang up', { cause: system })

			// WHEN read — THEN the innermost reason decides
			expect(
				blockedReasonForCause(new TypeError('fetch failed', { cause: middle })),
			).toBe('timeout')
		})
	})
})

describe('the address a vendor is asked about', () => {
	describe('when the setting carries an API path', () => {
		it('should keep the scheme and host and drop the path', () => {
			// GIVEN a model vendor's base URL
			// WHEN reduced to what a reachability check can honestly claim
			// THEN only the host is left, so nothing implies the API path was tried
			expect(originOf('https://api.groq.com/openai/v1')).toBe(
				'https://api.groq.com',
			)
		})
	})

	describe('when the setting carries a port', () => {
		it('should keep it, since a blocked port is a different address', () => {
			expect(originOf('https://gateway.internal:8443/v1')).toBe(
				'https://gateway.internal:8443',
			)
		})
	})

	describe('when the setting is not an address at all', () => {
		it('should give nothing back rather than invent one', () => {
			// GIVEN a mistyped base URL
			// THEN there is no host to ask about, so nothing is probed for it
			expect(originOf('not a url')).toBeUndefined()
			expect(originOf('')).toBeUndefined()
		})
	})
})

describe('how an answer is put to the operator', () => {
	describe('when the vendor turned the key-less probe away', () => {
		it('should call it reachable and rule the key out in the same breath', () => {
			// GIVEN the one answer somebody could misread as their key being wrong
			const detail = reachableDetail('https://api.groq.com', 401)

			// WHEN read
			// THEN it says the connection got there
			expect(detail).toContain('reachable')
			// AND it says the probe carried no key, so the refusal was expected
			expect(detail).toContain('no key')
			// AND it says outright that the key is not what this reports on
			expect(detail).toContain('says nothing about whether your key works')
		})

		it('should say the same for a forbidden answer', () => {
			// GIVEN 403, the other answer a key-less request draws
			expect(reachableDetail('https://api.groq.com', 403)).toContain(
				'says nothing about whether your key works',
			)
		})
	})

	describe('when the vendor answered anything else', () => {
		it('should just report the answer', () => {
			// GIVEN an ordinary answer — no key to rule out, so nothing to explain
			const detail = reachableDetail('https://api.groq.com', 404)
			expect(detail).toContain('reachable')
			expect(detail).toContain('404')
			expect(detail).not.toContain('key')
		})
	})

	describe('when nothing answered', () => {
		it('should blame the connection and rule the key out', () => {
			// GIVEN a name that would not resolve
			const detail = unreachableDetail('https://api.groq.com', 'dns')

			// WHEN read
			// THEN it names the host and what happened to it
			expect(detail).toContain('cannot be reached from this machine')
			expect(detail).toContain('api.groq.com')
			// AND it names the connection as the thing to go and fix
			expect(detail).toContain('your connection')
			expect(detail).toContain('VPN')
			// AND it forecloses the other reading rather than leaving it open
			expect(detail).toContain('not your key')
		})
	})
})

describe('asking whether this machine can reach a vendor', () => {
	describe('when a vendor turns away a request carrying no key', () => {
		it('should report it reachable — being turned away proves arrival', async () => {
			// GIVEN a vendor that answers 401 to anything without a key
			const results = await probe([GROQ], answeringClient([], 401))

			// WHEN asked
			// THEN the connection is reported as working, and the answer is kept
			expect(results[0]?.verdict).toBe('reachable')
			expect(results[0]?.status).toBe(401)
			expect(results[0]?.blockedReason).toBeUndefined()
		})
	})

	describe('when a rejected key and a blocked connection are both in play', () => {
		it('should tell them apart, since they have nothing in common to fix', async () => {
			// GIVEN one vendor that refuses a key-less request and one this machine
			// cannot get to at all — the two failures that look identical once a
			// pass is under way
			const refusing = await probe([GROQ], answeringClient([], 401))
			const unreachable = await probe(
				[BRAVE],
				failingClient(fetchFailure('ENOTFOUND', 'getaddrinfo ENOTFOUND')),
			)

			// WHEN both are asked
			// THEN the verdicts differ, so no reader has to interpret wording
			expect(refusing[0]?.verdict).toBe('reachable')
			expect(unreachable[0]?.verdict).toBe('unreachable')

			// AND only the one that arrived carries an answer from the vendor
			expect(refusing[0]?.status).toBe(401)
			expect(unreachable[0]?.status).toBeUndefined()

			// AND only the one that never arrived carries a reason to go and look at
			expect(refusing[0]?.blockedReason).toBeUndefined()
			expect(unreachable[0]?.blockedReason).toBe('dns')

			// AND neither line can be read as the other: the refusal says the key is
			// not what it reports on, and the blocked one rules the key out
			expect(refusing[0]?.detail).toContain(
				'says nothing about whether your key works',
			)
			expect(unreachable[0]?.detail).toContain('not your key')
		})
	})

	describe('when the vendor is having a bad minute', () => {
		it.each([
			429, 500, 503,
		])('should report reachable on %i — the connection still got there', async status => {
			// GIVEN a vendor rate-limiting or falling over
			const results = await probe([GROQ], answeringClient([], status))

			// WHEN asked — THEN this check is about the connection, not the vendor's
			// health, so an answer of any kind is an answer
			expect(results[0]?.verdict).toBe('reachable')
			expect(results[0]?.status).toBe(status)
		})
	})

	describe('when the vendor answers with a redirect', () => {
		it('should report reachable without chasing it somewhere else', async () => {
			// GIVEN a host that redirects, which several real vendors do
			const sent: HttpClientRequest.HttpClientRequest[] = []
			const results = await probe([BRAVE], answeringClient(sent, 301))

			// WHEN asked
			// THEN the redirect is itself the proof the host answered
			expect(results[0]?.verdict).toBe('reachable')
			expect(results[0]?.status).toBe(301)
			// AND it was asked once, so the verdict is about the host named and not
			// about wherever the redirect points
			expect(sent).toHaveLength(1)
		})
	})

	describe('when something on this network answers in the vendor’s place', () => {
		it.each([
			407, 511,
		])('should report unreachable on %i, not a vendor that answered', async status => {
			// GIVEN a proxy or a sign-in portal intercepting the request
			const results = await probe([GROQ], answeringClient([], status))

			// WHEN asked
			// THEN the request stopped short of the vendor, so a green here would
			// be a green that is not one
			expect(results[0]?.verdict).toBe('unreachable')
			expect(results[0]?.blockedReason).toBe('proxy')
			expect(results[0]?.status).toBeUndefined()
		})
	})

	describe('when the connection is cut in different ways', () => {
		it.each([
			['ECONNREFUSED', 'refused'],
			['CERT_HAS_EXPIRED', 'tls'],
			['EHOSTUNREACH', 'refused'],
		])('should carry %s through as %s', async (code, reason) => {
			// GIVEN each of the shapes a blocked connection takes
			const results = await probe(
				[GROQ],
				failingClient(fetchFailure(code, code)),
			)

			// WHEN asked — THEN the reason survives to the line the operator reads
			expect(results[0]?.verdict).toBe('unreachable')
			expect(results[0]?.blockedReason).toBe(reason)
		})
	})

	describe('what the probe actually sends', () => {
		it('should send a HEAD carrying no key, so there is nothing to bill', async () => {
			// GIVEN a vendor about to be asked
			const sent: HttpClientRequest.HttpClientRequest[] = []
			await probe([GROQ], answeringClient(sent, 200))

			// WHEN the request goes out
			// THEN it asks for no body, so no page is transferred
			expect(sent[0]?.method).toBe('HEAD')
			// AND it carries no key, so there is no account for a vendor to charge
			// and no answer that could be a verdict on one
			expect(sent[0]?.headers['authorization']).toBeUndefined()
			// AND it goes to the host, not to an API path
			expect(sent[0]?.url).toBe('https://api.groq.com')
		})
	})

	describe('when several parts of the pipeline share one vendor', () => {
		it('should ask that host once and name every part that uses it', async () => {
			// GIVEN all three model tiers pointed at the same vendor
			const sent: HttpClientRequest.HttpClientRequest[] = []
			const results = await probe(
				[
					GROQ,
					{ label: 'extract slot 1 (groq)', origin: 'https://api.groq.com' },
					{ label: 'writer slot 1 (groq)', origin: 'https://api.groq.com' },
					BRAVE,
				],
				answeringClient(sent, 200),
			)

			// WHEN asked
			// THEN each host is asked once rather than once per part
			expect(sent).toHaveLength(2)
			expect(results).toHaveLength(2)
			// AND the one line for that host names everything behind it
			expect(resultFor(results, 'https://api.groq.com')?.labels).toEqual([
				'agent slot 1 (groq)',
				'extract slot 1 (groq)',
				'writer slot 1 (groq)',
			])
		})
	})

	describe('when nothing is pointed at a vendor', () => {
		it('should ask nothing', async () => {
			// GIVEN a machine whose research parts all answer from canned data
			const sent: HttpClientRequest.HttpClientRequest[] = []
			const results = await probe([], answeringClient(sent, 200))

			// WHEN asked — THEN there is nothing to reach, so nothing is reached for
			expect(results).toEqual([])
			expect(sent).toEqual([])
		})
	})

	describe('when a vendor never answers at all', () => {
		it('should give up and report it unreachable rather than wait', async () => {
			// GIVEN a host that accepts the connection and then says nothing —
			// the shape a silent drop on a VPN takes
			const exit = await Effect.runPromise(
				Effect.gen(function* () {
					const fiber = yield* Effect.forkChild(
						probeReachability([GROQ]).pipe(
							Effect.provideService(HttpClient.HttpClient, silentClient),
						),
					)
					// Step the clock forward until the probe's patience runs out.
					for (let elapsed = 0; elapsed < 30_000; elapsed += 500) {
						if (fiber.pollUnsafe() !== undefined) break
						yield* Effect.yieldNow
						yield* TestClock.adjust('500 millis')
					}
					return yield* Fiber.await(fiber)
				}).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
			)

			// WHEN the wait is over
			// THEN it is reported as unreachable, not left holding up the check
			expect(Exit.isSuccess(exit)).toBe(true)
			if (Exit.isSuccess(exit)) {
				expect(exit.value[0]?.verdict).toBe('unreachable')
				expect(exit.value[0]?.blockedReason).toBe('timeout')
			}
		})
	})
})

describe('which vendor hosts a run would reach', () => {
	const read = (env: Record<string, string>) =>
		Effect.runPromise(
			researchProviderEndpoints().pipe(
				Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
			),
		)

	const LIVE = {
		RESEARCH_LLM_AGENT_PROVIDERS: 'groq',
		RESEARCH_LLM_AGENT_MODEL: 'openai/gpt-oss-120b',
		RESEARCH_LLM_EXTRACT_PROVIDERS: 'nebius',
		RESEARCH_LLM_EXTRACT_MODEL: 'Qwen/Qwen3-32B',
		RESEARCH_LLM_WRITER_PROVIDERS: 'stub',
		RESEARCH_PROVIDER_SEARCH: 'brave',
		RESEARCH_PROVIDER_SCRAPE: 'firecrawl',
	}

	const originsOf = (endpoints: {
		readonly endpoints: ReadonlyArray<ProviderEndpoint>
	}): string[] => endpoints.endpoints.map(endpoint => endpoint.origin)

	describe('when the settings point at real vendors', () => {
		it('should name every host, model tiers and providers alike', async () => {
			// GIVEN a machine set up for a measuring pass
			const found = await read(LIVE)

			// WHEN read
			// THEN each configured vendor's host is there to be asked about
			expect(originsOf(found)).toEqual([
				'https://api.groq.com',
				'https://api.studio.nebius.ai',
				'https://api.search.brave.com',
				'https://api.firecrawl.dev',
			])
			expect(found.unreadable).toEqual([])
		})

		it('should label each host with the part that goes to it', async () => {
			// GIVEN the same settings
			const found = await read(LIVE)

			// THEN the operator can see which part a blocked host would stop
			expect(found.endpoints.map(endpoint => endpoint.label)).toContain(
				'agent slot 1 (groq)',
			)
			expect(found.endpoints.map(endpoint => endpoint.label)).toContain(
				'search slot 1 (brave)',
			)
		})
	})

	describe('when a part answers from canned data or is switched off', () => {
		it('should leave it out rather than probe it', async () => {
			// GIVEN search stubbed, site discovery off, and the writer tier stubbed
			const found = await read({
				...LIVE,
				RESEARCH_PROVIDER_SEARCH: 'stub',
				RESEARCH_PROVIDER_MAP: 'none',
			})

			// WHEN read — THEN none of them reaches a vendor, so none is asked about
			expect(originsOf(found)).not.toContain('https://api.search.brave.com')
			expect(
				found.endpoints.every(endpoint => !endpoint.label.startsWith('search')),
			).toBe(true)
			expect(
				found.endpoints.every(endpoint => !endpoint.label.startsWith('writer')),
			).toBe(true)
		})
	})

	describe('when a part falls back to a second vendor', () => {
		it('should name that host too, since a blocked fallback hides until it is needed', async () => {
			// GIVEN enrichment with a fallback behind it
			const found = await read({
				...LIVE,
				RESEARCH_PROVIDER_ENRICH: 'hunter,fullenrich',
			})

			// WHEN read — THEN both are there, numbered so the operator knows which
			// one a run reaches first
			expect(originsOf(found)).toContain('https://api.hunter.io')
			expect(originsOf(found)).toContain('https://app.fullenrich.com')
			expect(found.endpoints.map(endpoint => endpoint.label)).toContain(
				'enrich slot 2 (fullenrich)',
			)
		})
	})

	describe('when a machine was never set up for research at all', () => {
		it('should come back empty rather than failing or complaining', async () => {
			// GIVEN nothing configured — the normal state for somebody who never
			// runs research, and one `doctor` must survive
			const found = await read({})

			// WHEN read
			// THEN there is nothing to probe and nothing is at fault, so the check
			// has nothing to say rather than something to warn about
			expect(found.endpoints).toEqual([])
			expect(found.unreadable).toEqual([])
		})
	})

	describe('when only one part of the pipeline is configured', () => {
		it('should still name that part’s host, not lose it with the unset ones', async () => {
			// GIVEN enrichment alone, which is what a machine set up for contact
			// discovery looks like: it is handed a domain and never searches, so
			// search and scrape are left unset
			const found = await read({ RESEARCH_PROVIDER_ENRICH: 'hunter' })

			// WHEN read — THEN the vendor that IS configured is reported, instead of
			// vanishing behind the settings nobody wrote
			expect(originsOf(found)).toEqual(['https://api.hunter.io'])
			expect(found.unreadable).toEqual([])
		})

		it('should keep the model tiers that are set when another tier is not', async () => {
			// GIVEN the two tiers an eval measures through, with the writer tier —
			// which nothing here scores — left unset
			const found = await read({
				RESEARCH_LLM_AGENT_PROVIDERS: 'groq',
				RESEARCH_LLM_AGENT_MODEL: 'openai/gpt-oss-120b',
				RESEARCH_LLM_EXTRACT_PROVIDERS: 'groq',
				RESEARCH_LLM_EXTRACT_MODEL: 'openai/gpt-oss-120b',
			})

			// WHEN read — THEN both configured tiers are reported; the unset one
			// costs only itself
			expect(found.endpoints.map(endpoint => endpoint.label)).toEqual([
				'agent slot 1 (groq)',
				'extract slot 1 (groq)',
			])
			expect(found.unreadable).toEqual([])
		})
	})

	describe('when a setting was written and will not read', () => {
		it('should name that part as at fault and keep the rest', async () => {
			// GIVEN a mistyped vendor name beside settings that are fine
			const found = await read({
				...LIVE,
				RESEARCH_PROVIDER_SEARCH: 'firecrwal',
			})

			// WHEN read
			// THEN the broken part is named, so a typo cannot pass for a machine
			// nobody configured
			expect(found.unreadable.map(part => part.part)).toEqual([
				'the search vendor',
			])
			expect(found.unreadable[0]?.detail).toContain('RESEARCH_PROVIDER_SEARCH')
			// AND every other vendor is still reported, so one bad value does not
			// hide the ones that are right
			expect(originsOf(found)).toEqual([
				'https://api.groq.com',
				'https://api.studio.nebius.ai',
				'https://api.firecrawl.dev',
			])
		})

		it('should name a model tier whose address is not a web address', async () => {
			// GIVEN a custom vendor pointed at something that will not parse
			const found = await read({
				...LIVE,
				RESEARCH_LLM_WRITER_PROVIDERS: 'custom',
				RESEARCH_LLM_WRITER_MODEL: 'some-model',
				RESEARCH_LLM_WRITER_BASE_URL: 'api.example.com/v1',
			})

			// WHEN read
			// THEN the slot is called out rather than quietly dropped, or a tier
			// nobody checked would read as one that passed
			expect(found.unreadable.map(part => part.part)).toEqual([
				'the writer model tier (slot 1)',
			])
			// AND the address itself stays out of the message, since an operator's
			// own gateway can carry anything in its query string
			expect(found.unreadable[0]?.detail).not.toContain('api.example.com')
		})
	})
})

describe('the company registers a run would reach', () => {
	const read = (env: Record<string, string>) =>
		Effect.runPromise(
			researchProviderEndpoints().pipe(
				Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
			),
		)

	describe('when a country names a real register', () => {
		it('should ask about it too, since a register can be blocked on its own', async () => {
			// GIVEN the Spanish register live, which is how production runs
			const found = await read({ RESEARCH_PROVIDER_REGISTRY_ES: 'librebor' })

			// WHEN read — THEN its host is there to be asked about, labelled by the
			// country so a blocked one names the lookups it would stop
			expect(found.endpoints).toEqual([
				{
					label: 'registry ES slot 1 (librebor)',
					origin: 'https://api.librebor.me',
				},
			])
		})
	})

	describe('when both registers are switched off', () => {
		it('should ask about nothing', async () => {
			// GIVEN both countries switched off, the way a pass that measures quality
			// is run
			const found = await read({
				RESEARCH_PROVIDER_REGISTRY_ES: 'none',
				RESEARCH_PROVIDER_REGISTRY_GB: 'none',
			})

			// WHEN read — THEN neither reaches a register, so neither is probed
			expect(found.endpoints).toEqual([])
			expect(found.unreadable).toEqual([])
		})
	})

	describe('when one country’s setting will not read', () => {
		it('should name that country and keep the other', async () => {
			// GIVEN a mistyped register for Spain beside a working British one
			const found = await read({
				RESEARCH_PROVIDER_REGISTRY_ES: 'libreborme',
				RESEARCH_PROVIDER_REGISTRY_GB: 'companies-house',
			})

			// WHEN read — THEN Spain is named as at fault and Britain still reports
			expect(found.unreadable.map(part => part.part)).toEqual([
				'the ES company register',
			])
			expect(found.endpoints.map(endpoint => endpoint.origin)).toEqual([
				'https://api.company-information.service.gov.uk',
			])
		})
	})
})

describe('asking a vendor host a second time', () => {
	// One failure and then answers, with the count kept where a test can read it:
	// how many times the probe asked is the thing being checked.
	const flakyClient = (
		attempts: { count: number },
		firstFailure: unknown,
	): HttpClient.HttpClient =>
		HttpClient.makeWith<
			HttpClientError.HttpClientError,
			never,
			HttpClientError.HttpClientError,
			never
		>(
			effect =>
				Effect.flatMap(effect, request => {
					attempts.count += 1
					return attempts.count === 1
						? Effect.fail(
								new HttpClientError.HttpClientError({
									reason: new HttpClientError.TransportError({
										request,
										cause: firstFailure,
									}),
								}),
							)
						: Effect.succeed(
								HttpClientResponse.fromWeb(
									request,
									new Response(null, { status: 200 }),
								),
							)
				}),
			Effect.succeed,
		)

	// Steps the clock through the pause between the two tries, so none of it is
	// waited out in real time.
	const probeOnTestClock = (client: HttpClient.HttpClient) =>
		Effect.runPromise(
			Effect.gen(function* () {
				const fiber = yield* Effect.forkChild(
					probeReachability([GROQ]).pipe(
						Effect.provideService(HttpClient.HttpClient, client),
					),
				)
				for (let elapsed = 0; elapsed < 30_000; elapsed += 100) {
					if (fiber.pollUnsafe() !== undefined) break
					yield* Effect.yieldNow
					yield* TestClock.adjust('100 millis')
				}
				return yield* Fiber.await(fiber)
			}).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
		)

	describe('when a vendor drops one connection and then answers', () => {
		it('should ask again before calling a working vendor blocked', async () => {
			// GIVEN a host that fails one lookup and answers the next
			const attempts = { count: 0 }
			const exit = await probeOnTestClock(
				flakyClient(
					attempts,
					fetchFailure('EAI_AGAIN', 'getaddrinfo EAI_AGAIN'),
				),
			)

			// WHEN asked
			// THEN the second try decides, so a dropped packet does not teach the
			// operator to ignore a vendor called blocked
			expect(Exit.isSuccess(exit)).toBe(true)
			if (Exit.isSuccess(exit)) {
				expect(exit.value[0]?.verdict).toBe('reachable')
				expect(exit.value[0]?.status).toBe(200)
			}
			expect(attempts.count).toBe(2)
		})
	})

	describe('when the first answer will not change between tries', () => {
		it('should take it at its word and not ask twice', async () => {
			// GIVEN a certificate that will not verify, which is the certificate a
			// second try would meet as well
			const attempts = { count: 0 }
			const results = await probe(
				[GROQ],
				failingClient(
					fetchFailure('CERT_HAS_EXPIRED', 'certificate has expired'),
					attempts,
				),
			)

			// WHEN asked — THEN it is reported on the first answer, so a refusal that
			// nothing is going to change costs no extra wait
			expect(results[0]?.blockedReason).toBe('tls')
			expect(attempts.count).toBe(1)
		})
	})

	describe('when both tries fail', () => {
		it('should still report the vendor unreachable', async () => {
			// GIVEN a host that refuses the connection every time
			const exit = await probeOnTestClock(
				failingClient(fetchFailure('ECONNREFUSED', 'connect ECONNREFUSED')),
			)

			// WHEN asked — THEN a real block survives the second try
			expect(Exit.isSuccess(exit)).toBe(true)
			if (Exit.isSuccess(exit)) {
				expect(exit.value[0]?.verdict).toBe('unreachable')
				expect(exit.value[0]?.blockedReason).toBe('refused')
			}
		})
	})
})
