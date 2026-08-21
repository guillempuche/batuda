/**
 * Can this machine talk to the vendors a research pass is pointed at?
 *
 * A pass over the full golden set costs real money and runs for hours, and it
 * reaches several outside services on the way — the model vendors, the web
 * search, the page fetcher. On some connections one of them is simply not
 * reachable: a VPN, a company proxy or a DNS filter drops it, and once a run is
 * under way that reads exactly like the vendor being down.
 *
 * So this check exists to keep apart two failures that look identical from
 * inside a run and have nothing in common to fix:
 *
 *   - the connection cannot get there at all — a VPN, a proxy, a DNS filter;
 *   - the connection gets there fine and the vendor refuses the key.
 *
 * The probe therefore carries **no key**. Any HTTP answer at all counts as
 * reachable, 401 and 403 included: being turned away proves the request
 * arrived, and a key-less request is *supposed* to be turned away, so that
 * answer says nothing whatever about the operator's key. Only a name that will
 * not resolve, a refused connection, a failed handshake or silence is the
 * blocked-connection symptom, and only that is reported as one. No key also
 * means no account for a vendor to bill, so the check is free however often it
 * runs.
 *
 * A green result claims that this machine reached the host and nothing more: a
 * content delivery network can answer while the API behind it is blocked,
 * reaching the host does not prove the endpoint a run calls will answer, and
 * whether a key is valid or has allowance left is a separate question with its
 * own check.
 */

import { Cause, type Config, Effect } from 'effect'
import {
	FetchHttpClient,
	HttpClient,
	HttpClientRequest,
} from 'effect/unstable/http'

import { REGISTRY_COUNTRIES, type RegistryCountry } from '../domain/country'
import type { LlmTier } from './cached-llm'
import {
	type ConfiguredSlot,
	configuredSlotsIfSet,
	LLM_TIERS,
} from './llm-live'
import {
	configuredCapabilityEndpoints,
	configuredRegistryEndpoints,
	RESEARCH_CAPABILITIES,
	type ResearchCapability,
} from './providers-live'

/** Did the request reach the vendor at all? */
export type ReachabilityVerdict =
	/** An HTTP answer came back. Whatever it said, the connection got there. */
	| 'reachable'
	/** Nothing answered. This machine's connection is what is in the way. */
	| 'unreachable'

/** What stopped the request from arriving. */
export type BlockedReason =
	/** The vendor's name does not resolve here — the classic VPN/DNS-filter shape. */
	| 'dns'
	/** Something answered the socket with a refusal or a reset. */
	| 'refused'
	/** Nothing came back before the check gave up. */
	| 'timeout'
	/** The secure connection could not be set up — often a proxy opening traffic. */
	| 'tls'
	/** Something on this network answered in the vendor's place and stopped there. */
	| 'proxy'
	/** A transport failure that fits none of the above. */
	| 'unknown'

/** One vendor a run is configured to reach, and where it answers. */
export interface ProviderEndpoint {
	/** Which part of the pipeline this is, in the operator's words. */
	readonly label: string
	/** Scheme and host only — see `originOf`. */
	readonly origin: string
}

/** Whether one vendor host can be reached from here, and what says so. */
export interface ReachabilityResult {
	readonly origin: string
	/** Every part of the pipeline that goes to this host. */
	readonly labels: ReadonlyArray<string>
	readonly verdict: ReachabilityVerdict
	/** The HTTP status that proved the connection got there. Reachable only. */
	readonly status?: number
	/** What was in the way. Unreachable only. */
	readonly blockedReason?: BlockedReason
	/** One line for a human, worded so the two failures cannot be swapped. */
	readonly detail: string
}

/** A part whose setting was written and will not read, so nothing was probed. */
export interface UnreadablePart {
	/** Which part of the pipeline, in the operator's words. */
	readonly part: string
	/** What is wrong with its setting, in the words of whatever refused it. */
	readonly detail: string
}

/** The vendor hosts a run would reach, and any settings that would not read. */
export interface ProviderEndpoints {
	readonly endpoints: ReadonlyArray<ProviderEndpoint>
	/**
	 * A part nobody set at all is not in here: it reaches nothing by design,
	 * which is the normal state on a machine that never runs research. Only a
	 * setting somebody wrote and got wrong lands here, which is a fault.
	 */
	readonly unreadable: ReadonlyArray<UnreadablePart>
}

// Long enough that a vendor answering slowly over a busy link is not called
// blocked, short enough that a machine cut off from four vendors is not left
// waiting — the probes go out together, so this is the whole wait, not each.
const PROBE_TIMEOUT = '5 seconds'

// Which system codes mean what. A failed connection reports itself in one of
// these, either as a `code` on the error or buried in its text, and which one
// decides what the operator is told to go and look at.
const BLOCKED_CODES: ReadonlyArray<
	readonly [BlockedReason, ReadonlyArray<string>]
> = [
	[
		'dns',
		[
			'ENOTFOUND',
			'EAI_AGAIN',
			'EAI_FAIL',
			'EAI_NODATA',
			'ERR_NAME_NOT_RESOLVED',
		],
	],
	[
		'refused',
		[
			'ECONNREFUSED',
			'ECONNRESET',
			'ECONNABORTED',
			'EHOSTUNREACH',
			'ENETUNREACH',
			'ENETDOWN',
			'EPIPE',
			'UND_ERR_SOCKET',
		],
	],
	[
		'timeout',
		[
			'ETIMEDOUT',
			'ERR_SOCKET_CONNECTION_TIMEOUT',
			'UND_ERR_CONNECT_TIMEOUT',
			'UND_ERR_HEADERS_TIMEOUT',
			'UND_ERR_BODY_TIMEOUT',
		],
	],
	[
		'tls',
		[
			'EPROTO',
			'ERR_TLS_CERT_ALTNAME_INVALID',
			'ERR_SSL_WRONG_VERSION_NUMBER',
			'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
			'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
			'DEPTH_ZERO_SELF_SIGNED_CERT',
			'SELF_SIGNED_CERT_IN_CHAIN',
			'CERT_HAS_EXPIRED',
		],
	],
]

// The error and everything it blames, innermost last. `fetch` reports a dropped
// connection as a bland "fetch failed" and hides the system code one link down,
// so the reason is never in the outermost error alone. Bounded, and it stops on
// a repeat, because an error chain is free to point back at itself.
const causeChain = (error: unknown): ReadonlyArray<Record<string, unknown>> => {
	const links: Record<string, unknown>[] = []
	let current = error
	while (links.length < 8 && current !== null && typeof current === 'object') {
		const link = current as Record<string, unknown>
		if (links.includes(link)) break
		links.push(link)
		current = link['cause']
	}
	return links
}

const stringsAt = (
	links: ReadonlyArray<Record<string, unknown>>,
	field: string,
): ReadonlyArray<string> =>
	links
		.map(link => link[field])
		.filter((value): value is string => typeof value === 'string')

/**
 * What kept the request from arriving, read off the error the transport raised.
 *
 * Codes decide first, because a code is the transport stating the reason
 * outright. Only when there is none does the text get read, which some versions
 * of `fetch` leave as the sole trace of the same thing.
 */
export const blockedReasonForCause = (error: unknown): BlockedReason => {
	const links = causeChain(error)
	const codes = new Set(stringsAt(links, 'code'))
	for (const [reason, known] of BLOCKED_CODES) {
		if (known.some(code => codes.has(code))) return reason
	}
	const text = stringsAt(links, 'message').join(' ')
	for (const [reason, known] of BLOCKED_CODES) {
		if (known.some(code => text.includes(code))) return reason
	}
	return 'unknown'
}

/**
 * Scheme and host of a vendor's address, dropping the path: the check can
 * honestly claim no more than that the host was reached, so the API path a run
 * really calls is left out rather than implied.
 */
export const originOf = (baseUrl: string): string | undefined => {
	try {
		return new URL(baseUrl).origin
	} catch {
		return undefined
	}
}

/** The bare host, for naming a vendor without the scheme in front of it. */
export const hostOf = (origin: string): string => {
	try {
		return new URL(origin).host
	} catch {
		return origin
	}
}

const BLOCKED_PHRASES: Record<BlockedReason, (host: string) => string> = {
	dns: host => `the name ${host} does not resolve on this machine`,
	refused: host => `the connection to ${host} was refused`,
	timeout: host => `${host} did not answer within ${PROBE_TIMEOUT}`,
	tls: host => `the secure connection to ${host} could not be set up`,
	proxy: host =>
		`a proxy or a sign-in portal on this network answered in place of ${host}`,
	unknown: host => `nothing came back from ${host}`,
}

// 407 is a proxy asking to be signed into and 511 a sign-in portal doing the
// same: something on this network answering in the vendor's place. Counting
// either as the vendor answering would report a green that is not one — the very
// mistake this check exists to prevent.
const ANSWERED_BY_THE_NETWORK = new Set([407, 511])

/**
 * A refusal is spelled out rather than merely counted as reachable, because 401
 * is the one answer somebody could misread as their key being wrong — and the
 * probe carried no key, so it is the answer it was always going to get.
 */
export const reachableDetail = (origin: string, status: number): string =>
	status === 401 || status === 403
		? `reachable — ${hostOf(origin)} answered ${status} to a request carrying no key, which is the answer a request carrying no key should get. It says nothing about whether your key works.`
		: `reachable — ${hostOf(origin)} answered ${status}.`

/**
 * The connection is named as the thing at fault and the key ruled out in the
 * same breath, because those are the two an operator has to choose between and
 * they have nothing in common to fix.
 */
export const unreachableDetail = (
	origin: string,
	reason: BlockedReason,
): string =>
	`cannot be reached from this machine — ${BLOCKED_PHRASES[reason](hostOf(origin))}. No key was sent, so this is your connection (a VPN, a proxy or a DNS filter), not your key.`

const blocked = (
	origin: string,
	labels: ReadonlyArray<string>,
	reason: BlockedReason,
): ReachabilityResult => ({
	origin,
	labels,
	verdict: 'unreachable',
	blockedReason: reason,
	detail: unreachableDetail(origin, reason),
})

// A HEAD to the host, carrying nothing: no key to bill or to be read as a
// verdict on one, and no body to drain. Redirects are left unfollowed on
// purpose — a redirect is itself proof the host answered, and chasing one would
// report on whichever host it points at instead of the one being asked about.
const probeOrigin = (
	origin: string,
	labels: ReadonlyArray<string>,
): Effect.Effect<ReachabilityResult, never, HttpClient.HttpClient> =>
	Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient
		const response = yield* client.execute(HttpClientRequest.head(origin))
		if (ANSWERED_BY_THE_NETWORK.has(response.status)) {
			return blocked(origin, labels, 'proxy')
		}
		return {
			origin,
			labels,
			verdict: 'reachable' as const,
			status: response.status,
			detail: reachableDetail(origin, response.status),
		}
	}).pipe(
		Effect.provideService(FetchHttpClient.RequestInit, { redirect: 'manual' }),
		// Squashed first: the reason lives on the error the transport raised, and
		// the wrapper around it carries none of it.
		Effect.catchCause(cause =>
			Effect.succeed(
				blocked(origin, labels, blockedReasonForCause(Cause.squash(cause))),
			),
		),
		Effect.timeoutOrElse({
			duration: PROBE_TIMEOUT,
			orElse: () => Effect.succeed(blocked(origin, labels, 'timeout')),
		}),
	)

// Answers that asking again would only repeat: a proxy answering in the
// vendor's place and a certificate that will not verify are both decisions
// something made about this request, not accidents of the moment.
const SETTLED_REASONS: ReadonlyArray<BlockedReason> = ['proxy', 'tls']

// Long enough for a dropped packet to be past, short enough that nobody notices
// it on a host that answers.
const RETRY_PAUSE = '200 millis'

// One dropped connection is not a blocked connection, and a vendor called
// blocked that is fine on the next look teaches an operator to ignore the
// answer. The second try only ever runs on a host that has already failed to
// answer, so a machine whose vendors are all reachable waits no longer for it.
const probeOriginTwice = (
	origin: string,
	labels: ReadonlyArray<string>,
): Effect.Effect<ReachabilityResult, never, HttpClient.HttpClient> =>
	probeOrigin(origin, labels).pipe(
		Effect.flatMap(first =>
			first.verdict === 'reachable' ||
			(first.blockedReason !== undefined &&
				SETTLED_REASONS.includes(first.blockedReason))
				? Effect.succeed(first)
				: Effect.sleep(RETRY_PAUSE).pipe(
						Effect.andThen(probeOrigin(origin, labels)),
					),
		),
	)

/**
 * Ask each vendor host whether this machine can reach it. Never fails: an
 * unreachable vendor is the answer, not an error.
 *
 * Hosts are asked once each however many parts of the pipeline share one — the
 * three model tiers commonly sit on the same vendor — and they are asked at the
 * same time, so a machine cut off from four vendors waits for one timeout
 * rather than four.
 */
export const probeReachability = (
	endpoints: ReadonlyArray<ProviderEndpoint>,
): Effect.Effect<
	ReadonlyArray<ReachabilityResult>,
	never,
	HttpClient.HttpClient
> => {
	const byOrigin = new Map<string, string[]>()
	for (const endpoint of endpoints) {
		const labels = byOrigin.get(endpoint.origin)
		if (labels === undefined) byOrigin.set(endpoint.origin, [endpoint.label])
		else labels.push(endpoint.label)
	}
	return Effect.forEach(
		[...byOrigin],
		([origin, labels]) => probeOriginTwice(origin, labels),
		{ concurrency: 'unbounded' },
	)
}

// Whatever refused the setting is free to lay its complaint out over several
// lines; `doctor` prints a row per line, so it is folded back into one.
const nothingFrom = (part: string, detail: string): ProviderEndpoints => ({
	endpoints: [],
	unreadable: [{ part, detail: detail.replace(/\s+/g, ' ').trim() }],
})

const together = (
	parts: ReadonlyArray<ProviderEndpoints>,
): ProviderEndpoints => ({
	endpoints: parts.flatMap(part => part.endpoints),
	unreadable: parts.flatMap(part => part.unreadable),
})

const oneEndpoint = (label: string, origin: string): ProviderEndpoints => ({
	endpoints: [{ label, origin }],
	unreadable: [],
})

// A slot whose address will not parse is called out rather than quietly
// dropped, or the operator would read a tier nobody checked as one that passed.
// The address itself is left out of the message: an operator's own gateway can
// carry anything in its query string.
const fromSlot = (slot: ConfiguredSlot): ProviderEndpoints => {
	const origin = originOf(slot.baseUrl)
	return origin === undefined
		? nothingFrom(
				`the ${slot.tier} model tier (slot ${slot.slot})`,
				'its address does not read as a web address',
			)
		: oneEndpoint(`${slot.tier} slot ${slot.slot} (${slot.vendor})`, origin)
}

// Each part is read on its own so a setting somebody got wrong costs only its
// own row. Read together, one bad value would take down the parts beside it —
// and the parts a pass leans on hardest are exactly the ones that would go.
const readPart = <A>(
	part: string,
	configured: Effect.Effect<ReadonlyArray<A>, Config.ConfigError>,
	toEndpoints: (entry: A) => ProviderEndpoints,
): Effect.Effect<ProviderEndpoints> =>
	configured.pipe(
		Effect.map(entries => together(entries.map(toEndpoints))),
		Effect.catch(error => Effect.succeed(nothingFrom(part, error.message))),
	)

// A tier nobody named a vendor for reads as reaching nothing rather than as a
// fault: leaving a tier unset is the ordinary state, so calling it a broken
// setting would be a false alarm.
const fromTier = (tier: LlmTier): Effect.Effect<ProviderEndpoints> =>
	readPart(`the ${tier} model tier`, configuredSlotsIfSet(tier), fromSlot)

const fromCapability = (
	capability: ResearchCapability,
): Effect.Effect<ProviderEndpoints> =>
	readPart(
		`the ${capability} vendor`,
		configuredCapabilityEndpoints([capability]),
		entry =>
			oneEndpoint(
				`${entry.capability} slot ${entry.slot} (${entry.vendor})`,
				entry.origin,
			),
	)

const fromRegistry = (
	country: RegistryCountry,
): Effect.Effect<ProviderEndpoints> =>
	readPart(
		`the ${country} company register`,
		configuredRegistryEndpoints([country]),
		entry =>
			oneEndpoint(
				`registry ${entry.country} slot ${entry.slot} (${entry.vendor})`,
				entry.origin,
			),
	)

/**
 * Every vendor host the research settings point at, read the same way a run
 * reads them so the check is about the vendors a run would really use.
 *
 * A part answered by canned data, switched off, or never set reaches nothing,
 * so it is left out rather than probed.
 */
export const researchProviderEndpoints = (): Effect.Effect<ProviderEndpoints> =>
	Effect.all([
		...LLM_TIERS.map(fromTier),
		...RESEARCH_CAPABILITIES.map(fromCapability),
		...REGISTRY_COUNTRIES.map(fromRegistry),
	]).pipe(Effect.map(together))
