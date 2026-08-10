import { createHash, randomUUID } from 'node:crypto'

import {
	Cause,
	Config,
	Context,
	DateTime,
	Effect,
	Fiber,
	HashMap,
	Layer,
	PartitionedSemaphore,
	PubSub,
	Queue,
	Ref,
	Schedule,
	Schema,
	Stream,
} from 'effect'
import { Prompt } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import { ResearchRun } from '@batuda/domain'

import {
	AcceptedCountry,
	parseCountryAlpha2,
	resolveRegistryCountry,
} from '../domain/country'
import {
	SNAPSHOT_COMPANY_FIELDS,
	SNAPSHOT_CONTACT_FIELDS,
} from '../domain/crm-vocabulary'
import { SubjectUnavailable } from '../domain/errors'
import type { ReasonCode, ResolvedPolicy } from '../domain/types'
import { aboutPageCandidates } from './about-pages'
import { canAffordAnotherRound, runAgentResearchLoop } from './agent-loop'
import { filterApplicableProposals } from './applicability-guard'
import { makeBudgetLayer, monthlyRemainingCents } from './budget'
import {
	groundedCitationTest,
	validateFindingCitations,
} from './citation-guard'
import { ContactDiscovery } from './contact-discovery'
import { bindContactsToEntity } from './contact-entity-guard'
import {
	ContactsRescueSchema,
	contactsRescuePrompt,
	mergeContacts,
} from './contacts-rescue'
import {
	CriticVerdictsSchema,
	criticPrompt,
	critiqueFieldSupport,
} from './critic-guard'
import {
	discoveredEntryKey,
	filterDiscoveredExisting,
	readDiscoveredEntry,
} from './discovered-existing-guard'
import {
	isDiscoveryScanEmpty,
	isRetryEligible,
	REFINE_HINT,
} from './discovery-scan'
import {
	cityGate,
	classifyEntityMatch,
	classifyEntityMatchPerSource,
	deriveAnchorHost,
	deriveEntityTargets,
	domainHost,
	type EntityMatch,
	type EntityTargets,
	groundedSourceIds,
	isConfirmedRegistryMatch,
	isEntityGroundedSchema,
	isOwnSiteHost,
	queryName,
	reachedOwnSite,
	withRedirectDomain,
} from './entity-guard'
import { classifyNamespace, guardEntitySources } from './entity-source-guard'
import { contactFill, enrichmentFill } from './extraction-fill'
import {
	FirmographicsRescueSchema,
	firmographicsRescuePrompt,
	hasHeadcountSignal,
	mergeFirmographics,
	needsFirmographicsRescue,
	needsSizeRescue,
	SizeRescueSchema,
	sizeRescuePrompt,
} from './firmographics-rescue'
import { guardFitEvidence } from './fit-evidence-guard'
import {
	type GenericEmail,
	harvestGenericEmails,
	withRoleMailbox,
} from './generic-emails'
import { type GuardLink, runGuardChain } from './guard-chain'
import { normalizePaidActionTool } from './paid-action-tool'
import {
	MAX_PER_FIELD_SEARCHES,
	mergePerFieldSearch,
	needsPerFieldSearch,
	perFieldSearchQuery,
} from './per-field-search'
import { resolvePolicy, type SystemDefaults } from './policy'
import {
	AgentLanguageModel,
	Budget,
	ExtractLanguageModel,
	MapProvider,
	RegistryRouter,
	ResearchEventSink,
	ResearchRunContext,
	ScrapeProvider,
	SearchProvider,
	WriterLanguageModel,
} from './ports'
import {
	filterProspectsByCriteria,
	prospectCriteriaFromHints,
} from './prospect-criteria-guard'
import { computeRunQuality } from './research-quality'
import { guardScalarFields } from './scalar-field-guard'
import {
	type FreeformSchema,
	schemaFieldNames,
	schemaRegistry,
} from './schemas/index'
import {
	hostOf,
	isWebAddress,
	sourceIdFor,
	urlHashForScrape,
} from './source-key'
import { recordSeenSource } from './source-record'
import { enforceSourceTier, isFirstPartyHost } from './source-tier-guard'
import { stripReasoning } from './strip-reasoning'
import {
	REGISTRY_LOOKUP_COST_CENTS,
	SCRAPE_COST_CENTS,
	SEARCH_COST_CENTS,
} from './tool-costs'
import {
	isUnsupportedScrapeUrl,
	researchToolkit,
	researchToolkitLayer,
} from './tools'
import { makeUsageMeter, UsageMeter } from './usage-meter'
import { verifyValueProvenance } from './value-guard'
import { constrainVocabulary } from './vocabulary-guard'
import { guardCompanyWebsites } from './website-guard'

// Raw Postgres rows carry `Date` timestamp columns; these decoders read each
// date from a Date (rather than an ISO string) so the decoded value lands as a
// DateTime.Utc that the wire schemas can re-encode as an ISO string. They
// mirror the ResearchRunSummary / ResearchPolicy response shapes, overriding
// only the date columns to their from-Date variant.
const ResearchRunSummaryRow = Schema.Struct({
	id: Schema.String,
	kind: Schema.String,
	query: Schema.String,
	mode: Schema.String,
	schemaName: Schema.NullOr(Schema.String),
	status: Schema.String,
	costCents: Schema.Number,
	paidCostCents: Schema.Number,
	createdBy: Schema.String,
	createdAt: Schema.DateTimeUtcFromDate,
	completedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
})
const decodeResearchRunSummaries = Schema.decodeUnknownEffect(
	Schema.Array(ResearchRunSummaryRow),
)

// The user_research_policy row; `userId` is dropped on decode (internal, not
// part of the wire shape). `updatedAt` is always present on a real row.
// `paidMonthlyCapCents` is the company's ceiling and lives on the company's
// table, so a caller has to add it to the row before decoding.
export const ResearchPolicyRow = Schema.Struct({
	budgetCents: Schema.Number,
	paidBudgetCents: Schema.Number,
	autoApprovePaidCents: Schema.Number,
	paidMonthlyCapCents: Schema.Number,
	autoApplyMinConfidence: Schema.NullOr(Schema.Number),
	updatedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
})
const decodeResearchPolicy = Schema.decodeUnknownEffect(ResearchPolicyRow)

// A finished run is flipped to 'failed' for a real error or an unexpected
// crash, but NOT when it was simply cancelled or shut down (a pure interrupt) —
// that path sets its own status. So anything that isn't purely an interrupt
// counts as a failure worth recording.
export const shouldMarkRunFailed = (cause: Cause.Cause<unknown>): boolean =>
	!Cause.hasInterruptsOnly(cause)

// What to write in the run's reason_code when the fiber ends badly. Most ways a
// run can break say nothing a reader could act on, so they share one code; the
// ones that do carry a reason name it, because "the company you asked about
// could not be read" and "something went wrong" send a person to different
// places.
export const reasonCodeFor = (cause: Cause.Cause<unknown>): ReasonCode =>
	cause.reasons.some(
		reason =>
			Cause.isFailReason(reason) &&
			typeof reason.error === 'object' &&
			reason.error !== null &&
			(reason.error as { _tag?: unknown })._tag === 'SubjectUnavailable',
	)
		? 'subject_unavailable'
		: 'internal_error'

const sha256Hex = (input: string): string =>
	createHash('sha256').update(input).digest('hex')

// Cap a tool result before it goes into the phase-1 transcript, so a large
// scraped page can't blow up the phase-2 prompt or the next round's context.
const boundedToolResult = (value: unknown, maxChars = 4000): string => {
	const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '')
	return text.length > maxChars
		? `${text.slice(0, maxChars)}…[truncated]`
		: text
}

// A run that fetched no page has nothing to ground its findings on. Below this
// many linked sources it fails closed as no_reliable_data instead of reporting
// success with fabricated findings.
const MIN_GROUNDED_SOURCES = 1

// Provider-independent backstop for the reflect-loop depth: a rough character
// budget on the accumulated prompt (which re-sends every round's tool results),
// used when the model provider omits token usage so the token budget below can't
// fire. Scrapes are capped per page but many of them still add up.
const MAX_LOOP_PROMPT_CHARS = 90000

// How much full fetched-page text phase-2 extraction may read on top of the
// transcript. The transcript caps each tool result at 4000 chars for the agent
// loop; the extractor gets the fuller pages here so a fact sitting past that cut
// (a leadership list, a tools section) still reaches the structured output.
//
// Sized to the smallest window the extract tier runs on: ~45k tokens of pages
// (this) plus the ~24k-token transcript and the schema still leave room for the
// answer inside a 128k-token model. A per-page cap keeps one very long page from
// crowding out the others, so breadth survives when the budget is tight.
const MAX_EXTRACTION_PAGE_CHARS = 180000
const MAX_EXTRACTION_CHARS_PER_PAGE = 40000

// Cap how many per-field grounding drops a run logs in detail, so a pathological
// extraction can't flood the log; the aggregate counts still cover the rest.
const MAX_LOGGED_FIELD_DROPS = 20

// How many about/contact/team pages to fetch up front from the anchor site's own
// links. Small on purpose — these carry the location and named leaders a homepage
// omits, but each is a paid scrape, so a handful is enough.
const MAX_ABOUT_PAGES = 3
// Cap on additional own-site pages fetched from the site map, over and above
// the homepage-linked seeds — enough for a team + leadership + offices spread
// without turning discovery into a full-site crawl.
const MAX_DISCOVERY_PAGES = 6
// Hard cap on the gap-closing rounds after phase 2 — each re-searches only what
// is still missing, so a thin run earns its grounding instead of shipping on
// the first pass.
const MAX_GAP_ROUNDS = 4
// Cited-but-never-fetched pages scraped per round, turning the per-source
// entity check's fail-open into a real verdict on the cited page.
const MAX_CITED_SCRAPES_PER_ROUND = 3
// How many of a round's cited scrapes / per-field searches run at once.
const GAP_ROUND_CONCURRENCY = 3
// No new gap round starts beyond this share of the run deadline.
const GAP_ROUND_DEADLINE_FRACTION = 0.8

// A research id is always a uuid. Checking the shape before a lookup — instead of
// passing an arbitrary path param straight to a uuid column — turns a bad id (a bot,
// a stale link) into a clean not-found rather than a 500-level uuid-cast SqlError.
export const isValidUuid = (id: string): boolean =>
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

// When the model finishes without the evidence confirming the target company, it
// gets this many corrective nudges to search harder before the run fails closed.
const MAX_GROUNDING_RETRIES = 1

// Appended after such a premature finish: push the model to reach the company's
// own site (or its registry) rather than answering from look-alike pages.
const GROUNDING_RETRY_INSTRUCTION =
	'You have not yet confirmed this is the right company from its own website. Before giving a final answer, use web_search to find the official website (try the company name together with its city or country), then scrape_page that site — or look up the company in the official registry. Do not answer from the pages you already have if none of them is its own official site.'

// When an enrichment run finishes without having gathered any employee-count
// signal, it gets this many nudges to search for the headcount before ending — the
// figure is rarely on the company's homepage, so a run that stops there leaves
// size_range empty.
const MAX_HEADCOUNT_RETRIES = 1

// Appended after such a finish: push the model to search for the headcount (its own
// site rarely states it) rather than concluding the size is unknown.
const HEADCOUNT_SEARCH_INSTRUCTION =
	'You have not yet found this company\'s employee headcount, which is rarely on its homepage. Before giving a final answer, use web_search for it — try the company name with "number of employees", or its LinkedIn / ZoomInfo profile — then report the figure with a quote. If after searching you still cannot find it, finish without it; never invent a number.'

// Appended to a re-run's first prompt when a human supplied the correct official
// domain: point the model straight at that site so it grounds on the right company.
const ANCHOR_DOMAIN_INSTRUCTION = (host: string): string =>
	`The correct official website for this company is https://${host}. Use scrape_page on that site first and treat it as the authoritative source for the company's identity and details.`

interface SourcedPage {
	readonly urlHash: string
	readonly text: string
	readonly host?: string | undefined
}

// Feed extraction only the fetched pages that concern the target, so a look-alike
// company's page pulled in alongside it cannot leak into the extracted fields.
// Falls back to every page when the per-source check grounds none, so a run that
// matched only through a search snippet still has something to extract from. The
// company's own pages come first, so a fact stated on both the official site and an
// aggregator is extracted from — and attributed to — the official one, instead of
// the aggregator that happened to sit earlier in the fetch order.
export const groundedPages = (
	targets: EntityTargets | null,
	pages: ReadonlyArray<SourcedPage>,
): ReadonlyArray<SourcedPage> => {
	if (targets === null) return pages
	const verdicts = classifyEntityMatchPerSource(
		targets,
		pages.map(page => ({
			sourceId: page.urlHash,
			text: page.text,
			host: page.host,
		})),
	)
	const keep = new Set(groundedSourceIds(verdicts))
	const grounded = pages.filter(page => keep.has(page.urlHash))
	const chosen = grounded.length > 0 ? grounded : pages
	return [...chosen].sort(
		(a, b) =>
			(isFirstPartyHost(a.host ?? '', targets.domains) ? 0 : 1) -
			(isFirstPartyHost(b.host ?? '', targets.domains) ? 0 : 1),
	)
}

// The grounded page texts, for building the guard grounding corpus (values are
// checked against this, so it stays free of source labels).
export const groundedPageTexts = (
	targets: EntityTargets | null,
	pages: ReadonlyArray<SourcedPage>,
): ReadonlyArray<string> => groundedPages(targets, pages).map(page => page.text)

// The grounded pages for extraction, each block prefixed with the host it came
// from, so the model attributes a fact to the page it physically sits on (the
// official site vs an aggregator) instead of guessing from the flat source list.
export const labelledGroundedPages = (
	targets: EntityTargets | null,
	pages: ReadonlyArray<SourcedPage>,
): ReadonlyArray<string> =>
	groundedPages(targets, pages).map(page =>
		page.host ? `[source: ${page.host}]\n${page.text}` : page.text,
	)

/**
 * Just the pages the run opened in full, dropping the passages a search quoted.
 * A passage is one sentence, not the page, so two checks go wrong reading one
 * as the other: "have we already read this page?" — counting a passage skips a
 * page worth opening — and "is this page about the right company?" — a sentence
 * that never repeats the name reads as the wrong company and voids a field that
 * was fine.
 */
export const openedPages = <
	Entry extends { readonly kind: 'page' | 'passage' },
>(
	corpus: ReadonlyArray<Entry>,
): ReadonlyArray<Entry> => corpus.filter(entry => entry.kind === 'page')

// The cited-but-never-fetched sources of an enrichment's company fields — the
// citations the per-source entity check had to fail open on. A gap round
// scrapes these first: fetching the cited page turns fail-open into a real
// verdict, and the page often carries the very facts still missing. Blocked
// namespaces (posts, person pages) are skipped — fetching one changes nothing —
// and so is anything that is not a web address, such as an internal id naming a
// page the run already holds.
export const citedUnscrapedSources = (
	findings: unknown,
	hasPage: (urlHash: string) => boolean,
	cap: number,
): ReadonlyArray<string> => {
	if (findings === null || typeof findings !== 'object') return []
	const enrichment = (findings as { enrichment?: unknown }).enrichment
	if (enrichment === null || typeof enrichment !== 'object') return []
	const out: string[] = []
	const seen = new Set<string>()
	for (const value of Object.values(enrichment as Record<string, unknown>)) {
		if (value === null || typeof value !== 'object') continue
		const id = (value as { source_id?: unknown }).source_id
		if (typeof id !== 'string' || id.trim() === '') continue
		if (seen.has(id)) continue
		seen.add(id)
		if (classifyNamespace(id) !== null) continue
		if (!isWebAddress(id)) continue
		if (hasPage(urlHashForScrape(id))) continue
		out.push(id)
		if (out.length >= cap) break
	}
	return out
}

/**
 * Deterministic JSON serializer: sorts object keys and drops function values
 * so two call-sites that pass equivalent hints hash identically regardless of
 * property-declaration order. Plain `JSON.stringify` would preserve insertion
 * order and produce spurious cache misses.
 */
const stableStringify = (value: unknown): string => {
	const seen = new WeakSet<object>()
	const walk = (v: unknown): unknown => {
		if (v === null || typeof v !== 'object') return v
		if (seen.has(v as object)) return '[circular]'
		seen.add(v as object)
		if (Array.isArray(v)) return v.map(walk)
		return Object.fromEntries(
			Object.entries(v as Record<string, unknown>)
				.filter(([, val]) => typeof val !== 'function')
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([k, val]) => [k, walk(val)] as const),
		)
	}
	return JSON.stringify(walk(value))
}

export const normalizeResearchQuery = (query: string): string =>
	query.trim().replace(/\s+/g, ' ').toLowerCase()

export const schemaVersionFor = (schemaName: string): number => {
	const match = schemaName.match(/_v(\d+)$/)
	return match ? Number(match[1]) : 1
}

// Stamp each element of an in-findings review list with an id + pending status,
// so it can later be addressed and resolved one at a time. The id and status are
// this system's to set, so they are spread last — a model that emitted either of
// its own never takes their place. An optional per-item transform runs first, so
// a list can also clean up a field before it is stored (paid actions coerce their
// tool name below).
const withPendingIds = (
	items: unknown,
	transform?: (item: Record<string, unknown>) => Record<string, unknown>,
): unknown =>
	Array.isArray(items)
		? items.map(item =>
				typeof item === 'object' && item !== null && !Array.isArray(item)
					? {
							...(transform
								? transform(item as Record<string, unknown>)
								: item),
							id: randomUUID(),
							status: 'pending',
						}
					: item,
			)
		: items

// Rewrite a paid action's tool to the real tool it names before storing, so a
// stored action a human later approves points at a tool a follow-up can run. A
// name that matches nothing real is left as the model wrote it — visible to the
// user, and reported as unsupported at approval time.
const coercePaidActionTool = (
	item: Record<string, unknown>,
): Record<string, unknown> => {
	const canonical = normalizePaidActionTool(item['tool'])
	return canonical ? { ...item, tool: canonical } : item
}

/**
 * Give each entry in the two human-reviewed findings lists — the proposed CRM
 * updates and the paid follow-up actions — a stable id and a pending status
 * before the findings are stored, so a human can later resolve that exact entry
 * by id. Non-object findings and every other key pass through untouched.
 */
export const withProposalIds = (findings: unknown): unknown => {
	if (
		typeof findings !== 'object' ||
		findings === null ||
		Array.isArray(findings)
	)
		return findings
	const record = findings as Record<string, unknown>
	const hasProposals = Array.isArray(record['proposed_updates'])
	const hasPaidActions = Array.isArray(record['pending_paid_actions'])
	// No list to stamp: hand the findings back untouched (same reference).
	if (!hasProposals && !hasPaidActions) return findings
	return {
		...record,
		...(hasProposals
			? { proposed_updates: withPendingIds(record['proposed_updates']) }
			: {}),
		...(hasPaidActions
			? {
					pending_paid_actions: withPendingIds(
						record['pending_paid_actions'],
						coercePaidActionTool,
					),
				}
			: {}),
	}
}

// The country the model extracted for the target, read from `enrichment.country`.
// The value may be a bare string or the `{ value, source_id }` per-field-citation
// wrapper; return the inner text, or nothing when the field is absent.
export const readEnrichmentCountry = (
	findings: unknown,
): string | undefined => {
	if (typeof findings !== 'object' || findings === null) return undefined
	const enrichment = (findings as { enrichment?: unknown }).enrichment
	if (typeof enrichment !== 'object' || enrichment === null) return undefined
	const country = (enrichment as { country?: unknown }).country
	if (typeof country === 'string') return country
	if (
		typeof country === 'object' &&
		country !== null &&
		typeof (country as { value?: unknown }).value === 'string'
	)
		return (country as { value: string }).value
	return undefined
}

// The most rows one research list may pull, matching the ceiling the web API
// enforces. This and the paging helpers below are spelled out here rather than
// imported, because research is its own bounded context and does not depend on
// the app that hosts it.
const MAX_RESEARCH_PAGE = 500

// Clamp list pagination so out-of-range input can't reach SQL: a negative limit
// makes Postgres reject `LIMIT -1`, an unbounded one would pull the whole table,
// and a negative offset is meaningless.
//
// Callers over HTTP and over the agent tools are already refused out-of-range
// values by their own request schemas; this stays as the last line of defence
// for anything calling the service directly.
export const clampPagination = (
	limit: number | undefined,
	offset: number | undefined,
): { readonly limit: number; readonly offset: number } => {
	// `Schema.Number` also admits NaN/Infinity/floats, which would reach SQL as
	// `LIMIT NaN` / `LIMIT 2.5`; coerce to a finite integer (or the default) first.
	const toInt = (n: number | undefined, fallback: number): number =>
		n !== undefined && Number.isFinite(n) ? Math.trunc(n) : fallback
	return {
		limit: Math.min(Math.max(toInt(limit, 20), 1), MAX_RESEARCH_PAGE),
		offset: Math.max(toInt(offset, 0), 0),
	}
}

// Ask for one row more than the page holds, so a list can tell whether
// anything follows it without counting the whole table. The spare row is
// dropped again by `takePage` before anyone sees it.
const probeLimit = (limit: number): number => limit + 1

// Trim the spare row off and say whether it was there. Must run before the
// rows are decoded, or the caller gets one row more than it asked for.
const takePage = <R>(
	rows: ReadonlyArray<R>,
	limit: number,
): { readonly rows: ReadonlyArray<R>; readonly hasMore: boolean } => ({
	rows: rows.slice(0, limit),
	hasMore: rows.length > limit,
})

// How many rows match in total, or null when the caller asked not to be told.
// An empty page that starts partway in says nothing about the total — the
// filters may match nothing, or the page may simply start past the last match
// — so `countMatching` is asked only in that one case to tell those apart.
const resolvePageTotal = <E, R>(
	rows: ReadonlyArray<{ readonly total?: string | number }>,
	offset: number,
	count: 'exact' | 'none',
	countMatching: () => Effect.Effect<
		ReadonlyArray<{ readonly count: string | number }>,
		E,
		R
	>,
): Effect.Effect<number | null, E, R> => {
	if (count === 'none') return Effect.succeed(null)
	const first = rows[0]
	if (first?.total !== undefined) return Effect.succeed(Number(first.total))
	if (offset === 0) return Effect.succeed(0)
	return countMatching().pipe(
		Effect.map(countRows => Number(countRows[0]?.count ?? 0)),
	)
}

/**
 * Write down what a run cost, and what it used getting there.
 *
 * paid_cost_cents comes from the paid-spend ledger and is authoritative — the
 * run's connection bypasses row-level security and a research_id belongs to one
 * run, so the sum sees every paid row for it. cost_cents and paid_cost_cents
 * both start at 0 and nothing else fills them, so without this a run that spent
 * money still shows up as free.
 *
 * The cost and the token counts only ever go up. Cancelling a run and the run
 * itself finishing can land in either order, and the cancel path knows nothing
 * about what was spent — so a lower figure arriving later leaves the recorded
 * one alone rather than wiping it. A caller with nothing new to say passes
 * nothing and only the paid total is refreshed.
 */
export const stampRunCostFromLedger = (
	sql: SqlClient.SqlClient,
	researchId: string,
	costCents: number,
	usage?: {
		readonly tokensIn: number
		readonly tokensOut: number
		readonly costByBucket: Record<string, number>
		readonly unitsByProvider: Record<string, number>
		readonly callsByModel: Record<string, number>
	},
) =>
	sql`
		UPDATE research_runs
		SET cost_cents = GREATEST(cost_cents, ${costCents}),
			tokens_in = GREATEST(tokens_in, ${usage?.tokensIn ?? 0}),
			tokens_out = GREATEST(tokens_out, ${usage?.tokensOut ?? 0}),
			cost_breakdown = COALESCE(
				${usage ? JSON.stringify(usage.costByBucket) : null}::jsonb,
				cost_breakdown
			),
			quota_breakdown = COALESCE(
				${usage ? JSON.stringify(usage.unitsByProvider) : null}::jsonb,
				quota_breakdown
			),
			llm_models = COALESCE(
				${usage ? JSON.stringify(usage.callsByModel) : null}::jsonb,
				llm_models
			),
			paid_cost_cents = COALESCE(
				(SELECT SUM(amount_cents)::int FROM research_paid_spend
					WHERE research_id = ${researchId}),
				0
			),
			updated_at = now()
		WHERE id = ${researchId}
	`

export interface PendingProposalRow {
	readonly researchId: string
	readonly runKind: string
	readonly runStatus: string
	readonly runQuery: string
	readonly runCreatedAt: Date
	readonly proposedUpdateId: string | null
	readonly subjectTable: string | null
	readonly subjectId: string | null
	// The subject row's current name (e.g. "Acme Bakery"), looked up from its id.
	// Null for a proposal that would create a brand-new row.
	readonly subjectName: string | null
	readonly operation: string
	readonly reason: string | null
	readonly confidence: number | null
	readonly verification: string | null
	readonly machineCheckable: boolean
	// The run's cheap spend so far (search, scraping, model calls), in cents; the
	// same value repeats on every proposal from that run, so it belongs to the
	// run rather than to this one proposal.
	readonly runCostCents: number
	// What the run paid outside providers, in cents — a tally of its own, not a
	// slice of the one above, so a cheap-looking run may still have spent money.
	readonly runPaidCostCents: number
	// The values this proposal would write, keyed by column.
	readonly fields: Record<string, unknown>
	// The pages each value came from.
	readonly citations: ReadonlyArray<unknown>
	// What the record holds today for those same columns; null for a proposal
	// that would create a new row, and absent per-key when the column is unset.
	readonly subjectCurrent: Record<string, unknown> | null
}

/**
 * Pending proposed updates across every run in the org — what the review inbox
 * reads. Each run keeps its proposals inside its own findings, so this unnests
 * them and returns one row per pending proposal with the run + subject context
 * and the trust signals a reviewer sorts by: a 0–100 confidence (the strongest
 * channel score), the email deliverability verdict, and whether the value is
 * machine-checkable (an email or phone the system can verify) rather than free
 * text. Filtered and paginated in SQL so the inbox stays cheap at volume; the
 * org scope is enforced by row-level security, like the run list.
 */
export const queryPendingProposals = (
	sql: SqlClient.SqlClient,
	filters: {
		researchId?: string | undefined
		subjectTable?: string | undefined
		status?: string | undefined
		minConfidence?: number | undefined
		machineCheckable?: boolean | undefined
		limit?: number | undefined
		offset?: number | undefined
		count?: 'exact' | 'none' | undefined
	},
) =>
	Effect.gen(function* () {
		const conditions: Array<import('effect/unstable/sql').Statement.Fragment> =
			[]
		if (filters.researchId)
			conditions.push(sql`research_id = ${filters.researchId}`)
		if (filters.subjectTable)
			conditions.push(sql`subject_table = ${filters.subjectTable}`)
		if (filters.status) conditions.push(sql`run_status = ${filters.status}`)
		if (filters.minConfidence != null)
			conditions.push(sql`confidence >= ${filters.minConfidence}`)
		if (filters.machineCheckable != null)
			conditions.push(sql`machine_checkable = ${filters.machineCheckable}`)

		const { limit, offset } = clampPagination(filters.limit, filters.offset)
		const count = filters.count ?? 'none'

		// A confidence can be a 0–1 fraction (model) or a 0–100 score (enrichment);
		// normalize to 0–100 so the reviewer's minimum-confidence filter compares
		// like with like. The CASE guards keep a stray non-array `proposed_updates`
		// or `channels` from breaking the row expansion.
		//
		// A proposal names a way of reaching someone in one of two shapes, and both
		// have to be read: a person's proposal carries a `channels` list, while a
		// company's carries a plain `email` or `phone` field. Reading only the list
		// left a company mailbox with no confidence at all, which hid it from any
		// organisation that sets a minimum and barred it from unattended writing.
		const matching = sql`
			WITH pending AS (
				SELECT
					r.id AS research_id,
					r.kind AS run_kind,
					r.status AS run_status,
					r.query AS run_query,
					r.created_at AS run_created_at,
					r.cost_cents AS run_cost_cents,
					r.paid_cost_cents AS run_paid_cost_cents,
					pu->>'id' AS proposed_update_id,
					pu->>'subject_table' AS subject_table,
					pu->>'subject_id' AS subject_id,
					COALESCE(pu->>'operation', 'update') AS operation,
					pu->>'reason' AS reason,
					-- The values the run wants to write and the pages they came from
					-- travel with the row, so deciding on a proposal needs no further
					-- lookup of its own.
					CASE WHEN jsonb_typeof(pu->'fields') = 'object'
						THEN pu->'fields' ELSE '{}'::jsonb END AS fields,
					CASE WHEN jsonb_typeof(pu->'citations') = 'array'
						THEN pu->'citations' ELSE '[]'::jsonb END AS citations,
					reach.confidence::int AS confidence,
					reach.verification AS verification,
					-- No reachable value at all is a definite "cannot be checked by
					-- machine", not an unknown, so the reviewer's filter still matches it.
					COALESCE(reach.machine_checkable, false) AS machine_checkable
				FROM research_runs r,
					LATERAL jsonb_array_elements(
						CASE WHEN jsonb_typeof(r.findings->'proposed_updates') = 'array'
							THEN r.findings->'proposed_updates' ELSE '[]'::jsonb END
					) pu,
					LATERAL (
						WITH reachable AS (
							SELECT
								ch->>'kind' AS kind,
								ch->>'verification' AS verification,
								CASE
									WHEN jsonb_typeof(ch->'confidence') = 'number'
									THEN CASE
										WHEN (ch->>'confidence')::numeric <= 1
										THEN (ch->>'confidence')::numeric * 100
										ELSE (ch->>'confidence')::numeric
									END
								END AS confidence
							FROM jsonb_array_elements(
								CASE WHEN jsonb_typeof(pu->'fields'->'channels') = 'array'
									THEN pu->'fields'->'channels' ELSE '[]'::jsonb END
							) ch
							UNION ALL
							-- The company's own mailbox and number, written as plain fields
							-- rather than as a list. Either the value carries the page it
							-- came from, or it is the bare address on its own; both count.
							-- Nobody has tried delivering to one, so it has no verdict.
							SELECT
								field.name,
								NULL::text,
								CASE
									WHEN jsonb_typeof(pu->'fields'->field.name->'confidence') = 'number'
									THEN CASE
										WHEN (pu->'fields'->field.name->>'confidence')::numeric <= 1
										THEN (pu->'fields'->field.name->>'confidence')::numeric * 100
										ELSE (pu->'fields'->field.name->>'confidence')::numeric
									END
								END
							FROM (VALUES ('email'), ('phone')) AS field(name)
							WHERE nullif(trim(CASE jsonb_typeof(pu->'fields'->field.name)
								WHEN 'object' THEN pu->'fields'->field.name->>'value'
								WHEN 'string' THEN pu->'fields'->>field.name
							END), '') IS NOT NULL
						)
						SELECT
							max(confidence) AS confidence,
							-- A proposal is only as good as its best email address: an
							-- undeliverable address sitting next to a deliverable one still
							-- reaches the person, so the verdicts are ranked and the
							-- strongest wins, not whichever happens to be listed first.
							(
								SELECT verification
								FROM reachable
								WHERE kind = 'email' AND verification IS NOT NULL
								ORDER BY CASE verification
									WHEN 'deliverable' THEN 0
									WHEN 'risky' THEN 1
									WHEN 'catch_all' THEN 2
									WHEN 'unknown' THEN 3
									WHEN 'undeliverable' THEN 4
									ELSE 5
								END
								LIMIT 1
							) AS verification,
							bool_or(kind IN ('email', 'phone')) AS machine_checkable
						FROM reachable
					) reach
				WHERE r.status != 'deleted'
					AND pu->>'status' = 'pending'
			)
			SELECT
				p.*,
				-- Resolve the subject's current name from its table and id; these
				-- joins are org-scoped by row-level security like the rest of the query.
				-- A proposal that would create a brand-new row has no id to look up, so
				-- its name comes from the values the run proposes instead of being blank.
				COALESCE(c.name, ct.name, p.fields->>'name') AS subject_name,
				-- What the record holds today for exactly the fields this proposal would
				-- write — enough to tell an addition apart from an overwrite — and
				-- nothing else about the row. A proposal may name a field either way
				-- round ("size_range" or "sizeRange") and both are accepted on apply, so
				-- both spellings are looked up against the record's snake_case columns
				-- and keyed back to the spelling the proposal used.
				(
					SELECT jsonb_object_agg(picked.key_out, picked.val)
					FROM (
						SELECT
							k AS key_out,
							COALESCE(
								to_jsonb(c) -> k,
								to_jsonb(ct) -> k,
								to_jsonb(c) -> s.snake,
								to_jsonb(ct) -> s.snake
							) AS val
						FROM jsonb_object_keys(p.fields) k,
							LATERAL (
								SELECT lower(
									regexp_replace(k, '([a-z0-9])([A-Z])', '\\1_\\2', 'g')
								) AS snake
							) s
					) picked
					WHERE picked.val IS NOT NULL
				) AS subject_current
			FROM pending p
			LEFT JOIN companies c
				ON p.subject_table = 'companies' AND c.id::text = p.subject_id
			LEFT JOIN contacts ct
				ON p.subject_table = 'contacts' AND ct.id::text = p.subject_id
			WHERE ${sql.and(conditions)}
		`

		const probed = yield* sql<
			PendingProposalRow & { readonly total?: string | number }
		>`
			SELECT sub.*${count === 'exact' ? sql`, COUNT(*) OVER () AS total` : sql``}
			FROM (${matching}) sub
			ORDER BY sub.run_created_at DESC
			LIMIT ${probeLimit(limit)}
			OFFSET ${offset}
		`
		const { rows, hasMore } = takePage(probed, limit)
		const total = yield* resolvePageTotal(
			rows,
			offset,
			count,
			() => sql<{ readonly count: string | number }>`
				SELECT count(*) AS count FROM (${matching}) sub
			`,
		)
		return { items: rows, total, limit, offset, hasMore }
	})

export interface PendingPaidActionRow {
	readonly researchId: string
	readonly runQuery: string
	readonly runStatus: string
	readonly runCreatedAt: Date
	readonly actionId: string | null
	// The lookup the run wants to pay for, as the run named it. A name matching no
	// real lookup can only be skipped.
	readonly tool: string
	readonly args: Record<string, unknown>
	// What the lookup is expected to cost, in whole cents; null when the run made
	// no estimate.
	readonly estimatedCents: number | null
	readonly reason: string | null
	// The company or person the run was about, when it was about exactly one, so a
	// decision can be made without opening the run.
	readonly subjectTable: string | null
	readonly subjectId: string | null
	readonly subjectName: string | null
}

/**
 * Paid lookups across every run in the org that are waiting for a person to
 * approve or skip them. A run stores these inside its own findings and stops
 * short of spending, so without a list like this one nothing surfaces a run
 * holding an unspent decision — it waits until somebody happens to open it.
 * Org scope is enforced by row-level security, like the run list.
 */
export const queryPendingPaidActions = (
	sql: SqlClient.SqlClient,
	filters: {
		researchId?: string | undefined
		limit?: number | undefined
		offset?: number | undefined
		count?: 'exact' | 'none' | undefined
	},
) =>
	Effect.gen(function* () {
		const conditions: Array<import('effect/unstable/sql').Statement.Fragment> =
			[]
		if (filters.researchId)
			conditions.push(sql`research_id = ${filters.researchId}`)

		const { limit, offset } = clampPagination(filters.limit, filters.offset)
		const count = filters.count ?? 'none'

		// An action written before the id stamp has no id and cannot be resolved,
		// but it still shows, so a run that is stuck waiting is at least visible.
		// An absent status counts as pending: that is the shape a run writes first.
		const matching = sql`
			WITH waiting AS (
				SELECT
					r.id AS research_id,
					r.query AS run_query,
					r.status AS run_status,
					r.created_at AS run_created_at,
					pa->>'id' AS action_id,
					COALESCE(pa->>'tool', '') AS tool,
					CASE WHEN jsonb_typeof(pa->'args') = 'object'
						THEN pa->'args' ELSE '{}'::jsonb END AS args,
					CASE WHEN jsonb_typeof(pa->'estimated_cents') = 'number'
						THEN (pa->>'estimated_cents')::int END AS estimated_cents,
					pa->>'reason' AS reason,
					-- A run anchored to exactly one company or person names it here.
					-- The count guard is what keeps a run about several of them from
					-- picking one at random and presenting it as the subject.
					(
						SELECT min(rl.subject_table) FROM research_links rl
						WHERE rl.research_id = r.id
						HAVING count(*) = 1
					) AS subject_table,
					(
						SELECT min(rl.subject_id::text) FROM research_links rl
						WHERE rl.research_id = r.id
						HAVING count(*) = 1
					) AS subject_id
				FROM research_runs r,
					LATERAL jsonb_array_elements(
						CASE WHEN jsonb_typeof(r.findings->'pending_paid_actions') = 'array'
							THEN r.findings->'pending_paid_actions' ELSE '[]'::jsonb END
					) pa
				WHERE r.status != 'deleted'
					AND COALESCE(pa->>'status', 'pending') = 'pending'
			)
			SELECT
				w.*,
				COALESCE(c.name, ct.name) AS subject_name
			FROM waiting w
			LEFT JOIN companies c
				ON w.subject_table = 'companies' AND c.id::text = w.subject_id
			LEFT JOIN contacts ct
				ON w.subject_table = 'contacts' AND ct.id::text = w.subject_id
			${conditions.length > 0 ? sql`WHERE ${sql.and(conditions)}` : sql``}
		`

		const probed = yield* sql<
			PendingPaidActionRow & { readonly total?: string | number }
		>`
			SELECT sub.*${count === 'exact' ? sql`, COUNT(*) OVER () AS total` : sql``}
			FROM (${matching}) sub
			ORDER BY sub.run_created_at DESC
			LIMIT ${probeLimit(limit)}
			OFFSET ${offset}
		`
		const { rows, hasMore } = takePage(probed, limit)
		const total = yield* resolvePageTotal(
			rows,
			offset,
			count,
			() => sql<{ readonly count: string | number }>`
				SELECT count(*) AS count FROM (${matching}) sub
			`,
		)
		return { items: rows, total, limit, offset, hasMore }
	})

// Outcome of a cancel attempt, decided from whether a queued/running row
// actually flipped to cancelled and whether the run exists at all.
export const cancelOutcome = (
	flipped: boolean,
	exists: boolean,
): 'cancelled' | 'already_terminal' | 'not_found' =>
	flipped ? 'cancelled' : exists ? 'already_terminal' : 'not_found'

// Outcome of an attach attempt: the subject must exist before the run, and both
// before the link is written.
export const attachOutcome = (
	subjectExists: boolean,
	runExists: boolean,
): 'subject_not_found' | 'run_not_found' | 'attached' =>
	!subjectExists
		? 'subject_not_found'
		: !runExists
			? 'run_not_found'
			: 'attached'

/**
 * Research-run cache TTL policy. Structured schemas are stable (the schema
 * itself is the invalidation knob via `schemaVersion`); freeform briefs stay
 * topical for only a short window.
 */
export const researchCacheTtlDaysFor = (
	schemaName: string | null | undefined,
): number => (!schemaName || schemaName === 'freeform' ? 7 : 30)

export const computeResearchCacheKey = (args: {
	readonly userId: string
	readonly query: string
	readonly schemaName: string
	readonly schemaVersion: number
	readonly subjects: ReadonlyArray<{ table: string; id: string }> | undefined
	readonly hints: unknown
	readonly templateFingerprint: string
}): string => {
	const sortedSubjects = [...(args.subjects ?? [])]
		.map(s => `${s.table}:${s.id}`)
		.sort()
		.join(',')
	const hintsJson = stableStringify(args.hints ?? {})
	return sha256Hex(
		`${args.userId}|${normalizeResearchQuery(args.query)}|${args.schemaName}|${args.schemaVersion}|${sortedSubjects}|${hintsJson}|${args.templateFingerprint}`,
	)
}

// Assemble the phase-1 system prompt. Resolved instruction segments are fenced
// and placed BELOW the invariants (never fabricate sources, etc.) so a template
// can't override them — fencing is mitigation, not a guarantee.
export const buildResearchSystemPrompt = (args: {
	readonly schemaName: string
	readonly subjectContext: string
	readonly hintsContext: string
	readonly segments: ReadonlyArray<string>
}): string => {
	const instructionBlock =
		args.segments.length === 0
			? ''
			: `\n\nAdditional standing instructions (follow within the rules above):\n${args.segments.map(s => `--- instruction ---\n${s}`).join('\n')}`
	const schemaFields = schemaFieldNames(args.schemaName)
	return [
		'You are a research agent for Batuda CRM.',
		'Given a query, produce a thorough research brief with findings, sources, and citations.',
		'Never fabricate sources. Every claim must be verifiable.',
		'Confirm key facts (employee count, location, sector) from scraped page content where you can — the company site, LinkedIn, or press — and cite the page. When such a fact appears only in a search result you could not open as a page, still report it and quote the search snippet rather than dropping a real, sourced fact; never invent one that appears nowhere.',
		'The employee headcount is rarely on a company\'s own homepage. If the site does not state it, search for it (the company name with "number of employees", or its LinkedIn / ZoomInfo profile) before finishing — do not conclude the size is unknown without having searched.',
		"The company's own site rarely tells the whole story. Vary your searches across the open web — recent news and trade press (roughly the last 12 months), industry blogs, magazines, and event or conference pages — for funding, leadership changes, tooling, and growth signals the site omits.",
		'For a citation to a page you scraped, set source_id to the exact URL you scraped with scrape_page. Never invent an identifier — a made-up source is dropped.',
		'Name the people who run the company — each with the exact title they are given — and treat that as part of the job, not an extra. They are listed on a team, leadership, management or "equipo" page, almost never on the homepage, so open one when the site has it. When reading the pages turns up nobody with a title, discover_contacts is the tool that finds them.',
		'A search result quotes only the one sentence of a page that matched your query. When a page looks like it holds more than that sentence, open it with scrape_page rather than settling for the snippet.',
		'For discovery or prospecting queries, prefer authoritative sources — business directories, industry association member lists, and sector registries — over social media, forums, or glossary pages. Treat such a page as somewhere to find candidates, not as the answer: a "top N" or "largest" ranking lists the biggest firms in a sector, which is the opposite of what most prospecting asks for. Carry every qualifier in the request — size, place, and niche — into each search, and check each candidate against all of them before returning it; leave out one that fails any, however prominently a directory listed it.',
		schemaFields.length === 0
			? `Output schema: ${args.schemaName}`
			: `Output schema: ${args.schemaName}. Come back with everything it holds, not only the facts named above: ${schemaFields.join(', ')}. Leave a field out when the evidence does not support it — never fill one by guessing.`,
		args.subjectContext,
		args.hintsContext,
		instructionBlock,
	].join('\n')
}

/**
 * What a run is told about a company or person it already has on file: which row it
 * is, the version we read it at, and the values we currently hold. The three
 * identifying keys are named exactly as a proposed change names them, so the model
 * copies them across rather than working out the mapping itself — it does not do that
 * reliably, and a proposal with the wrong id cannot be applied.
 */
export interface SubjectForPrompt {
	readonly subject_table: string
	readonly subject_id: string
	readonly expected_version: unknown
	readonly current: Record<string, unknown>
}

export const subjectsForPrompt = (
	subjects: ReadonlyArray<{
		readonly table: string
		readonly id: string
		readonly snapshot: unknown
		readonly expected_version: unknown
	}>,
): ReadonlyArray<SubjectForPrompt> =>
	subjects.map(subject => {
		const row = (subject.snapshot ?? {}) as Record<string, unknown>
		const shownFields =
			subject.table === 'contacts'
				? SNAPSHOT_CONTACT_FIELDS
				: SNAPSHOT_COMPANY_FIELDS
		const current: Record<string, unknown> = {}
		for (const key of shownFields) {
			// A column we hold nothing in tells the model nothing, so leaving it out
			// keeps the picture to what is actually on file.
			if (row[key] != null) current[key] = row[key]
		}
		return {
			subject_table: subject.table,
			subject_id: subject.id,
			expected_version: subject.expected_version,
			current,
		}
	})

// Told to a run that already holds the company on file, so it offers a correction
// where the evidence disagrees. Only a disagreement is worth a person's review —
// repeating back what is already stored is noise — and the stored value is never
// itself a reason to believe something: it is what we believed before this run went
// looking.
const PROPOSE_UPDATES_DIRECTIVE = [
	'Compare each `current` value above against the evidence. Where the evidence clearly contradicts a value on file, or fills one that is missing, add an entry to `proposed_updates`:',
	'- copy `subject_table`, `subject_id` and `expected_version` across exactly as written above;',
	'- put ONLY the fields that change in `fields`, keyed exactly as they are keyed in `current`;',
	'- give a `reason`, and cite the source that states the new value — an entry with no citation is discarded.',
	'Do not propose a value that only repeats what `current` already says, and never take a value from `current` itself: it is what is already on file, not evidence. A field the evidence says nothing about is left out.',
].join('\n')

// Told to a run that holds the company on file, so a person the evidence names who
// is not already a row can be offered as somebody new.
//
// Without this the run only ever offers corrections to people already on file, so a
// plant manager, a head teacher or a purchasing lead named on a page is read,
// reported in the profile, and then goes no further. Everything downstream of the
// ask already works: the offer travels as a create, the checks handle it, and
// accepting it writes the person — merging them into an existing row if they turn
// out to be the same person under a different spelling.
//
// It needs the company's own id, which is why it is told only to a run that was
// handed a company: a new person has to belong to a company row, and a run that
// holds none has nothing to attach one to.
const proposeContactDirective = (companyId: string): string =>
	[
		"Separately, for a person the evidence identifies as one of this company's own leaders or employees who is NOT among the rows on file above, add an entry to `proposed_updates` offering them as somebody new:",
		'- set `operation` to "create" and `subject_table` to "contacts"; leave `subject_id` out and set `expected_version` to null — there is no row for them yet;',
		`- in \`fields\`, give their \`name\`, their \`role\`, and \`company_id\`: "${companyId}" copied exactly; add an email or phone only if the evidence states one for that person;`,
		'- give a `reason`, and cite the page that names them — an entry with no citation is discarded.',
		'Offer a person even when no address for them can be found: the name and the job title are the useful part on their own. Still list them in the people list as well — the offer is in addition to that list, not instead of it. Never offer somebody the evidence describes as a client, a partner, a supplier, or a competitor.',
	].join('\n')

/**
 * The instruction for the structured-extraction pass: read the gathered evidence
 * and fill the output schema from it.
 *
 * Two jobs, in a deliberate order. First, read all of the evidence and report every
 * fact it states — the model otherwise answers from the first page or two and leaves
 * the rest of a real profile empty. Second, report ONLY what the evidence states —
 * the reading push is on how much of the evidence the model uses, never on how many
 * fields it fills, so a field the evidence does not support still stays empty rather
 * than being invented. The push names only fields a downstream guard can check; the
 * plain-list tags field is left out on purpose, since nothing verifies it and
 * pushing there would only invite made-up entries.
 *
 * When the run already holds the subjects on file, they are shown to the model with
 * an instruction to propose a correction wherever the evidence disagrees — the only
 * way a run turns up an edit for a company it was handed rather than one it found.
 */
// Asks the model to land the fit judgement in the structured output, not only in
// the brief. Applies only to the enrichment schema, which is the one that
// carries the verdict/disqualifiers/fit_checks fields.
const FIT_VERDICT_DIRECTIVE =
	'Decide whether this company fits the target customer profile using the fit rules in the instructions above, and record it: set `verdict` (strong_fit / possible_fit / weak_fit / no_fit) with a short `verdict_rationale`; for a company that fails a rule, list each failure in `disqualifiers` with the rule and the evidence quote that shows it. Also fill `fit_checks` with one row per fit rule in the instructions — every rule, including the ones the company passes — each marked pass, fail, or unknown per the evidence, with the quote and source URL that decide it.'

export const buildExtractionPrompt = (args: {
	readonly citationInstruction: string
	readonly evidenceBlock: string
	readonly subjects: ReadonlyArray<SubjectForPrompt>
	readonly fitVerdict?: boolean
}): string => {
	const lines = [
		'Produce structured findings STRICTLY from the evidence below (the fetched pages and the research transcript).',
		'',
		"Read ALL of the evidence to the end — every fetched page and every search result in the transcript — and report every fact it states; the evidence routinely states far more than a first pass returns. Report the industry, employee-count band, location, country, and the company's own operational software wherever the evidence states them — including on a third-party page rather than the company's own site.",
		'',
		"Name EVERY person the evidence identifies as this company's own leader or employee — a titled executive on the team page, a quoted founder, a signed author — each with the exact job title the evidence gives them. Leaving the people list empty while the evidence names the company's own staff is an incomplete extraction.",
		'',
		"Report ONLY what the evidence states. If it does not support a field, omit it or leave it null — never fill a field from prior knowledge, never guess, and never put a placeholder or the field's own name as its value. Leaving a field empty is always better than inventing a value for it.",
		'',
		"When sources disagree on a time-sensitive fact (employee count, tools in use, leadership), fill the field from the most recently published reading among sources of equal standing — the company's own site still outranks an aggregator — and record each reading the field did not take in `conflicts`, with its value and the URL of the source that stated it.",
	]
	if (args.subjects.length > 0) {
		lines.push(
			'',
			`What we already have on file:\n${JSON.stringify(args.subjects, null, 2)}`,
			'',
			PROPOSE_UPDATES_DIRECTIVE,
		)
		const company = args.subjects.find(s => s.subject_table === 'companies')
		if (company !== undefined) {
			lines.push('', proposeContactDirective(company.subject_id))
		}
	}
	if (args.fitVerdict) {
		lines.push('', FIT_VERDICT_DIRECTIVE)
	}
	lines.push('', args.citationInstruction, '', args.evidenceBlock)
	return lines.join('\n')
}

// ── Event types for SSE streaming ──

export type ResearchEventType =
	| 'run.started'
	| 'tool.called'
	| 'tool.result'
	| 'tool.retried'
	| 'tool.fell_back'
	| 'tool.cache_hit'
	| 'run.succeeded'
	| 'run.failed'
	| 'run.cancelled'
	| 'run.no_reliable_data'
	| 'run.refining'
	| 'provider.circuit_open'

export interface ResearchEvent {
	readonly type: ResearchEventType
	readonly researchId: string
	readonly timestamp: string
	readonly data: unknown
}

// ── Tool log entry (accumulated in-memory, persisted at completion) ──

export interface ToolLogEntry {
	readonly timestamp: string
	readonly type: 'call' | 'result'
	readonly tool: string
	readonly input?: unknown
	readonly output?: unknown
	readonly error?: string
	readonly durationMs?: number
}

// ── Research run input (from HTTP handler) ──

export interface CreateResearchInput {
	readonly query: string
	readonly mode?: string | undefined
	readonly context?:
		| {
				anchorDomain?: string | undefined
				subjects?:
					| Array<{ table: 'companies' | 'contacts'; id: string }>
					| undefined
				selector?:
					| { table: 'companies'; filter: Record<string, unknown> }
					| undefined
				hints?:
					| {
							language?: 'ca' | 'es' | 'en' | undefined
							recency_days?: number | undefined
							location?: string | undefined
							min_employees?: number | undefined
							max_employees?: number | undefined
					  }
					| undefined
		  }
		| undefined
	readonly schemaName?: string | undefined
	readonly budgetCents?: number | undefined
	readonly paidBudgetCents?: number | undefined
	readonly autoApprovePaidCents?: number | undefined
	readonly idempotencyKey?: string | undefined
	readonly confirm?: boolean | undefined
	readonly forceFresh?: boolean | undefined
}

// Resolved instruction layer for a run: ordered prompt segments and a
// fingerprint that changes when the underlying templates do, so editing or
// swapping a template invalidates the run cache. The app layer resolves these
// in the request scope and passes them in — research never resolves them.
export interface ResolvedInstructions {
	readonly segments: ReadonlyArray<string>
	readonly fingerprint: string
	readonly templateIds: ReadonlyArray<string>
	readonly templateNames: ReadonlyArray<string>
}

// Clone a succeeded run as a `cache_hit` so an identical query skips the fiber.
// The findings / brief / token columns are copied straight from the source row to
// the clone inside Postgres (INSERT … SELECT), so the stored value never makes a
// round trip through JS. Returns null when the cached run is gone or no longer
// succeeded, so the caller runs a fresh query instead.
export const cloneCacheHitRun = (params: {
	readonly sql: SqlClient.SqlClient
	readonly cachedId: string
	readonly organizationId: string
	readonly userId: string
	readonly input: CreateResearchInput
	readonly templateIds: ReadonlyArray<string>
	readonly templateNames: ReadonlyArray<string>
	readonly templateFingerprint: string
}) =>
	Effect.gen(function* () {
		const {
			sql,
			cachedId,
			organizationId,
			userId,
			input,
			templateIds,
			templateNames,
			templateFingerprint,
		} = params
		const clonedRows = yield* sql<{ id: string }>`
			INSERT INTO research_runs (
				organization_id,
				query, mode, schema_name, kind, status, context,
				findings, brief_md,
				tokens_in, tokens_out,
				cost_cents, paid_cost_cents,
				idempotency_key, created_by,
				template_ids, template_names, template_fingerprint,
				started_at, completed_at
			)
			SELECT
				${organizationId},
				${input.query},
				${input.mode ?? 'deep'},
				${input.schemaName ?? null},
				'cache_hit',
				'succeeded',
				${JSON.stringify(input.context ?? {})}::jsonb,
				src.findings, src.brief_md,
				-- A reused answer ran no model, so it consumed nothing.
				0, 0,
				0, 0,
				${input.idempotencyKey ?? null},
				${userId},
				${JSON.stringify(templateIds)}::jsonb, ${JSON.stringify(templateNames)}::jsonb, ${templateFingerprint},
				now(), now()
			FROM research_runs src
			WHERE src.id = ${cachedId} AND src.status = 'succeeded'
			RETURNING id
		`
		const cloned = clonedRows[0]
		if (!cloned) return null
		const clonedId = cloned.id
		// Clone source attributions from the cached run.
		// research_run_sources / research_links are RLS-checked
		// against `current_setting('app.current_org_id')`, so the
		// org id has to be in the row, not just on the parent run.
		yield* sql`
			INSERT INTO research_run_sources (organization_id, research_id, source_id, local_ref, fetched_at, cost_cents)
			SELECT ${organizationId}, ${clonedId}, source_id, local_ref, fetched_at, 0
			FROM research_run_sources
			WHERE research_id = ${cachedId}
			ON CONFLICT DO NOTHING
		`
		if (input.context?.subjects) {
			for (const s of input.context.subjects) {
				yield* sql`
					INSERT INTO research_links (organization_id, research_id, subject_table, subject_id, link_kind)
					VALUES (${organizationId}, ${clonedId}, ${s.table}, ${s.id}, 'input')
					ON CONFLICT DO NOTHING
				`
			}
		}
		yield* Effect.logInfo('research.cache_hit').pipe(
			Effect.annotateLogs({
				user_id: userId,
				research_id: clonedId,
				source_research_id: cachedId,
			}),
		)
		return { id: clonedId }
	})

// ── ResearchService ──

export class ResearchService extends Context.Service<ResearchService>()(
	'ResearchService',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const agentLlm = yield* AgentLanguageModel
			const extractLlm = yield* ExtractLanguageModel
			const writerLlm = yield* WriterLanguageModel
			// An approved `discover_contacts` follow-up runs the same contact
			// discovery the in-loop tool does, so the service is resolved here and
			// reused in `runFollowup`. Already ambient (the in-loop tool needs it),
			// so this adds no new dependency to the layer.
			const contactDiscovery = yield* ContactDiscovery
			// The toolkit handlers are resolved per-run inside `runFiber` (not
			// here) so each run's paid tools charge that run's Budget. Resolving
			// them there discharges `HandlersFor<Tools>` inside the fiber, so it
			// never leaks out as a lingering context requirement.

			const ORPHAN_AGE_SECONDS = 900

			// Heartbeat cadence, the staleness window before a run counts as crashed,
			// and how often the sweep runs. These only tune timing, so a default is
			// safe when a var is unset — unlike the vars that switch behavior on or off.
			const heartbeatIntervalSeconds = yield* Config.int(
				'RESEARCH_HEARTBEAT_INTERVAL_SEC',
			).pipe(Config.withDefault(30))
			const orphanStaleSeconds = yield* Config.int(
				'RESEARCH_ORPHAN_STALE_SEC',
			).pipe(Config.withDefault(90))
			const orphanSweepIntervalSeconds = yield* Config.int(
				'RESEARCH_ORPHAN_SWEEP_INTERVAL_SEC',
			).pipe(Config.withDefault(60))
			// Whole-run wall-clock cap (applied on the run pipe below). Generous
			// default — above a deep run's normal duration — so it only fires on a
			// run that wedges, never on a slow-but-healthy one.
			const runDeadlineSeconds = yield* Config.int(
				'RESEARCH_RUN_DEADLINE_SEC',
			).pipe(Config.withDefault(1200))

			// Fail 'running' rows whose worker died — detected by a heartbeat that
			// stopped refreshing (a live long run keeps beating, so it is spared).
			// Rows from before heartbeats existed fall back to age. A paid run isn't
			// safe to silently re-run, so it is not re-dispatched.
			const sweepOrphanRuns = (maxAgeSeconds: number) =>
				Effect.gen(function* () {
					// COALESCE guards NULL findings: jsonb_set(NULL, …) returns
					// NULL, which would silently drop the error field on rows
					// that never wrote findings (newly-queued rows especially).
					// `seed:%` rows are dev fixtures, not orphans.
					const running = yield* sql<{ id: string }>`
						UPDATE research_runs
						SET status = 'failed',
							reason_code = ${'internal_error' satisfies ReasonCode},
							findings = jsonb_set(COALESCE(findings, '{}'::jsonb), '{error}', '"server restarted mid-run"'),
							completed_at = now(),
							updated_at = now()
						WHERE status = 'running'
						  AND (
						        heartbeat_at < now() - interval '1 second' * ${orphanStaleSeconds}
						     OR (heartbeat_at IS NULL AND started_at < now() - interval '1 second' * ${maxAgeSeconds})
						  )
						  AND (idempotency_key IS NULL OR idempotency_key NOT LIKE 'seed:%')
						RETURNING id
					`
					return { running }
				}).pipe(sql.withTransaction)

			// Active runs: pubsub channels and fibers for cancellation
			const activePubSubs = yield* Ref.make(
				HashMap.empty<string, PubSub.PubSub<ResearchEvent>>(),
			)
			const activeFibers = yield* Ref.make(
				HashMap.empty<string, Fiber.Fiber<void, unknown>>(),
			)

			// Fiber concurrency gate. Shared permit pool, waiters queued per
			// userId — releases round-robin across partitions so one tenant's
			// burst cannot starve the rest. Capacity is fixed at service
			// construction; changing it requires a restart.
			const maxConcurrentFibersTotal = yield* Config.int(
				'RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL',
			)
			// Hard cap on reflect-loop rounds per run. Bounds how far the agent can
			// search, so it is required with no default — like the concurrency cap.
			const maxAgentSteps = yield* Config.int('RESEARCH_MAX_AGENT_STEPS')
			// How many prompt tokens the reflect loop may reach before it stops
			// searching, so a bigger-context model can look further. Required with no
			// default — set per the chosen agent model's context window.
			const maxLoopPromptTokens = yield* Config.int(
				'RESEARCH_MAX_LOOP_PROMPT_TOKENS',
			)
			// System ceiling on monthly paid spend; the per-call cap check takes the
			// min of this and the user's cap. Already set in production config, with a
			// default so local and test boots don't need it.
			const monthlyCapHardCeilingCents = yield* Config.int(
				'RESEARCH_MONTHLY_CAP_HARD_CEILING_CENTS',
			).pipe(Config.withDefault(10000))
			// What a company may spend on paid calls in a month before it has set a
			// figure of its own.
			const defaultMonthlyCapCents = yield* Config.int(
				'RESEARCH_DEFAULT_PAID_MONTHLY_CAP_CENTS',
			).pipe(Config.withDefault(3000))
			// Most companies one selector run may fan out across, so a broad filter
			// can't spawn an unbounded number of leaf runs.
			const selectorMaxCompanies = yield* Config.int(
				'RESEARCH_SELECTOR_MAX_COMPANIES',
			).pipe(Config.withDefault(100))
			const fiberSem = yield* PartitionedSemaphore.make<string>({
				permits: maxConcurrentFibersTotal,
			})

			// Dispatch channel: create() offers a queued run here; the
			// layer-scoped consumer (below) drains it and runs each job on the
			// service's own connection. Unbounded so create() never blocks —
			// concurrency is bounded by the permit pool above. research_runs is
			// the durable record and this queue is only an in-process hand-off,
			// so the reconcile below re-offers any run left queued.
			const dispatch = yield* Queue.unbounded<{
				researchId: string
				userId: string
			}>()

			// Re-offer every committed queued run to the dispatch queue. create()
			// also offers on the request path, but it does so while the run's row is
			// still uncommitted in the request transaction, so the consumer's own
			// connection may not see it yet. This runs outside any request
			// transaction, so it picks up every run left queued — a raced offer, a
			// crash, or another process. The consumer skips runs already in flight,
			// so re-offers never double-run.
			const reofferQueued = Effect.gen(function* () {
				const pending = yield* sql<{ id: string; createdBy: string }>`
					SELECT id, created_by FROM research_runs
					WHERE status = 'queued'
					  AND (idempotency_key IS NULL OR idempotency_key NOT LIKE 'seed:%')
					-- Oldest first, capped at the concurrency limit so a large backlog
					-- drains in waves instead of forking every run at once.
					ORDER BY created_at
					LIMIT ${maxConcurrentFibersTotal}
				`
				yield* Effect.forEach(
					pending,
					row =>
						Queue.offer(dispatch, {
							researchId: row.id,
							userId: row.createdBy,
						}),
					{ discard: true },
				)
				if (pending.length > 0) {
					yield* Effect.logInfo(
						'research.dispatch: re-offered queued runs',
					).pipe(Effect.annotateLogs({ count: pending.length }))
				}
			})

			// ── Event sink (observability: webhooks, metrics) ──
			const eventSink = yield* ResearchEventSink

			// ── Helpers ──

			const publishEvent = (
				researchId: string,
				type: ResearchEventType,
				data: unknown,
			) =>
				Effect.gen(function* () {
					const map = yield* Ref.get(activePubSubs)
					const maybePubSub = HashMap.get(map, researchId)
					if (maybePubSub._tag === 'Some') {
						yield* PubSub.publish(maybePubSub.value, {
							type,
							researchId,
							timestamp: DateTime.nowUnsafe().toString(),
							data,
						})
					}
					// Fire to external observability (webhooks, metrics)
					yield* eventSink.fire(`research.${type.replace('run.', '')}`, {
						researchId,
						...(typeof data === 'object' && data !== null ? data : { data }),
					})
				})

			// Which of the records a caller named are not this organization's to
			// read. Record ids are not secret — they turn up in exports, old links
			// and earlier answers — so naming one is not proof of being allowed it.
			// The table name is chosen between two written-out statements rather
			// than interpolated, the same way `attach` does it.
			const subjectsNotOwned = (
				organizationId: string,
				subjects: ReadonlyArray<{ table: string; id: string }>,
			) =>
				Effect.gen(function* () {
					const missing: Array<{ table: string; id: string }> = []
					for (const s of subjects) {
						// A record id is always a uuid. Anything else cannot name a row
						// here, and handing it to a uuid column raises a cast error the
						// caller would meet as a 500 rather than as "no such record".
						if (!isValidUuid(s.id)) {
							missing.push(s)
							continue
						}
						const [row] =
							s.table === 'companies'
								? yield* sql<{ id: string }>`
									SELECT id FROM companies
									WHERE id = ${s.id}
									  AND organization_id = ${organizationId}
									  AND deleted_at IS NULL
									LIMIT 1
								`
								: yield* sql<{ id: string }>`
									SELECT id FROM contacts
									WHERE id = ${s.id}
									  AND organization_id = ${organizationId}
									  AND deleted_at IS NULL
									LIMIT 1
								`
						if (!row) missing.push(s)
					}
					return missing
				})

			// The run's own connection is not scoped to an organization, so every
			// query here says which one it is reading for. Without that, an id from
			// another organization reads back that organization's row.
			const snapshotSubjects = (
				organizationId: string,
				subjects: Array<{ table: string; id: string }>,
			) =>
				Effect.gen(function* () {
					const snapshots = []
					for (const s of subjects) {
						// A company's website, mailbox and number are rows now, not
						// columns. They are read back onto the picture of the company
						// under the names they always had, because that picture is what
						// grounds the whole run: the domain here is how the run tells the
						// company it was asked about from a same-named one somewhere
						// else. Losing it would not fail — it would quietly research the
						// wrong company.
						const reachable =
							s.table === 'companies'
								? sql`,
										(SELECT ch.address FROM channels ch
											WHERE ch.subject_table = 'companies' AND ch.subject_id = t.id
												AND ch.organization_id = ${organizationId}
												AND ch.channel = 'website'
											ORDER BY ch.is_primary DESC LIMIT 1) AS website,
										(SELECT ch.address FROM channels ch
											WHERE ch.subject_table = 'companies' AND ch.subject_id = t.id
												AND ch.organization_id = ${organizationId}
												AND ch.channel = 'email'
											ORDER BY ch.is_primary DESC LIMIT 1) AS email,
										(SELECT ch.address FROM channels ch
											WHERE ch.subject_table = 'companies' AND ch.subject_id = t.id
												AND ch.organization_id = ${organizationId}
												AND ch.channel = 'phone'
											ORDER BY ch.is_primary DESC LIMIT 1) AS phone`
								: sql``
						const [row] = yield* sql`
							SELECT t.*, t.version${reachable} FROM ${sql(s.table)} t
							WHERE t.id = ${s.id}
								AND t.organization_id = ${organizationId}
								AND t.deleted_at IS NULL
							LIMIT 1
						`
						if (row) {
							snapshots.push({
								...s,
								snapshot: row,
								expected_version: (row as { version: number }).version,
							})
						}
					}
					return snapshots
				})

			// Recompute a group parent's status from its children: still running if
			// any child is in flight, failed if any finished without success, needing
			// a read if any child needs one, else succeeded. A batch reporting a clean
			// success would bury the one result somebody still has to read. Sets
			// completed_at once no child is in flight.
			const rollupParentStatus = (parentId: string) =>
				sql`
					UPDATE research_runs
					SET status = CASE
						WHEN (SELECT COUNT(*) FILTER (WHERE status IN ('queued','running'))
							FROM research_runs WHERE parent_id = ${parentId} AND status != 'deleted') > 0
						THEN 'running'
						WHEN (SELECT COUNT(*) FILTER (WHERE status IN ('failed', 'no_reliable_data', 'cancelled'))
							FROM research_runs WHERE parent_id = ${parentId} AND status != 'deleted') > 0
						THEN 'failed'
						WHEN (SELECT COUNT(*) FILTER (WHERE status = 'succeeded_low_confidence')
							FROM research_runs WHERE parent_id = ${parentId} AND status != 'deleted') > 0
						THEN 'succeeded_low_confidence'
						ELSE 'succeeded'
					END,
					completed_at = CASE
						WHEN (SELECT COUNT(*) FILTER (WHERE status IN ('queued','running'))
							FROM research_runs WHERE parent_id = ${parentId} AND status != 'deleted') = 0
						THEN now() ELSE completed_at
					END,
					-- A group spends nothing on its own row; its cost is the sum of
					-- its children (each child stamps its own cost before rolling up).
					cost_cents = COALESCE((SELECT SUM(cost_cents)::int
						FROM research_runs WHERE parent_id = ${parentId} AND status != 'deleted'), 0),
					paid_cost_cents = COALESCE((SELECT SUM(paid_cost_cents)::int
						FROM research_runs WHERE parent_id = ${parentId} AND status != 'deleted'), 0),
					updated_at = now()
					-- Never overwrite a group that was explicitly cancelled or deleted:
					-- a stopped group stays stopped even if a straggling child ends later.
					WHERE id = ${parentId} AND status NOT IN ('cancelled', 'deleted')
				`

			/** Merge leaf findings into parent group row (advisory-locked). */
			const mergeToParent = (parentId: string, leafFindings: unknown) =>
				Effect.gen(function* () {
					yield* sql`SELECT pg_advisory_xact_lock(hashtext(${parentId}))`
					yield* sql`
						UPDATE research_runs
						SET findings = jsonb_set(
							findings,
							'{leaf_results}',
							COALESCE(findings->'leaf_results', '[]'::jsonb)
								|| ${JSON.stringify([leafFindings])}::jsonb
						),
						updated_at = now()
						WHERE id = ${parentId}
					`
					yield* rollupParentStatus(parentId)
				}).pipe(sql.withTransaction)

			// Roll a group parent up from its children under the same advisory lock,
			// without appending findings — used when a leaf ends without success, so
			// an all-failed group still resolves instead of hanging.
			const rollupParentLocked = (parentId: string) =>
				Effect.gen(function* () {
					yield* sql`SELECT pg_advisory_xact_lock(hashtext(${parentId}))`
					yield* rollupParentStatus(parentId)
				}).pipe(sql.withTransaction)

			// Cancel every leaf of a group that is still in flight, so cancelling the
			// group stops the whole fan-out instead of leaving its leaves running and
			// spending. Interrupt each leaf's fiber before flipping its row: an
			// interrupted leaf releases its own row lock first, so the flip can't
			// deadlock against a leaf caught mid-write. The group keeps its own
			// 'cancelled' status — the rollup guard stops a straggler from reviving it.
			const cancelGroupLeaves = (groupId: string) =>
				Effect.gen(function* () {
					const leaves = yield* sql<{ id: string }>`
						SELECT id FROM research_runs
						WHERE parent_id = ${groupId} AND status IN ('queued', 'running')
					`
					const fibers = yield* Ref.get(activeFibers)
					yield* Effect.forEach(leaves, leaf => {
						const maybeFiber = HashMap.get(fibers, leaf.id)
						return maybeFiber._tag === 'Some'
							? Fiber.interrupt(maybeFiber.value)
							: Effect.void
					})
					yield* Effect.forEach(leaves, leaf =>
						Effect.gen(function* () {
							yield* sql`
								UPDATE research_runs
								SET status = 'cancelled', completed_at = now(), updated_at = now()
								WHERE id = ${leaf.id} AND status IN ('queued', 'running')
							`
							yield* stampRunCostFromLedger(sql, leaf.id, 0)
							yield* publishEvent(leaf.id, 'run.cancelled', {})
						}),
					)
				})

			// Append a follow-up run's result onto the run that proposed it, under an
			// advisory lock. Deliberately does NOT recompute the origin's status: the
			// origin already finished, and the follow-up is extra evidence, not a child
			// whose outcome should change the origin's.
			const mergeFollowupToOrigin = (originId: string, result: unknown) =>
				Effect.gen(function* () {
					yield* sql`SELECT pg_advisory_xact_lock(hashtext(${originId}))`
					yield* sql`
						UPDATE research_runs
						SET findings = jsonb_set(
							findings,
							'{followup_results}',
							COALESCE(findings->'followup_results', '[]'::jsonb)
								|| ${JSON.stringify([result])}::jsonb
						),
						updated_at = now()
						WHERE id = ${originId}
					`
				}).pipe(sql.withTransaction)

			// Run one approved paid action in a follow-up run. Only the two real paid
			// tools run — a registry lookup or a contact discovery — and anything else
			// is refused so an unrecognized action can never spend. Arguments are
			// validated, the run's budget + monthly cap are charged (fail-closed with
			// no spend when over cap), and the result is merged back onto the origin
			// run.
			const runFollowup = (researchId: string, run: Record<string, unknown>) =>
				Effect.gen(function* () {
					const [ctxRow] = yield* sql<{
						context: {
							paid_action?: {
								tool?: unknown
								args?: unknown
								origin_run_id?: unknown
							}
						} | null
					}>`
						SELECT context FROM research_runs WHERE id = ${researchId}
					`
					const paidAction = ctxRow?.context?.paid_action
					const originId =
						typeof paidAction?.origin_run_id === 'string'
							? paidAction.origin_run_id
							: null
					// Approve already coerces the tool to a real name before spawning this
					// run; coercing again keeps the follow-up correct on its own terms.
					const tool = normalizePaidActionTool(paidAction?.tool)

					const finishFailed = (error: string) =>
						Effect.gen(function* () {
							// Merge onto the origin before marking this run terminal, so a
							// caller that sees the terminal status also sees the result —
							// the origin write is durable before the followup reports done.
							if (originId)
								yield* mergeFollowupToOrigin(originId, {
									tool: tool ?? null,
									error,
								})
							yield* sql`
								UPDATE research_runs
								SET status = 'failed',
									reason_code = ${'internal_error' satisfies ReasonCode},
									findings = ${JSON.stringify({ error })},
									completed_at = now(), updated_at = now()
								WHERE id = ${researchId} AND status = 'running'
							`
							yield* publishEvent(researchId, 'run.failed', { error })
							// A follow-up may have charged a paid lookup before failing;
							// record it. Follow-ups do no cheap search/scrape, so cost_cents
							// is 0.
							yield* stampRunCostFromLedger(sql, researchId, 0)
						})

					if (!originId)
						return yield* finishFailed('follow-up run has no origin')
					if (tool === null)
						return yield* finishFailed(
							`unsupported paid tool: ${String(paidAction?.tool)}`,
						)

					// A fresh per-call budget on the origin's frozen policy. Its
					// auto-approve gate is off (the default), since the user already
					// approved this specific action — the charge must not gate again.
					const organizationId = (run as { organizationId: string })
						.organizationId
					const createdBy =
						(run as { createdBy: string | null }).createdBy ?? ''
					const policy = (run as { paidPolicy: ResolvedPolicy }).paidPolicy
					const budgetLayer = makeBudgetLayer({
						organizationId,
						userId: createdBy,
						researchId,
						policy,
						defaultCapCents: defaultMonthlyCapCents,
						systemCeiling: monthlyCapHardCeilingCents,
					}).pipe(Layer.provide(Layer.succeed(SqlClient.SqlClient)(sql)))

					if (tool === 'discover_contacts') {
						const args = (paidAction?.args ?? {}) as {
							company_name?: unknown
							domain?: unknown
							country?: unknown
						}
						const companyName =
							typeof args.company_name === 'string'
								? args.company_name
								: undefined
						const domain =
							typeof args.domain === 'string' ? args.domain : undefined
						const country =
							typeof args.country === 'string' ? args.country : undefined
						if (!companyName || !domain)
							return yield* finishFailed(
								'discover_contacts requires company_name and domain',
							)

						// Reuse this follow-up's id + budget so the enrichment/verify spend
						// lands on the run and its cap applies — the same in-loop path the
						// discover_contacts tool takes, just driven by an approved action.
						const result = yield* Effect.gen(function* () {
							const budget = yield* Budget
							return yield* contactDiscovery.discover({
								companyName,
								domain,
								country,
								runContext: { researchId, budget },
							})
						}).pipe(Effect.provide(budgetLayer))

						// Spend refused mid-discovery leaves nothing to merge — fail closed
						// so the terminal status reflects it. (approval_required cannot
						// happen: this budget does not enforce the auto-approve gate.)
						if (result.status === 'budget_exceeded')
							return yield* finishFailed('paid budget exhausted')
						if (result.status === 'approval_required')
							return yield* finishFailed(`approval required for ${result.tool}`)

						// Merge onto the origin before marking this run terminal, so a
						// caller that sees 'succeeded' also sees the contacts recorded.
						yield* mergeFollowupToOrigin(originId, {
							tool: 'discover_contacts',
							result,
						})
						yield* sql`
							UPDATE research_runs
							SET status = 'succeeded',
								findings = ${JSON.stringify({ paid_action_result: result })},
								completed_at = now(), updated_at = now()
							WHERE id = ${researchId} AND status = 'running'
						`
						// Record the paid enrichment/verify charges from the ledger. The
						// follow-up does no cheap search/scrape, so cost_cents is 0.
						yield* stampRunCostFromLedger(sql, researchId, 0)
						yield* publishEvent(researchId, 'run.succeeded', {})
						return
					}

					// registry_lookup
					const args = (paidAction?.args ?? {}) as {
						country?: unknown
						tax_id?: unknown
						query?: unknown
					}
					const countryRaw =
						typeof args.country === 'string' ? args.country.toUpperCase() : null
					if (!countryRaw)
						return yield* finishFailed('registry_lookup requires a country')
					if (!Schema.is(AcceptedCountry)(countryRaw))
						return yield* finishFailed(`unsupported country: ${countryRaw}`)
					const country = countryRaw
					const taxId =
						typeof args.tax_id === 'string' ? args.tax_id : undefined
					const query = typeof args.query === 'string' ? args.query : undefined

					const outcome = yield* Effect.gen(function* () {
						const budget = yield* Budget
						const registry = yield* RegistryRouter
						// Deterministic key: an approve-retry reuses the same follow-up id,
						// so re-charging the same lookup is a no-op, never a double spend.
						const key = `${researchId}:registry:${country}:${taxId ?? query ?? ''}`
						yield* budget.chargePaid(
							'registry',
							REGISTRY_LOOKUP_COST_CENTS,
							'registry_lookup',
							key,
						)
						return yield* registry.lookup({ country, taxId, query })
					}).pipe(Effect.provide(budgetLayer), Effect.result)

					if (outcome._tag === 'Failure') {
						// Over the monthly cap the charge is refused before any spend row
						// is written, so this fails closed with no money moved.
						const err = outcome.failure as { _tag?: string }
						return yield* finishFailed(err._tag ?? 'paid lookup failed')
					}

					// Merge onto the origin before marking this run terminal, so a caller
					// that sees 'succeeded' also sees the result already recorded.
					yield* mergeFollowupToOrigin(originId, {
						tool: 'registry_lookup',
						result: outcome.success,
					})
					yield* sql`
						UPDATE research_runs
						SET status = 'succeeded',
							findings = ${JSON.stringify({ paid_action_result: outcome.success })},
							completed_at = now(), updated_at = now()
						WHERE id = ${researchId} AND status = 'running'
					`
					// Record the paid registry lookup this follow-up charged. It does no
					// cheap search/scrape, so cost_cents is 0.
					yield* stampRunCostFromLedger(sql, researchId, 0)
					yield* publishEvent(researchId, 'run.succeeded', {})
				})

			// Release a run's in-memory resources on any exit — success, failure, or
			// an interrupt while it is still waiting for a concurrency slot. Applied
			// around the whole job below (permit wait included), not inside it, so a
			// cancel before the run acquires a slot still shuts the channel down and
			// clears the maps.
			const cleanupRun = (researchId: string) =>
				Effect.gen(function* () {
					// Shut the channel before dropping the map entry so the terminal
					// signal reaches subscribers; otherwise the subscriber's event
					// stream stays open until the HTTP socket drops.
					const pubsubMap = yield* Ref.get(activePubSubs)
					const maybePubSub = HashMap.get(pubsubMap, researchId)
					if (maybePubSub._tag === 'Some') {
						yield* PubSub.shutdown(maybePubSub.value)
					}
					yield* Ref.update(activePubSubs, m => HashMap.remove(m, researchId))
					yield* Ref.update(activeFibers, m => HashMap.remove(m, researchId))
				})

			// ── Core: run a single research fiber ──

			// Runs on the service's own connection, outside any request, so nothing
			// has told the database which organization this is for. Anything here
			// that reads a company, a contact or their channels has to say so
			// itself — `AND organization_id = …`, taken off the run row. The rest of
			// what this reads is keyed on the run's own id, which belongs to one
			// organization already and never comes from a caller.
			const runFiber = (researchId: string, userId: string) =>
				Effect.gen(function* () {
					// Claim the run: proceed only if it is still queued. The consumer
					// forks this after acquiring a concurrency permit, so the flip to
					// running lands when work actually starts (a run waiting for a
					// slot stays queued), and a run cancelled or already claimed while
					// it waited is skipped.
					const [claimed] = yield* sql<{ id: string }>`
						UPDATE research_runs
						SET status = 'running', started_at = now(), heartbeat_at = now(), updated_at = now()
						WHERE id = ${researchId} AND status = 'queued'
						RETURNING id
					`
					if (!claimed) return

					// Refresh the heartbeat while this run works, so the sweep can
					// tell a live long-running job from one whose worker died. Forked
					// into the run's own scope (below), so it stops when the run ends.
					yield* sql`
						UPDATE research_runs SET heartbeat_at = now()
						WHERE id = ${researchId} AND status = 'running'
					`.pipe(
						Effect.catchCause(() => Effect.void),
						Effect.repeat(
							Schedule.spaced(`${heartbeatIntervalSeconds} seconds`),
						),
						Effect.forkScoped,
					)

					yield* publishEvent(researchId, 'run.started', {})

					// Load the run row
					const [run] = yield* sql`
						SELECT * FROM research_runs WHERE id = ${researchId}
					`
					if (!run) return

					// The run's inputs live on the row so the dispatch consumer can
					// reconstruct it (including after a restart): segments shape the
					// phase-1 prompt, the fingerprint keys the cache write-back.
					const segments = ((
						run as { instructionSegments?: ReadonlyArray<string> }
					).instructionSegments ?? []) as ReadonlyArray<string>
					const templateFingerprint =
						(run as { templateFingerprint?: string | null })
							.templateFingerprint ?? ''

					const context = run['context'] as CreateResearchInput['context']
					const schemaName =
						(run as { schemaName: string | null }).schemaName ?? 'freeform'

					// ── Checkpoint state from any prior partial run ──
					// `phase` + `research_text` + `findings` are persisted after each
					// phase; on resume we skip already-completed phases.
					const checkpointPhase = ((run as { phase?: number | null }).phase ??
						0) as number
					const cachedResearchText = (run as { researchText?: string | null })
						.researchText
					const [findingsRow] = yield* sql<{
						findings: Record<string, unknown> | null
					}>`
						SELECT findings FROM research_runs WHERE id = ${researchId}
					`
					const existingFindings = findingsRow?.findings ?? null
					const existingFindingsHasValue =
						existingFindings !== null &&
						typeof existingFindings === 'object' &&
						Object.keys(existingFindings).length > 0 &&
						!('error' in existingFindings)

					// What this run has really cost. A resumed run carries the earlier
					// attempt's totals forward, so finishing adds to them instead of
					// replacing them with only what this attempt spent.
					const meter = yield* UsageMeter
					yield* meter.seed(
						(run as { costCents?: number | null }).costCents ?? 0,
						(run as { tokensIn?: number | null }).tokensIn ?? 0,
						(run as { tokensOut?: number | null }).tokensOut ?? 0,
					)
					const stampRunUsage = Effect.gen(function* () {
						const usage = yield* meter.snapshot()
						yield* stampRunCostFromLedger(
							sql,
							researchId,
							usage.costCents,
							usage,
						)
					})

					// Snapshot subjects if anchored. A subject that does not read back
					// stops the run rather than leaving it to carry on unanchored: the
					// snapshot is what tells the run which company it was asked about,
					// so without it the run would search on the free text alone and
					// report the result as though the record had been read.
					const askedSubjects = context?.subjects ?? []
					const subjects =
						askedSubjects.length > 0
							? yield* snapshotSubjects(
									(run as { organizationId: string }).organizationId,
									askedSubjects,
								)
							: []
					if (subjects.length !== askedSubjects.length) {
						const read = new Set(subjects.map(s => `${s.table}:${s.id}`))
						return yield* new SubjectUnavailable({
							subjects: askedSubjects.filter(
								s => !read.has(`${s.table}:${s.id}`),
							),
						})
					}

					// The keys that prove the fetched evidence is about the requested
					// company (its name or its own domain). A scan or freeform run with
					// no anchored subject is not entity-gated (targets is null). The
					// verdict is computed from the phase-1 evidence below and, on resume,
					// read back from the row so the weak-match handling survives a restart.
					const subjectTargets = subjects.map(s => {
						const row = s.snapshot as Record<string, unknown>
						return {
							table: s.table,
							name: typeof row['name'] === 'string' ? row['name'] : undefined,
							website:
								typeof row['website'] === 'string' ? row['website'] : undefined,
						}
					})
					// The caller's location hint, folded into the entity targets' place keys
					// so the city verification below can tell the queried company "in that
					// city" from a same-named company (or a stale mention) elsewhere.
					const hintLocation = (
						context?.hints as { location?: string } | undefined
					)?.location
					// `let`, not `const`: when the seeded anchor domain redirects to a
					// different host (a rebrand), the seed below folds that destination
					// in as a strong-match key so the run grounds on the live site.
					let entityTargets = deriveEntityTargets({
						schemaName,
						anchorDomain: context?.anchorDomain,
						query: (run as { query: string }).query,
						subjects: subjectTargets,
						location: hintLocation,
					})
					let entityMatch: EntityMatch | null =
						(run as { entityMatch?: EntityMatch | null }).entityMatch ?? null

					// The target's display name, to re-anchor a web search that dropped it:
					// an anchored subject's own name, else the name read from the query. Used
					// only when `entityTargets` is set (an enrichment/contact run with one
					// subject); a scan/freeform run never scopes its searches to a name.
					const entityName =
						subjectTargets
							.map(s => s.name)
							.find((n): n is string => n != null && n.trim() !== '') ??
						queryName((run as { query: string }).query)

					// The company's own official site to fetch up front, when the caller
					// gave its domain — a target-correction re-run's anchor, an anchored
					// subject's website, or a domain written into the query. The instruction
					// nudges the model there; the seeded scrape below guarantees the page is
					// fetched even if the model never navigates to it.
					const anchorHost = deriveAnchorHost({
						schemaName,
						anchorDomain: context?.anchorDomain,
						query: (run as { query: string }).query,
						subjects: subjectTargets,
					})
					const anchorInstruction =
						anchorHost !== undefined
							? `\n\n${ANCHOR_DOMAIN_INSTRUCTION(anchorHost)}`
							: ''

					// A follow-up run performs one approved paid call instead of the
					// normal research loop, then merges the result onto the origin run.
					if ((run as { kind?: string }).kind === 'followup') {
						yield* runFollowup(researchId, run as Record<string, unknown>)
						return
					}

					// Resolve the schema
					const outputSchema = schemaRegistry[schemaName]
					if (!outputSchema) {
						yield* sql`
							UPDATE research_runs
							SET status = 'failed',
								reason_code = ${'internal_error' satisfies ReasonCode},
								findings = ${JSON.stringify({ error: `Unknown schema: ${schemaName}` })},
								completed_at = now(), updated_at = now()
							WHERE id = ${researchId} AND status = 'running'
						`
						yield* publishEvent(researchId, 'run.failed', {
							error: `Unknown schema: ${schemaName}`,
						})
						return
					}

					// Tool log accumulator
					const toolLog = yield* Ref.make<ToolLogEntry[]>([])

					// True once a registry_lookup this run resolved the target company by
					// its legal name — a strong, site-independent confirmation the run
					// reached the right entity. Stamped onto the findings so the eval can
					// count it toward grounding even when the company's own site was never
					// fetched; nothing in the product reads it. A resumed run skips phase 1
					// and so never sets it (the eval always runs fresh, so it never resumes).
					let registryConfirmed = false
					const withRegistryFlag = (
						obj: Record<string, unknown>,
					): Record<string, unknown> =>
						registryConfirmed ? { ...obj, registry_confirmed: true } : obj

					// Fail a run closed as no_reliable_data because nothing in its evidence
					// was about the requested company. Called by the phase-1 entity gate and
					// again on resume, where that gate is skipped. Takes only 'absent' — a
					// glancing mention still has something worth showing a person, so it
					// finishes marked for review rather than being thrown away.
					const failClosedOnEntity = (
						verdict: Extract<EntityMatch, 'absent'>,
					) =>
						Effect.gen(function* () {
							const toolLogNow = yield* Ref.get(toolLog)
							yield* sql`
								UPDATE research_runs
								SET status = 'no_reliable_data',
									reason_code = ${'entity_mismatch' satisfies ReasonCode},
									phase = 1,
									entity_match = ${verdict},
									findings = ${JSON.stringify(
										withRegistryFlag({
											error:
												'The fetched pages were not clearly about the requested company, so the findings could not be grounded.',
											reason: 'no_reliable_data',
										}),
									)},
									tool_log = ${JSON.stringify(toolLogNow)},
									completed_at = now(),
									updated_at = now()
								WHERE id = ${researchId} AND status = 'running'
							`
							yield* publishEvent(researchId, 'run.no_reliable_data', {
								reason: 'entity_mismatch',
								entityMatch: verdict,
							})
							// Stamp this run's cost before the group rolls up, so the parent
							// sums a child that already knows what it spent.
							yield* stampRunUsage
							const parentGroupId = (run as { parentId: string | null })
								.parentId
							if (parentGroupId) yield* rollupParentLocked(parentGroupId)
						})

					// Build system prompt. The agent sees the same trimmed on-file view
					// the extraction pass does, so the two never disagree about what is
					// already known.
					const subjectContext =
						subjects.length > 0
							? `\n\nSubject data (frozen snapshot):\n${JSON.stringify(subjectsForPrompt(subjects), null, 2)}`
							: ''
					const hints = context?.hints as
						| { language?: string; recency_days?: number; location?: string }
						| undefined
					const hintsContext = hints
						? `\n\nHints: language=${hints.language ?? 'en'}, recency=${hints.recency_days ?? 'any'}, location=${hints.location ?? 'any'}`
						: ''
					const systemPrompt = buildResearchSystemPrompt({
						schemaName,
						subjectContext,
						hintsContext,
						segments,
					})

					// ── Phase 1: LLM research pass ──
					// Wall-clock epoch for the gap rounds' stop-with-margin check —
					// aligned with the whole-run deadline, which starts with the run body.
					const runStartedAtMs = DateTime.toEpochMillis(DateTime.nowUnsafe())
					// Skipped on resume if the checkpoint captured research_text.
					let researchText: string
					// Evidence-only corpus (tool results, no model prose) for the value
					// guard; empty on a resume that skips phase 1.
					let evidenceText = ''
					// How many reflect-loop rounds phase 1 ran, for the run's quality
					// signal; stays 0 on a resume that skips phase 1.
					let runRounds = 0
					// Every piece of real page text gathered this run — the corpus the value
					// guard checks findings against. Kept separate from the model-facing
					// transcript (capped per page); empty on a resume that skips phase 1.
					const scrapeCorpus: Array<{
						urlHash: string
						text: string
						// The page's own host, so an own-domain page grounds on its host even
						// when its body never spells the company name (an offices/team page).
						host: string | undefined
						// Whether this is the whole page or just the one passage a search
						// quoted from it. Both are real text worth citing, but only a whole
						// page shows what the page is about.
						kind: 'page' | 'passage'
					}> = []
					// Hosts of the search results this run surfaced. The extraction prompt
					// tells the model to cite a result's URL for a fact seen only in its
					// snippet, so a citation to one of these grounds even when the page itself
					// was never fetched — the scalar/value guards still hold each value to the
					// gathered evidence, so this recovers real facts without loosening truth.
					const searchResultHosts = new Set<string>()
					// The anchor site fetched up front (see below): its url hash to link as
					// a source, and its capped rendered text to prepend to the transcript so
					// phase-2 extraction reads the official site even if the model never did.
					const seededAnchorHashes: string[] = []
					const seededTranscriptParts: string[] = []
					// A national-register lookup done up front (see below): its source-row
					// hash to link so a value taken from the register can cite it, and its
					// rendered text to add to the evidence the extraction is checked against.
					// Kept out of the entity gate, though: a register entry proves the legal
					// name is real, not that the pages the run scraped are this company's —
					// folding it in would let a lookalike's pages clear the right-company check.
					const seededRegistryHashes: string[] = []
					const seededEvidenceParts: string[] = []
					// Findings the discovery-scan retry path extracts under the shared
					// budget; undefined on every other path (which extracts in phase 2).
					let retryFindings: unknown
					// What the run's spending limit was charged for cheap work in phase 1,
					// read off the budget once phase 1 ends. Feeds the gap rounds' check
					// that there is still room for another one. Stays 0 on a resume that
					// skips phase 1 — the budget only counts this attempt.
					let cheapSpentCents = 0
					// What the phase-2 gap rounds charge on top: they run outside the
					// phase-1 Budget scope, so they tally their own scrape/search cost here
					// to keep that same check honest as the rounds go on. Stays 0 when no
					// gap round runs.
					let gapSpentCents = 0

					// Rounds of work finished so far. Carried over from the row like the
					// run's usage totals, so a run picked up again counts on from where
					// the earlier attempt stopped instead of appearing to start over.
					let progressSteps =
						(run as { progressSteps?: number | null }).progressSteps ?? 0
					// Publish the count so anyone watching the run sees it climb between
					// checkpoints. Guarded on 'running' like every other write from inside
					// the run, so a cancelled run is left alone.
					const recordProgress = Effect.gen(function* () {
						progressSteps++
						yield* sql`
							UPDATE research_runs
							SET progress_steps = ${progressSteps}, updated_at = now()
							WHERE id = ${researchId} AND status = 'running'
						`
					}).pipe(
						Effect.catchCause(cause =>
							Cause.hasInterruptsOnly(cause)
								? Effect.failCause(cause)
								: Effect.logWarning('research.progress.write_failed').pipe(
										Effect.annotateLogs({
											research_id: researchId,
											cause: Cause.pretty(cause),
										}),
									),
						),
					)

					// The company's published role mailboxes (info@, sales@, hola@), read
					// off the pages this run opened. For a company with a thin website and
					// no named executive, a department mailbox on its contact page is often
					// the only way to reach it at all.
					//
					// Only pages the run opened count, and only ones that read as this
					// company's: the single sentence a search quotes is too little to tell
					// whose page it came from, and an address is worth having only when we
					// know whose it is.
					const harvestRoleMailboxes = (): ReadonlyArray<GenericEmail> => {
						if (
							schemaName !== 'company_enrichment_v1' ||
							entityTargets === null
						)
							return []
						// Bound to a const so the narrowing survives the closures below —
						// `entityTargets` can be reassigned when a seeded domain redirects.
						const targets = entityTargets
						const opened = openedPages(scrapeCorpus)
						const keep = new Set(
							groundedSourceIds(
								classifyEntityMatchPerSource(
									targets,
									opened.map(page => ({
										sourceId: page.urlHash,
										text: page.text,
										host: page.host,
									})),
								),
							),
						)
						const grounded = opened.filter(page => keep.has(page.urlHash))
						const ownHosts = [
							...targets.domains,
							...grounded
								.map(page => page.host)
								.filter(
									(host): host is string =>
										host !== undefined && reachedOwnSite(targets, [{ host }]),
								),
						]
						return harvestGenericEmails(
							grounded.map(page => ({
								text: page.text,
								host: page.host,
								sourceId: sourceIdFor(page.urlHash),
							})),
							ownHosts,
						)
					}

					// How the citation guard fared on the last extraction. A run can extract
					// more than once — a discovery scan retries, gap rounds re-extract — and
					// what matters is the tally behind the findings that actually ship, so
					// the guard overwrites them each time rather than adding them up.
					let citationsSeen = 0
					let citationsKept = 0

					// Phase-2 extraction + every grounding guard, shared so both the
					// normal path and the discovery-scan retry run the same logic. Returns
					// the cleaned findings; the caller writes the single phase-2 checkpoint.
					const extractStructuredFindings = (
						transcript: string,
						evidenceCorpus: string,
						pages: ReadonlyArray<string> = [],
					) =>
						Effect.gen(function* () {
							yield* publishEvent(researchId, 'tool.called', {
								tool: 'llm.generateObject',
								phase: 2,
								schema: schemaName,
							})
							// The model must cite the exact fetched URL, but the transcript
							// buries URLs inside tool-result JSON — so hand it the run's fetched
							// sources explicitly and have it copy one verbatim. Without this it
							// tends to cite a tidied URL the guard can't match, or omit citations.
							const sourceRows = yield* sql<{ url: string }>`
								SELECT DISTINCT s.url
								FROM research_run_sources rs JOIN sources s ON s.id = rs.source_id
								WHERE rs.research_id = ${researchId}
								ORDER BY s.url
							`
							const sourceManifest = sourceRows.map(row => row.url).join('\n')
							const citationInstruction =
								sourceManifest.length > 0
									? `For each citation, prefer one of these exact fetched source URLs, copied verbatim — especially the company's own official website:\n\n${sourceManifest}\n\nIf a value appears only in a search result in the transcript, still include it and quote the snippet, citing that result's URL — do not drop a real fact just because its page was not fetched.`
									: "Cite the URL each value came from; if it was only a search result, quote its snippet and cite that result's URL."
							// The full fetched pages, ahead of the transcript, so a fact past the
							// transcript's per-result cut still reaches extraction. Bounded so a
							// handful of long pages can't blow up the phase-2 prompt.
							const pagesSection = (() => {
								const parts: string[] = []
								let total = 0
								for (const text of pages) {
									if (text.trim().length === 0) continue
									const remaining = MAX_EXTRACTION_PAGE_CHARS - total
									if (remaining <= 0) break
									// Cap each page so one very long page can't consume the whole
									// budget and starve the pages after it.
									const budget = Math.min(
										remaining,
										MAX_EXTRACTION_CHARS_PER_PAGE,
									)
									const slice =
										text.length > budget
											? `${text.slice(0, budget)}…[truncated]`
											: text
									parts.push(slice)
									total += slice.length
								}
								return parts.length > 0
									? `Fetched pages (primary evidence — read these first):\n\n${parts.join('\n\n---\n\n')}\n\n`
									: ''
							})()
							// The full evidence handed to extraction — reused by the focused
							// contacts rescue below so it reads exactly what the broad pass did.
							const evidenceBlock = `${pagesSection}Research transcript:\n\n${transcript}`
							// Cast schema to satisfy generateObject's Encoder constraint.
							// Registry schemas are all Structs with DecodingServices=never,
							// but Schema.Top erases that — the cast is safe.
							const structuredResponse = yield* extractLlm.generateObject({
								schema: outputSchema as typeof FreeformSchema,
								prompt: buildExtractionPrompt({
									citationInstruction,
									evidenceBlock,
									subjects: subjectsForPrompt(subjects),
									fitVerdict: schemaName === 'company_enrichment_v1',
								}),
							})
							// Fold the harvested role mailbox in before the ids are stamped, so
							// the change it offers gets an id a person can act on, and before
							// the checks below, so it is held to the same standard as every
							// other value the run produces.
							const harvestedMailboxes = harvestRoleMailboxes()
							const companySubject = subjects.find(s => s.table === 'companies')
							let result = withProposalIds(
								withRoleMailbox(
									structuredResponse.value as unknown,
									harvestedMailboxes,
									companySubject === undefined
										? undefined
										: {
												id: companySubject.id,
												version:
													typeof companySubject.expected_version === 'number'
														? companySubject.expected_version
														: null,
											},
								),
							)
							if (harvestedMailboxes.length > 0) {
								yield* Effect.annotateCurrentSpan({
									'research.generic_emails.found': harvestedMailboxes.length,
								})
							}
							// Only company_enrichment fills a profile and runs the focused rescue
							// passes below; the scan and freeform schemas have no profile to
							// measure or recover.
							const isEnrichmentRun = schemaName === 'company_enrichment_v1'
							// How much of the profile the broad pass filled on its own, before any
							// rescue or guard touched it — the number that shows an all-empty
							// answer for what it is instead of a clean run. Read off what the
							// model returned, not off `result`: the harvested mailbox folded in
							// above is the pipeline's own work, and counting it here would credit
							// the model for a field it never filled.
							if (isEnrichmentRun) {
								const broadFill = enrichmentFill(structuredResponse.value)
								const broadContacts = contactFill(structuredResponse.value)
								yield* Effect.annotateCurrentSpan({
									'research.enrichment.fields_total': broadFill.total,
									'research.enrichment.filled_broad': broadFill.filled,
									'research.enrichment.missing_broad': broadFill.missing.length,
									'research.contacts.named_broad': broadContacts.named,
									'research.contacts.titled_broad': broadContacts.titled,
								})
							}
							// The focused rescue passes below aim at one company — the subject's
							// name + its own domain — so a recovered person or fact is tied to
							// the right company.
							const rescueSnapshot = subjects[0]?.snapshot as
								| Record<string, unknown>
								| undefined
							const rescueTarget = {
								name:
									typeof rescueSnapshot?.['name'] === 'string'
										? rescueSnapshot['name']
										: (run as { query: string }).query,
								domain:
									(typeof rescueSnapshot?.['website'] === 'string'
										? rescueSnapshot['website']
										: undefined) ?? entityTargets?.domains?.[0],
							}
							// Contacts rescue: the broad pass reliably under-delivers the people
							// list, so a focused pass that pulls only named people + titles from
							// the same evidence always runs for an enrichment — the merge only
							// ever adds or completes people, and it happens before the guard
							// chain, so recovered contacts are guarded like the rest. Fail-open:
							// a rescue error keeps the broad result.
							if (isEnrichmentRun) {
								const rescue = yield* extractLlm
									.generateObject({
										schema: ContactsRescueSchema,
										prompt: contactsRescuePrompt(
											rescueTarget,
											evidenceBlock,
											sourceManifest,
										),
									})
									.pipe(
										Effect.map(r => ({
											contacts: (r.value as { contacts?: unknown }).contacts,
										})),
										Effect.catchCause(cause =>
											Cause.hasInterruptsOnly(cause)
												? Effect.failCause(cause)
												: Effect.logWarning(
														'research.contacts.rescue_failed',
													).pipe(
														Effect.annotateLogs({
															research_id: researchId,
															cause: Cause.pretty(cause),
														}),
														Effect.as({ contacts: undefined }),
													),
										),
									)
								if (
									Array.isArray(rescue.contacts) &&
									rescue.contacts.length > 0
								) {
									const broadContacts = Array.isArray(
										(result as { contacts?: unknown }).contacts,
									)
										? ((result as { contacts: unknown[] }).contacts as Array<
												Record<string, unknown>
											>)
										: []
									const merged = mergeContacts(
										broadContacts,
										rescue.contacts as Array<Record<string, unknown>>,
									)
									result = { ...(result as object), contacts: merged }
									yield* Effect.logInfo('research.contacts.rescued').pipe(
										Effect.annotateLogs({
											research_id: researchId,
											before: broadContacts.length,
											after: merged.length,
										}),
									)
								}
							}
							// Firmographics rescue: the broad pass also drops the size band and
							// tooling even when a page states them. When either is empty, a focused
							// pass fills it in (without overwriting a value the broad pass grounded);
							// an aggregator-sourced value is capped to medium by the source tier.
							if (isEnrichmentRun && needsFirmographicsRescue(result)) {
								const fRescue = yield* extractLlm
									.generateObject({
										schema: FirmographicsRescueSchema,
										prompt: firmographicsRescuePrompt(
											rescueTarget,
											evidenceBlock,
											sourceManifest,
										),
									})
									.pipe(
										Effect.map(r => ({
											enrichment: r.value as unknown,
										})),
										Effect.catchCause(() =>
											Effect.succeed({ enrichment: undefined }),
										),
									)
								const fMerged = mergeFirmographics(result, fRescue.enrichment)
								if (fMerged.filled > 0) {
									result = fMerged.findings
									yield* Effect.logInfo('research.firmographics.rescued').pipe(
										Effect.annotateLogs({
											research_id: researchId,
											filled: fMerged.filled,
										}),
									)
								}
							}
							// Focused size rescue: when the size band is STILL empty after the combined
							// pass, one more pass that asks for ONLY the employee headcount recovers it far
							// more reliably — the combined pass splits attention with tools and often drops
							// the number even when the evidence states it. Fail-open, enrichment runs only.
							if (isEnrichmentRun && needsSizeRescue(result)) {
								const sRescue = yield* extractLlm
									.generateObject({
										schema: SizeRescueSchema,
										prompt: sizeRescuePrompt(
											rescueTarget,
											evidenceBlock,
											sourceManifest,
										),
									})
									.pipe(
										Effect.map(r => ({
											enrichment: r.value as unknown,
										})),
										Effect.catchCause(() =>
											Effect.succeed({ enrichment: undefined }),
										),
									)
								const sMerged = mergeFirmographics(result, sRescue.enrichment)
								if (sMerged.filled > 0) {
									result = sMerged.findings
									yield* Effect.logInfo('research.size.rescued').pipe(
										Effect.annotateLogs({
											research_id: researchId,
											filled: sMerged.filled,
										}),
									)
								}
							}
							// How much the rescue passes recovered — the gap between this and
							// the broad fill above is the recovery those extra calls bought.
							if (isEnrichmentRun) {
								const rescuedFill = enrichmentFill(result)
								const rescuedContacts = contactFill(result)
								yield* Effect.annotateCurrentSpan({
									'research.enrichment.filled_rescued': rescuedFill.filled,
									'research.contacts.named_rescued': rescuedContacts.named,
									'research.contacts.titled_rescued': rescuedContacts.titled,
								})
							}
							const groundedRows = yield* sql<{
								localRef: string
								sourceId: string
							}>`
								SELECT local_ref AS "localRef", source_id AS "sourceId"
								FROM research_run_sources WHERE research_id = ${researchId}
							`
							// The phase-2 guard chain. Each link receives what the previous ones
							// kept and hands back what it keeps, so reading this array top to
							// bottom IS the order the guards run in — a link's position is its
							// whole contract with its neighbours. A link also reports the span
							// attributes it contributes, so the phase's grounding telemetry is
							// assembled from the links themselves.
							const organizationId = (run as { organizationId: string })
								.organizationId
							const guardChain: ReadonlyArray<GuardLink> = [
								{
									// Drop citations the model invented: keep only source_ids that
									// map to a page this run actually fetched. A proposed CRM update
									// left with no valid citation is dropped whole.
									name: 'citations',
									run: findings =>
										Effect.gen(function* () {
											const check = validateFindingCitations(
												findings,
												groundedCitationTest(groundedRows, [
													...searchResultHosts,
												]),
											)
											citationsSeen = check.total
											citationsKept = check.kept
											if (check.total > check.kept) {
												yield* Effect.logWarning(
													'research.citations.dropped',
												).pipe(
													Effect.annotateLogs({
														research_id: researchId,
														total: check.total,
														kept: check.kept,
													}),
												)
											}
											// Per-field detail: which scalar the citation guard nulled
											// and the unfetched source it was cited to, so an empty
											// field is diagnosable.
											for (const fieldDrop of check.drops.slice(
												0,
												MAX_LOGGED_FIELD_DROPS,
											)) {
												yield* Effect.logInfo('research.field.dropped').pipe(
													Effect.annotateLogs({
														research_id: researchId,
														guard: 'citation',
														field: fieldDrop.field,
														reason: 'citation_ungrounded',
														value: fieldDrop.value,
														source_id: fieldDrop.sourceId,
													}),
												)
											}
											return {
												findings: check.findings,
												spanCounts: {
													'research.citations.total': check.total,
													'research.citations.kept': check.kept,
												},
											}
										}),
								},
								{
									// Contact entity binding: drop a person whose quotes name only a
									// different company (a client testimonial or a competitor's exec
									// quoted on the target's own page), so the richer extraction
									// can't present someone else's leader as this company's contact.
									name: 'contact-entity',
									run: findings =>
										Effect.gen(function* () {
											const check = bindContactsToEntity(
												findings,
												entityTargets,
											)
											if (check.dropped > 0) {
												yield* Effect.logWarning(
													'research.contacts.wrong_entity',
												).pipe(
													Effect.annotateLogs({
														research_id: researchId,
														dropped: check.dropped,
													}),
												)
											}
											return { findings: check.findings }
										}),
								},
								{
									// Scalar grounding: hold each per-field value to "grounded or
									// absent". The citation guard has just removed fabricated
									// sources, so a scalar left without one is dropped here rather
									// than shipped unsourced; a placeholder word or a quote that
									// does not back the value goes too.
									name: 'scalars',
									run: findings =>
										Effect.gen(function* () {
											const check = guardScalarFields(findings, evidenceCorpus)
											if (
												check.droppedPlaceholder > 0 ||
												check.droppedWrongKind > 0 ||
												check.droppedUngrounded > 0 ||
												check.droppedUnsupported > 0
											) {
												yield* Effect.logWarning(
													'research.fields.ungrounded',
												).pipe(
													Effect.annotateLogs({
														research_id: researchId,
														dropped_placeholder: check.droppedPlaceholder,
														dropped_wrong_kind: check.droppedWrongKind,
														dropped_ungrounded: check.droppedUngrounded,
														dropped_unsupported: check.droppedUnsupported,
													}),
												)
											}
											// Per-field detail for the scalar guard, so an empty field
											// can be traced to why it was nulled — an on-page value
											// wrongly dropped (a guard bug) versus one genuinely absent.
											for (const fieldDrop of check.drops.slice(
												0,
												MAX_LOGGED_FIELD_DROPS,
											)) {
												yield* Effect.logInfo('research.field.dropped').pipe(
													Effect.annotateLogs({
														research_id: researchId,
														guard: 'scalar',
														field: fieldDrop.field,
														reason: fieldDrop.reason,
														value: fieldDrop.value,
														source_id: fieldDrop.sourceId ?? '',
													}),
												)
											}
											return {
												findings: check.findings,
												spanCounts: {
													'research.fields.dropped_placeholder':
														check.droppedPlaceholder,
													'research.fields.dropped_wrong_kind':
														check.droppedWrongKind,
													'research.fields.dropped_ungrounded':
														check.droppedUngrounded,
													'research.fields.dropped_unsupported':
														check.droppedUnsupported,
												},
											}
										}),
								},
								{
									// Website sanity: a scanned competitor or prospect sometimes comes
									// back with a directory's profile page ("cbinsights.com/company/…")
									// where its own site belongs. Blank that, so a stranger's URL never
									// lands in the CRM's website field. Deterministic and evidence-free,
									// so it runs here among the plain checks, ahead of the model critics.
									name: 'websites',
									run: findings =>
										Effect.gen(function* () {
											const check = guardCompanyWebsites(
												findings,
												rescueTarget.name,
											)
											if (
												check.blankedDirectory > 0 ||
												check.blankedProfilePage > 0
											) {
												yield* Effect.logWarning(
													'research.websites.blanked',
												).pipe(
													Effect.annotateLogs({
														research_id: researchId,
														blanked_directory: check.blankedDirectory,
														blanked_profile_page: check.blankedProfilePage,
													}),
												)
											}
											return {
												findings: check.findings,
												spanCounts: {
													'research.websites.blanked':
														check.blankedDirectory + check.blankedProfilePage,
												},
											}
										}),
								},
								{
									// Value provenance: the citation guard proved the cited pages were
									// fetched, not that they contain the claimed values. Drop any
									// proposed CRM write whose email/phone/tax-id value appears nowhere
									// in the run's evidence — that value was invented, real citation or
									// not. Evidence is tool results only, never the model's own prose.
									name: 'value-provenance',
									run: findings =>
										Effect.gen(function* () {
											const check = verifyValueProvenance(
												findings,
												evidenceCorpus,
											)
											if (
												check.droppedProposals > 0 ||
												check.strippedValues > 0
											) {
												yield* Effect.logWarning(
													'research.values.unsupported',
												).pipe(
													Effect.annotateLogs({
														research_id: researchId,
														dropped_proposals: check.droppedProposals,
														stripped_values: check.strippedValues,
													}),
												)
											}
											return { findings: check.findings }
										}),
								},
								{
									// Fit evidence: the verdict's disqualifiers and per-criterion
									// checks each cite a quote, but nothing above verifies it. Drop a
									// disqualifier whose quote is in no fetched page, and downgrade a
									// fit check with a fabricated quote to 'unknown', so the "auditable"
									// fit trail can't be invented.
									name: 'fit-evidence',
									run: findings =>
										Effect.gen(function* () {
											const check = guardFitEvidence(findings, evidenceCorpus)
											if (
												check.droppedDisqualifiers > 0 ||
												check.unverifiedChecks > 0
											) {
												yield* Effect.logWarning(
													'research.fit.unsupported',
												).pipe(
													Effect.annotateLogs({
														research_id: researchId,
														dropped_disqualifiers: check.droppedDisqualifiers,
														unverified_checks: check.unverifiedChecks,
													}),
												)
											}
											return { findings: check.findings }
										}),
								},
								{
									// Vocabulary: rewrite industry/size to the CRM's fixed codes so
									// what reaches the CRM matches the classification the UI offers — a
									// real-but-uncategorized value becomes 'other', junk is dropped.
									// Runs before applicability, so a proposal emptied by dropping its
									// only field is then dropped as unappliable.
									name: 'vocabulary',
									run: findings =>
										Effect.gen(function* () {
											const check = constrainVocabulary(findings)
											if (check.mapped > 0 || check.blanked > 0) {
												yield* Effect.logInfo(
													'research.vocabulary.normalized',
												).pipe(
													Effect.annotateLogs({
														research_id: researchId,
														mapped: check.mapped,
														blanked: check.blanked,
													}),
												)
											}
											return { findings: check.findings }
										}),
								},
								{
									// Applicability: drop any proposed CRM update that could never be
									// applied — an update whose subject_id names no live row (the model
									// can invent one for a company that does not exist), or a proposal
									// whose fields carry no real values. Existence is checked against
									// the org's own rows; a malformed id trips a cast error read as
									// "not found".
									name: 'applicability',
									run: findings =>
										Effect.gen(function* () {
											const proposalList =
												findings != null &&
												typeof findings === 'object' &&
												!Array.isArray(findings)
													? (findings as Record<string, unknown>)[
															'proposed_updates'
														]
													: undefined
											const liveSubjects = new Set<string>()
											if (Array.isArray(proposalList)) {
												for (const proposal of proposalList) {
													if (proposal == null || typeof proposal !== 'object')
														continue
													const pu = proposal as Record<string, unknown>
													if (pu['operation'] === 'create') continue
													const table = pu['subject_table']
													const id = pu['subject_id']
													if (
														(table !== 'companies' && table !== 'contacts') ||
														typeof id !== 'string' ||
														id.trim() === '' ||
														liveSubjects.has(`${table}:${id}`)
													)
														continue
													const rows = yield* sql`
														SELECT id FROM ${sql(table)}
														WHERE id = ${id}
															AND organization_id = ${organizationId}
															AND deleted_at IS NULL
														LIMIT 1
													`.pipe(
														Effect.catchTag('SqlError', () =>
															Effect.succeed([]),
														),
													)
													if (rows.length > 0)
														liveSubjects.add(`${table}:${id}`)
												}
											}
											const check = filterApplicableProposals(
												findings,
												(table, id) => liveSubjects.has(`${table}:${id}`),
											)
											if (check.dropped > 0 || check.emptiedFields > 0) {
												yield* Effect.logWarning(
													'research.proposals.unappliable',
												).pipe(
													Effect.annotateLogs({
														research_id: researchId,
														dropped: check.dropped,
														// Fields an earlier check had emptied, taken out
														// here so accepting the change cannot erase what
														// the record already holds.
														emptied_fields: check.emptiedFields,
													}),
												)
											}
											return {
												findings: check.findings,
												spanCounts: {
													'research.proposals.emptied_fields':
														check.emptiedFields,
												},
											}
										}),
								},
								{
									// Discovered-existing: the model fills `subject_id` from prompt or
									// page text, not a CRM lookup, so it is often a company name, a
									// docket, or "0". Resolve each entry to a live row — by id, or by
									// name as the contact de-dup does — and drop the rest, so a phantom
									// "already in CRM" row never reaches the review surface.
									name: 'discovered-existing',
									run: findings =>
										Effect.gen(function* () {
											const discoveredList =
												findings != null &&
												typeof findings === 'object' &&
												!Array.isArray(findings)
													? (findings as Record<string, unknown>)[
															'discovered_existing'
														]
													: undefined
											const resolvedDiscovered = new Set<string>()
											if (Array.isArray(discoveredList)) {
												for (const item of discoveredList) {
													const entry = readDiscoveredEntry(item)
													if (entry === null) continue
													const key = discoveredEntryKey(entry)
													if (resolvedDiscovered.has(key)) continue
													const byId =
														entry.subjectId.trim() === ''
															? []
															: yield* sql`
																	SELECT id FROM ${sql(entry.subjectTable)}
																	WHERE id = ${entry.subjectId}
																		AND organization_id = ${organizationId}
																		AND deleted_at IS NULL
																	LIMIT 1
																`.pipe(
																	Effect.catchTag('SqlError', () =>
																		Effect.succeed([]),
																	),
																)
													let live = byId.length > 0
													if (!live && entry.name.trim() !== '') {
														const byName = yield* sql`
															SELECT id FROM ${sql(entry.subjectTable)}
															WHERE lower(name) = lower(${entry.name})
																AND organization_id = ${organizationId}
																AND deleted_at IS NULL
															LIMIT 1
														`.pipe(
															Effect.catchTag('SqlError', () =>
																Effect.succeed([]),
															),
														)
														live = byName.length > 0
													}
													if (live) resolvedDiscovered.add(key)
												}
											}
											const check = filterDiscoveredExisting(findings, entry =>
												resolvedDiscovered.has(discoveredEntryKey(entry)),
											)
											if (check.dropped > 0) {
												yield* Effect.logWarning(
													'research.discovered_existing.unresolved',
												).pipe(
													Effect.annotateLogs({
														research_id: researchId,
														dropped: check.dropped,
													}),
												)
											}
											return { findings: check.findings }
										}),
								},
								{
									// Prospect criteria: a scan sometimes returns a company outside the
									// size or place the request asked for, because the page it came from
									// was about the right sector. Drop one that states a size or country
									// the request ruled out — only on a stated conflict, so a thin list is
									// never emptied. A scan emptied here still earns the refined retry
									// below, and if it is still all giants, ends honestly instead of green.
									// Only a scan has criteria to judge against; any other run passes through.
									name: 'prospect-criteria',
									run: findings =>
										Effect.gen(function* () {
											if (schemaName !== 'prospect_scan_v1') return { findings }
											const hintCountry = parseCountryAlpha2(hints?.location)
											const prospectCriteria = prospectCriteriaFromHints(
												hints as
													| { min_employees?: number; max_employees?: number }
													| undefined,
												hintCountry ? [hintCountry] : [],
											)
											const check = filterProspectsByCriteria(
												findings,
												prospectCriteria,
											)
											if (check.dropped > 0) {
												yield* Effect.logWarning(
													'research.prospects.off_criteria',
												).pipe(
													Effect.annotateLogs({
														research_id: researchId,
														dropped: check.dropped,
													}),
												)
											}
											return { findings: check.findings }
										}),
								},
							]
							const guarded = yield* runGuardChain(guardChain, result)
							result = guarded.findings
							// Grounding telemetry on the phase-2 span, so the share of fields a
							// run drops for want of a real source is a dashboard, not an anecdote.
							yield* Effect.annotateCurrentSpan(guarded.spanCounts)
							yield* publishEvent(researchId, 'tool.result', {
								tool: 'llm.generateObject',
								phase: 2,
								schema: schemaName,
							})
							// Who the critics judge a value against: the target's own name and
							// domain, from the CRM row when there is one and the request otherwise.
							const targetSnapshot = subjects[0]?.snapshot as
								| Record<string, unknown>
								| undefined
							const criticTarget = {
								name:
									typeof targetSnapshot?.['name'] === 'string'
										? targetSnapshot['name']
										: (run as { query: string }).query,
								domain:
									typeof targetSnapshot?.['website'] === 'string'
										? targetSnapshot['website']
										: entityTargets?.domains[0],
							}
							// How many company fields the per-source checks removed. The caller
							// reports it, so that link hands the count back out through here.
							let entityFieldsDropped = 0
							// The second half of the chain: the links that ask a model, plus the
							// per-source checks that need the pages this run fetched. Same reading
							// rule as the deterministic half — the array order is the run order.
							const criticChain: ReadonlyArray<GuardLink> = [
								{
									// Critic: a final per-field second look. For each value still
									// carrying a source + quote, ask the extract model whether the
									// quote really backs the value and is about the target company —
									// the deterministic guards proved the value is in the evidence,
									// this checks the cited quote supports it. Fail open: a judge
									// error keeps the guarded fields.
									name: 'field-support-critic',
									run: findings =>
										Effect.gen(function* () {
											const check = yield* critiqueFieldSupport(
												findings,
												claims =>
													extractLlm
														.generateObject({
															schema: CriticVerdictsSchema,
															prompt: criticPrompt(criticTarget, claims),
														})
														.pipe(
															Effect.map(response => ({
																verdicts: response.value.verdicts,
															})),
															Effect.catchCause(() =>
																Effect.succeed({
																	verdicts: [],
																}),
															),
														),
											)
											if (check.dropped > 0 || check.flagged > 0) {
												yield* Effect.logWarning(
													'research.critic.dropped',
												).pipe(
													Effect.annotateLogs({
														research_id: researchId,
														criticised: check.criticised,
														dropped: check.dropped,
														flagged: check.flagged,
													}),
												)
											}
											return { findings: check.findings }
										}),
								},
								{
									// Per-source namespace block: a company firmographic cited to a
									// person page or a social post, or a contact whose only tie is a
									// user post, cannot speak for the company — drop it, even when the
									// whole-corpus entity check passed. With the pages fetched this run
									// in hand, each company field's cited page is also judged for the
									// right company — a field sourced to a look-alike's page is dropped,
									// while a citation the run never fetched keeps its field. Runs
									// before the source-tier cap so a blocked field is gone, not merely
									// down-weighted. Only an enrichment run has a single subject to
									// check against; any other run passes through.
									name: 'entity-sources',
									run: findings =>
										Effect.gen(function* () {
											if (!isEnrichmentRun || !entityTargets)
												return { findings }
											const openedByHash = new Map(
												openedPages(scrapeCorpus).map(
													page =>
														[
															page.urlHash,
															{ text: page.text, host: page.host },
														] as const,
												),
											)
											const check = guardEntitySources(
												findings,
												entityTargets,
												sourceId =>
													openedByHash.get(urlHashForScrape(sourceId)),
											)
											entityFieldsDropped =
												check.droppedCompanyFields + check.droppedOffEntity
											if (
												check.droppedCompanyFields > 0 ||
												check.droppedOffEntity > 0 ||
												check.droppedContacts > 0 ||
												check.droppedUncited > 0
											) {
												yield* Effect.logWarning(
													'research.entity_source.blocked',
												).pipe(
													Effect.annotateLogs({
														research_id: researchId,
														dropped_fields: check.droppedCompanyFields,
														dropped_off_entity: check.droppedOffEntity,
														dropped_contacts: check.droppedContacts,
														dropped_uncited: check.droppedUncited,
													}),
												)
											}
											return { findings: check.findings }
										}),
								},
								{
									// Source tier: a value cited to a third-party company-profile site
									// (an aggregator surfaced by the richer search vendors), rather than
									// the company's own domain, has its confidence held to medium — so an
									// outside estimate never ships trusted like the company's own word.
									name: 'source-tier',
									run: findings =>
										Effect.gen(function* () {
											const check = enforceSourceTier(
												findings,
												entityTargets?.domains ?? [],
											)
											if (check.capped > 0) {
												yield* Effect.logInfo(
													'research.source_tier.capped',
												).pipe(
													Effect.annotateLogs({
														research_id: researchId,
														capped: check.capped,
													}),
												)
											}
											return { findings: check.findings }
										}),
								},
							]
							const critics = yield* runGuardChain(criticChain, result)
							result = critics.findings
							// What actually ships, after every rescue and guard — the number a
							// reader of the findings sees. The gap from filled_rescued is what
							// the guards removed; a low value here with a healthy broad fill
							// points at the guards, a low value everywhere at the model.
							if (isEnrichmentRun) {
								const keptFill = enrichmentFill(result)
								const keptContacts = contactFill(result)
								yield* Effect.annotateCurrentSpan({
									'research.enrichment.filled_kept': keptFill.filled,
									'research.enrichment.missing_kept': keptFill.missing.length,
									'research.contacts.named_kept': keptContacts.named,
									'research.contacts.titled_kept': keptContacts.titled,
								})
							}
							return {
								findings: result as unknown,
								entityFieldsDropped,
							}
						}).pipe(
							Effect.withSpan('research.phase2', {
								attributes: {
									'research.run_id': researchId,
									schema: schemaName,
								},
							}),
						)

					// Link each page that returned content to the run so findings cite
					// real sources; the sources row was upserted by the search cache
					// (matched by url_hash). Re-running is a no-op via ON CONFLICT.
					const linkRunSources = (hashes: ReadonlyArray<string>) =>
						Effect.gen(function* () {
							const organizationId = (run as { organizationId: string })
								.organizationId
							for (const urlHash of hashes) {
								yield* sql`
									INSERT INTO research_run_sources (organization_id, research_id, source_id, local_ref, fetched_at, cost_cents)
									SELECT ${organizationId}, ${researchId}, s.id, s.url, now(), 0
									FROM sources s
									WHERE s.url_hash = ${urlHash}
									ON CONFLICT DO NOTHING
								`
							}
						})

					if (checkpointPhase >= 1 && cachedResearchText) {
						researchText = cachedResearchText
						yield* Effect.logInfo('research.phase1.resume').pipe(
							Effect.annotateLogs({
								research_id: researchId,
								text_length: researchText.length,
							}),
						)
						// Reusing the earlier attempt's gathering skips the per-round
						// counting below, so tick once here rather than leave the count
						// sitting where that attempt left it.
						yield* recordProgress
					} else {
						const organizationId = (run as { organizationId: string })
							.organizationId
						const query = (run as { query: string }).query

						// The policy was validated and frozen onto the row at create
						// time, so it round-trips back here as a ResolvedPolicy.
						const policy = (run as { paidPolicy: ResolvedPolicy }).paidPolicy
						// Per-run budget, built from that frozen policy plus the system
						// ceiling. The tool handlers charge it before each vendor call,
						// and the loop reads it to halt when spend runs out. The fiber's
						// own connection backs the cap check.
						const budgetLayer = makeBudgetLayer({
							organizationId,
							userId,
							researchId,
							policy,
							defaultCapCents: defaultMonthlyCapCents,
							systemCeiling: monthlyCapHardCeilingCents,
							// A run's own paid tool calls can't spend past the user's
							// auto-approve limit without an approval gate — the agent turns
							// a refusal into a pending paid action instead of charging.
							enforceAutoApprove: true,
						}).pipe(Layer.provide(Layer.succeed(SqlClient.SqlClient)(sql)))

						// One tool-log pair, one live-stream pair and one progress tick per
						// round, so a multi-round run is visible in the run's toolLog, in
						// its live stream, and on its row.
						const emitRound = (
							round: number,
							textLength: number,
							toolCalls: number,
						) =>
							Effect.gen(function* () {
								yield* publishEvent(researchId, 'tool.called', {
									tool: 'llm.generateText',
									phase: 1,
									round,
								})
								yield* Ref.update(toolLog, log => [
									...log,
									{
										timestamp: DateTime.nowUnsafe().toString(),
										type: 'call' as const,
										tool: 'llm.generateText',
										// The query is on the run's own row; repeating it every round
										// adds thousands of characters the reader already has.
										input: { phase: 1, round },
									},
									{
										timestamp: DateTime.nowUnsafe().toString(),
										type: 'result' as const,
										tool: 'llm.generateText',
										output: { round, toolCalls, textLength },
									},
								])
								yield* publishEvent(researchId, 'tool.result', {
									tool: 'llm.generateText',
									phase: 1,
									round,
									toolCalls,
									textLength,
								})
								// Counted here rather than from the round number: a discovery
								// scan can start a second pass whose rounds number from one
								// again, and what a watcher sees must never go backwards.
								yield* recordProgress
							})

						// The reflect-and-retry loop runs under the per-run Budget +
						// ResearchRunContext, resolving the toolkit so paid tools charge
						// this run. `runRound` threads the growing prompt — each round's
						// assistant text and tool results feed the next — and maps the
						// model response into the plain data the loop decides on.
						const phaseOutcome = yield* Effect.gen(function* () {
							const budget = yield* Budget
							const toolkit = yield* researchToolkit
							const scrape = yield* ScrapeProvider
							const siteMap = yield* MapProvider
							const registry = yield* RegistryRouter
							const anchorSearch = yield* SearchProvider

							// Bound to a const so the null check holds inside the closure
							// below; `entityTargets` is a reassignable `let`.
							const anchorTargets = entityTargets

							// A company's own site is where its people, its address and its
							// size are actually written, and a small company with no website
							// on file has no domain anywhere — without one, every own-site
							// page below goes unread. One search by name finds it, and the
							// first result that is the company's own site rather than a
							// directory listing it counts from here on as a given domain does.
							// Only for a run whose whole job is this one company — a scan
							// anchored to a subject uses it as a starting point for finding
							// other firms, so its own site is not what that run is after.
							const searchedOwnHost =
								anchorHost === undefined &&
								anchorTargets !== null &&
								isEntityGroundedSchema(schemaName)
									? yield* Effect.gen(function* () {
											yield* budget.chargeCheap('search', SEARCH_COST_CENTS)
											// Plenty of small firms share a name, so the town the
											// caller asked about is what tells the one being
											// researched from its namesakes. It has to be the town
											// as the caller wrote it: the run's place words are
											// every long word of the query's tail, which for a
											// query like "Acme, find their CEO" is "find".
											const found = yield* anchorSearch.search({
												query:
													hintLocation === undefined
														? entityName
														: `${entityName} ${hintLocation}`,
												limit: 5,
												...(hints?.location
													? { location: hints.location }
													: {}),
											})
											for (const item of found.items) {
												const host = domainHost(item.url)
												if (
													host !== undefined &&
													isOwnSiteHost(anchorTargets, host)
												)
													return host
											}
											return undefined
										}).pipe(
											// Never let this stop the run: with no host found, the
											// loop does its own searching instead.
											Effect.catchCause(cause =>
												Cause.hasInterruptsOnly(cause)
													? Effect.failCause(cause)
													: Effect.logInfo(
															'research.anchor.search_failed',
														).pipe(
															Effect.annotateLogs({
																research_id: researchId,
																cause: Cause.pretty(cause),
															}),
															Effect.as(undefined),
														),
											),
										)
									: undefined

							// The company's own site for the rest of phase 1, whether the
							// caller gave it or the search found it.
							const ownHost = anchorHost ?? searchedOwnHost

							if (searchedOwnHost !== undefined) {
								// Treat it exactly as a domain the caller supplied. Without
								// this the site's own pages are still fetched but then read as
								// somebody else's: a contact page showing only an address and a
								// phone never spells the company name, so it is judged as being
								// about nobody and dropped — the very page the search went
								// looking for. It is also what holds a third-party estimate to
								// a lower confidence than the company's own word.
								if (entityTargets !== null) {
									entityTargets = withRedirectDomain(
										entityTargets,
										searchedOwnHost,
									)
								}
								yield* Effect.logInfo('research.anchor.host_found').pipe(
									Effect.annotateLogs({
										research_id: researchId,
										host: searchedOwnHost,
									}),
								)
							}

							// Anchor: fetch the company's official site once now so grounding
							// has its page even if the model never navigates there.
							// Best-effort — a refused, unreachable, or empty site just falls
							// back to the model's own searching, and a people directory
							// (LinkedIn) is left to discover_contacts rather than fetched here.
							if (
								ownHost !== undefined &&
								!isUnsupportedScrapeUrl(`https://${ownHost}`)
							) {
								yield* Effect.gen(function* () {
									yield* budget.chargeCheap('scrape', SCRAPE_COST_CENTS)
									const page = yield* scrape.scrape({
										url: `https://${ownHost}`,
										formats: ['markdown', 'links'],
									})
									if (
										page.markdown !== undefined &&
										page.markdown.trim().length > 0
									) {
										const hash = urlHashForScrape(page.url)
										// The company's own domain may 301 to a different host (a
										// rebrand); the fetch followed it, so the destination is the
										// same company's official site. Fold that host in as a
										// strong-match key and put the reached URL in the corpus, so
										// grounding lands on the live site instead of failing closed
										// when the rebranded page never names the old domain.
										const resolvedUrl = page.resolvedUrl ?? page.url
										const destHost = domainHost(resolvedUrl)
										const followedRedirect =
											destHost !== undefined && destHost !== ownHost
										scrapeCorpus.push({
											urlHash: hash,
											text: followedRedirect
												? `${resolvedUrl}\n${page.markdown}`
												: page.markdown,
											host: destHost,
											kind: 'page',
										})
										if (followedRedirect && entityTargets !== null) {
											entityTargets = withRedirectDomain(
												entityTargets,
												destHost,
											)
										}
										seededAnchorHashes.push(hash)
										seededTranscriptParts.push(
											`[scrape_page] ${boundedToolResult({ url: page.url, markdown: page.markdown })}`,
										)
										yield* Effect.logInfo(
											followedRedirect
												? 'research.anchor.redirect_followed'
												: 'research.anchor.seeded',
										).pipe(
											Effect.annotateLogs({
												research_id: researchId,
												host: ownHost,
												...(followedRedirect
													? { resolved_host: destHost }
													: {}),
											}),
										)
									}
									// About / contact / team pages carry the location and the named leaders a homepage
									// rarely spells; fetch a few, chosen from the homepage's own links so no path is
									// guessed, and let own-host grounding keep what they hold. Each fetch is isolated
									// so one failure never sinks the rest, and bounded by MAX_ABOUT_PAGES.
									const reachedHost =
										domainHost(page.resolvedUrl ?? page.url) ?? ownHost
									for (const aboutUrl of aboutPageCandidates(
										page.links ?? [],
										reachedHost,
										MAX_ABOUT_PAGES,
									)) {
										if (isUnsupportedScrapeUrl(aboutUrl)) continue
										yield* Effect.gen(function* () {
											yield* budget.chargeCheap('scrape', SCRAPE_COST_CENTS)
											const about = yield* scrape.scrape({
												url: aboutUrl,
												formats: ['markdown'],
											})
											if (
												about.markdown !== undefined &&
												about.markdown.trim().length > 0
											) {
												const aboutHash = urlHashForScrape(about.url)
												scrapeCorpus.push({
													urlHash: aboutHash,
													text: about.markdown,
													host: domainHost(about.resolvedUrl ?? about.url),
													kind: 'page',
												})
												seededAnchorHashes.push(aboutHash)
												seededTranscriptParts.push(
													`[scrape_page] ${boundedToolResult({ url: about.url, markdown: about.markdown })}`,
												)
												yield* Effect.logInfo(
													'research.anchor.about_seeded',
												).pipe(
													Effect.annotateLogs({
														research_id: researchId,
														url: aboutUrl,
													}),
												)
											}
										}).pipe(
											Effect.catchCause(cause =>
												Cause.hasInterruptsOnly(cause)
													? Effect.failCause(cause)
													: Effect.logWarning(
															'research.anchor.about_skipped',
														).pipe(
															Effect.annotateLogs({
																research_id: researchId,
																url: aboutUrl,
																cause: Cause.pretty(cause),
															}),
														),
											),
										)
									}
									// Site discovery: the homepage nav only links part of a site,
									// so ask the map provider for the site's own page list (sitemap
									// + crawl) and fetch the best people/about pages it finds that
									// the seeds above did not already cover. Environments without a
									// vendor run with map 'none', so any map failure is a logged
									// skip here, never a failed run.
									yield* Effect.gen(function* () {
										const mapped = yield* siteMap.map({
											url: `https://${reachedHost}`,
											limit: 100,
										})
										// One provider unit, charged after the call returns so a
										// disabled ('none') map never bills the run.
										yield* budget.chargeCheap('scrape', SCRAPE_COST_CENTS)
										// Drop already-seeded pages before ranking, so an overlap with
										// the homepage-linked seeds never wastes a discovery slot.
										const seeded = new Set(seededAnchorHashes)
										const discovered = aboutPageCandidates(
											mapped.links.filter(
												url => !seeded.has(urlHashForScrape(url)),
											),
											reachedHost,
											MAX_DISCOVERY_PAGES,
										)
										if (discovered.length > 0) {
											yield* Effect.logInfo('research.discovery.mapped').pipe(
												Effect.annotateLogs({
													research_id: researchId,
													mapped: mapped.links.length,
													fetching: discovered.length,
												}),
											)
										}
										for (const url of discovered) {
											if (isUnsupportedScrapeUrl(url)) continue
											yield* Effect.gen(function* () {
												yield* budget.chargeCheap('scrape', SCRAPE_COST_CENTS)
												const found = yield* scrape.scrape({
													url,
													formats: ['markdown'],
												})
												if (
													found.markdown !== undefined &&
													found.markdown.trim().length > 0
												) {
													const foundHash = urlHashForScrape(found.url)
													scrapeCorpus.push({
														urlHash: foundHash,
														text: found.markdown,
														host: domainHost(found.resolvedUrl ?? found.url),
														kind: 'page',
													})
													seededAnchorHashes.push(foundHash)
													seededTranscriptParts.push(
														`[scrape_page] ${boundedToolResult({ url: found.url, markdown: found.markdown })}`,
													)
													yield* Effect.logInfo(
														'research.discovery.page_seeded',
													).pipe(
														Effect.annotateLogs({
															research_id: researchId,
															url,
														}),
													)
												}
											}).pipe(
												Effect.catchCause(cause =>
													Cause.hasInterruptsOnly(cause)
														? Effect.failCause(cause)
														: Effect.logWarning(
																'research.discovery.page_skipped',
															).pipe(
																Effect.annotateLogs({
																	research_id: researchId,
																	url,
																	cause: Cause.pretty(cause),
																}),
															),
												),
											)
										}
									}).pipe(
										Effect.catchCause(cause =>
											Cause.hasInterruptsOnly(cause)
												? Effect.failCause(cause)
												: Effect.logInfo('research.discovery.skipped').pipe(
														Effect.annotateLogs({
															research_id: researchId,
															host: reachedHost,
															cause: Cause.pretty(cause),
														}),
													),
										),
									)
								}).pipe(
									Effect.catchCause(cause =>
										Cause.hasInterruptsOnly(cause)
											? Effect.failCause(cause)
											: Effect.logWarning('research.anchor.seed_failed').pipe(
													Effect.annotateLogs({
														research_id: researchId,
														host: ownHost,
														cause: Cause.pretty(cause),
													}),
												),
									),
								)
							}

							// Register: for a company pinned to a country with a national
							// register, look it up once now. The register holds the authoritative,
							// niche facts — the legal name, the tax id, the named directors — that
							// a thin company website never states, and folds them into the evidence
							// the extraction reads. Only for a run whose whole job is this one
							// company — enrichment or contact discovery — never a scan that
							// happens to be anchored, whose subject is a starting point for
							// finding other firms, not the thing being looked up.
							const registrySnapshot = subjects[0]?.snapshot as
								| Record<string, unknown>
								| undefined
							const registryCountry =
								entityTargets !== null && isEntityGroundedSchema(schemaName)
									? resolveRegistryCountry({
											subjectCountry:
												typeof registrySnapshot?.['country'] === 'string'
													? registrySnapshot['country']
													: undefined,
											locationHint: hints?.location,
											// An address the run found points at a country's
											// register just as well as one the caller gave.
											anchorHost: ownHost,
										})
									: undefined
							if (registryCountry !== undefined) {
								const registryQuery =
									typeof registrySnapshot?.['name'] === 'string'
										? registrySnapshot['name']
										: (run as { query: string }).query
								yield* Effect.gen(function* () {
									// Paid for under this run's own key for this company and
									// spelling. The agent looking the same company up the same way
									// later costs nothing and does not reach the register again; a
									// lookup by tax id or a different spelling is a different
									// purchase, so the register costs a small, limit-capped handful
									// per run.
									const looked = yield* budget.withPaidCharge(
										'registry',
										REGISTRY_LOOKUP_COST_CENTS,
										'registry_lookup',
										`${researchId}:registry:${registryCountry}:${registryQuery}`,
									)(() =>
										registry.lookup({
											country: registryCountry,
											query: registryQuery,
										}),
									)
									if (looked._tag === 'already_charged') return
									const record = looked.value
									const hash = urlHashForScrape(record.sourceUrl)
									// A record read from a national register sits in `sources`
									// alongside the fetched pages, so a value taken from it grounds
									// the same way a scraped fact does. Nothing of the register page
									// itself is kept, only the record, so it is written down as seen
									// rather than as a page held on file.
									yield* recordSeenSource(sql, {
										url: record.sourceUrl,
										title: record.legalName,
										contentHash: hash,
										provider: `registry-${registryCountry.toLowerCase()}`,
										kind: 'registry',
									})
									seededRegistryHashes.push(hash)
									seededTranscriptParts.push(
										`[registry_lookup] ${boundedToolResult({ url: record.sourceUrl, ...record })}`,
									)
									seededEvidenceParts.push(
										`${record.sourceUrl}\n${JSON.stringify(record)}`,
									)
									// A register match on the legal name confirms the run reached the
									// right company, the same as reaching its own site.
									if (
										!registryConfirmed &&
										isConfirmedRegistryMatch(entityTargets, record)
									) {
										registryConfirmed = true
									}
									yield* Effect.logInfo('research.registry.seeded').pipe(
										Effect.annotateLogs({
											research_id: researchId,
											country: registryCountry,
										}),
									)
								}).pipe(
									// The register may be unreachable, out of credit, or simply not
									// list this company. None of that is a reason to abandon the
									// research — the run carries on with what the web tells it.
									Effect.catchCause(cause =>
										Cause.hasInterruptsOnly(cause)
											? Effect.failCause(cause)
											: Effect.logWarning(
													'research.registry.seed_skipped',
												).pipe(
													Effect.annotateLogs({
														research_id: researchId,
														country: registryCountry,
														cause: Cause.pretty(cause),
													}),
												),
									),
								)
							}

							// One agent pass = a fresh reflect-and-retry loop. Both the initial
							// pass and a refined retry run here, under the SAME budget + toolkit:
							// re-providing the layer would build a fresh MemoMap and reset the
							// per-run spend, letting one run silently pay twice.
							const runPass = (basePrompt: string) =>
								Effect.gen(function* () {
									let prompt: Prompt.Prompt = Prompt.make(basePrompt)
									const runRound = (round: number) =>
										Effect.gen(function* () {
											const response = yield* agentLlm.generateText({
												prompt,
												toolkit,
												// Force a tool on the first round so the model can't
												// answer from memory without gathering evidence (which
												// would leave zero sources and fail the grounding gate
												// on a legitimate company); reflect freely after.
												toolChoice: round === 1 ? 'required' : 'auto',
											})
											prompt = Prompt.concat(
												prompt,
												Prompt.fromResponseParts(response.content),
											)
											// Attribute sources only to scrapes that actually returned
											// content this round — read off the tool RESULTS, not the
											// requested calls — so a failed or empty scrape can never
											// count toward grounding; keep the content for the value guard.
											const scrapeUrlHashes: string[] = []
											for (const tr of response.toolResults) {
												if (tr.name === 'scrape_page') {
													const page = tr.result as
														| { url?: unknown; markdown?: unknown }
														| null
														| undefined
													if (
														page != null &&
														typeof page.url === 'string' &&
														typeof page.markdown === 'string' &&
														page.markdown.trim().length > 0
													) {
														scrapeUrlHashes.push(urlHashForScrape(page.url))
														scrapeCorpus.push({
															urlHash: urlHashForScrape(page.url),
															text: page.markdown,
															host: domainHost(page.url),
															kind: 'page',
														})
													}
												} else if (tr.name === 'web_search') {
													// A search result that arrived with real page text counts
													// as a page the run has read — ground on it exactly like a
													// scrape. The sources row was recorded by the search cache
													// when the tool ran.
													const searchResult = tr.result as
														| { items?: ReadonlyArray<unknown> }
														| null
														| undefined
													for (const raw of searchResult?.items ?? []) {
														const item = raw as {
															url?: unknown
															content?: unknown
														}
														if (typeof item.url !== 'string') continue
														// Every result the run surfaced counts as seen, so a
														// value the model cites to its URL grounds even when
														// only the snippet — not the full page — was read.
														const resultHost = domainHost(item.url)
														if (resultHost !== undefined)
															searchResultHosts.add(resultHost)
														if (
															typeof item.content === 'string' &&
															item.content.trim().length > 0
														) {
															scrapeUrlHashes.push(urlHashForScrape(item.url))
															scrapeCorpus.push({
																urlHash: urlHashForScrape(item.url),
																text: item.content,
																host: domainHost(item.url),
																kind: 'passage',
															})
														}
													}
												}
											}
											const renderedResults = response.toolResults.map(
												tr =>
													`[${tr.name}] ${boundedToolResult(tr.encodedResult ?? tr.result)}`,
											)
											// Record each fetch the model gave up on (a dead URL, a
											// provider 4xx) so the skipped page shows in the run's tool
											// log; the run keeps going and only fails if nothing grounds it.
											for (const tr of response.toolResults) {
												if (!tr.isFailure) continue
												yield* Ref.update(toolLog, log => [
													...log,
													{
														timestamp: DateTime.nowUnsafe().toString(),
														type: 'result' as const,
														tool: tr.name,
														error: boundedToolResult(
															tr.encodedResult ?? tr.result,
														),
													},
												])
											}
											// A registry_lookup that resolved the target by its legal name
											// strongly confirms the run reached the right company, even if
											// its own site was never scraped. OR-accumulate across rounds.
											if (!registryConfirmed) {
												for (const tr of response.toolResults) {
													if (
														!tr.isFailure &&
														tr.name === 'registry_lookup' &&
														isConfirmedRegistryMatch(entityTargets, tr.result)
													) {
														registryConfirmed = true
														break
													}
												}
											}
											yield* emitRound(
												round,
												response.text.length,
												response.toolCalls.length,
											)
											return {
												text: response.text,
												hasToolCalls: response.toolCalls.length > 0,
												scrapeUrlHashes,
												renderedResults,
												promptChars: JSON.stringify(response.content).length,
												inputTokens: response.usage.inputTokens.total ?? 0,
											}
										})
									// When the model stops early without the evidence confirming the
									// target, nudge it to find and read the company's own site before
									// finishing; bounded so a run that still cannot ground fails closed.
									let groundingRetries = 0
									let headcountRetries = 0
									const shouldContinueAfterFinal = () =>
										Effect.sync(() => {
											const corpus = scrapeCorpus
												.map(page => page.text)
												.join('\n')
											const verdict =
												entityTargets === null
													? null
													: classifyEntityMatch(entityTargets, corpus)
											// Grounding gate: reach the target's own site before answering; bounded
											// so a run that still cannot ground fails closed rather than looping.
											if (
												entityTargets !== null &&
												verdict !== 'strong' &&
												groundingRetries < MAX_GROUNDING_RETRIES
											) {
												groundingRetries++
												prompt = Prompt.concat(
													prompt,
													Prompt.make(GROUNDING_RETRY_INSTRUCTION),
												)
												return true
											}
											// Fact-completeness gate: an enrichment run that reached the company but
											// has gathered no employee-count signal is pushed to search for the
											// headcount once — it is rarely on the homepage, so a run that stops there
											// leaves size_range empty. Bounded like the grounding gate above.
											if (
												schemaName === 'company_enrichment_v1' &&
												verdict === 'strong' &&
												headcountRetries < MAX_HEADCOUNT_RETRIES &&
												!hasHeadcountSignal(corpus)
											) {
												headcountRetries++
												prompt = Prompt.concat(
													prompt,
													Prompt.make(HEADCOUNT_SEARCH_INSTRUCTION),
												)
												return true
											}
											return false
										})
									return yield* runAgentResearchLoop({
										maxSteps: maxAgentSteps,
										maxPromptChars: MAX_LOOP_PROMPT_CHARS,
										maxPromptTokens: maxLoopPromptTokens,
										runRound,
										shouldContinueAfterFinal,
										budgetSnapshot: budget.snapshot(),
									})
								})

							let loop = yield* runPass(
								`${systemPrompt}\n\n${query}${anchorInstruction}`,
							)

							// A non-anchored discovery scan (prospect / competitor) that comes
							// back empty gets ONE refined retry before we accept "found
							// nothing": only here does an empty primary list mean the search —
							// not the data — fell short, and only here is the entity gate a
							// no-op. Extraction runs now so the emptiness check sees real
							// structured findings; the retry reuses this pass's budget.
							let findings: unknown
							let refined = false
							if (isRetryEligible(schemaName) && entityTargets === null) {
								yield* linkRunSources(loop.scrapedUrlHashes)
								let extracted = yield* extractStructuredFindings(
									loop.researchText,
									[
										loop.evidenceText,
										...scrapeCorpus.map(page => page.text),
									].join('\n'),
									scrapeCorpus.map(page => page.text),
								)
								findings = extracted.findings
								if (
									isDiscoveryScanEmpty(schemaName, findings) &&
									canAffordAnotherRound(yield* budget.snapshot())
								) {
									refined = true
									yield* Effect.logInfo('research.refining').pipe(
										Effect.annotateLogs({
											research_id: researchId,
											schema: schemaName,
										}),
									)
									yield* publishEvent(researchId, 'run.refining', {
										schema: schemaName,
									})
									const retryLoop = yield* runPass(
										`${systemPrompt}\n\n${query}\n\n${REFINE_HINT}`,
									)
									loop = {
										researchText: [loop.researchText, retryLoop.researchText]
											.filter(t => t.length > 0)
											.join('\n\n'),
										evidenceText: [loop.evidenceText, retryLoop.evidenceText]
											.filter(t => t.length > 0)
											.join('\n\n'),
										scrapedUrlHashes: [
											...new Set([
												...loop.scrapedUrlHashes,
												...retryLoop.scrapedUrlHashes,
											]),
										],
										rounds: loop.rounds + retryLoop.rounds,
										stopReason: retryLoop.stopReason,
									}
									yield* linkRunSources(retryLoop.scrapedUrlHashes)
									extracted = yield* extractStructuredFindings(
										loop.researchText,
										[
											loop.evidenceText,
											...scrapeCorpus.map(page => page.text),
										].join('\n'),
										scrapeCorpus.map(page => page.text),
									)
									findings = extracted.findings
								}
							}

							// Read the cheap-tier tally before the budget layer goes out of
							// scope, so the terminal transitions below can stamp it.
							const cheapCents = (yield* budget.snapshot()).cheapSpent
							return {
								loop,
								findings,
								refined,
								cheapCents,
							}
						}).pipe(
							Effect.provide(researchToolkitLayer),
							Effect.provide(budgetLayer),
							Effect.provide(
								Layer.succeed(ResearchRunContext)({
									researchId,
									language: hints?.language,
									location: hints?.location,
									entityTargets,
									entityName,
								}),
							),
							Effect.withSpan('research.phase1', {
								attributes: { 'research.run_id': researchId },
							}),
						)

						const loopResult = phaseOutcome.loop
						runRounds = loopResult.rounds
						// Why the searching stopped. A run that ran out of room to think,
						// rather than finishing what it set out to do, had more it wanted
						// to read — so a thin profile there is a ceiling to raise, not a
						// prompt to reword.
						yield* Effect.annotateCurrentSpan({
							'research.phase1.stop_reason': loopResult.stopReason,
							'research.phase1.rounds': loopResult.rounds,
						})
						// Prepend the anchor site's content so phase-2 extraction reads the
						// official page first; empty when nothing was seeded.
						researchText = [...seededTranscriptParts, loopResult.researchText]
							.filter(part => part.length > 0)
							.join('\n\n')
						evidenceText = loopResult.evidenceText
						retryFindings = phaseOutcome.findings
						cheapSpentCents = phaseOutcome.cheapCents

						// Entity grounding gate: from the fetched evidence alone (never the
						// model's prose), classify how strongly the pages concern the
						// requested company. Nothing about the target at all ('absent')
						// fails closed here, before phase 2 can turn a lookalike's pages
						// into a confident profile. A glancing mention ('weak') carries on
						// and finishes marked for reading.
						const entityCorpus = [
							evidenceText,
							...scrapeCorpus.map(page => page.text),
						].join('\n')
						entityMatch = entityTargets
							? classifyEntityMatch(entityTargets, entityCorpus)
							: null
						// A page that merely spells the company name reads as 'strong' even
						// for a different same-named company, or a stale mention of one since
						// renamed or acquired. When a city was queried but the run reached no
						// official site and no register confirmed the match, require that city
						// in the evidence too — otherwise fail closed rather than profile a
						// lookalike.
						if (
							entityMatch === 'strong' &&
							entityTargets &&
							cityGate({
								targets: entityTargets,
								corpus: entityCorpus,
								// Pages only: this asks whether the run reached the company's
								// own site, and a search quoting a sentence off a namesake's
								// site is not having been there.
								pages: openedPages(scrapeCorpus),
								registryConfirmed,
							}) === 'downgrade'
						) {
							yield* Effect.annotateCurrentSpan({
								'research.entity.city_downgraded': true,
							})
							yield* Effect.logInfo('research.entity.city_downgraded').pipe(
								Effect.annotateLogs({ research_id: researchId }),
							)
							entityMatch = 'absent'
						}
						if (entityMatch === 'absent') {
							yield* failClosedOnEntity(entityMatch)
							return
						}

						// Commit the phase-1 checkpoint and its source links together, so a
						// crash between them can't leave a resumed run citing sources it
						// never recorded. The status guard mirrors the terminal writes: a
						// run cancelled mid-loop keeps its 'cancelled' row rather than
						// having this checkpoint overwrite it with partial progress.
						yield* Effect.gen(function* () {
							yield* sql`
								UPDATE research_runs
								SET phase = 1,
									research_text = ${researchText},
									entity_match = ${entityMatch},
									updated_at = now()
								WHERE id = ${researchId} AND status = 'running'
							`

							// Link every page scraped across the loop's rounds — plus the
							// anchor site and any register entry seeded before the loop — to
							// the run so findings cite real sources (a discovery-scan retry
							// may have linked some already — ON CONFLICT makes the re-link a
							// no-op).
							yield* linkRunSources([
								...loopResult.scrapedUrlHashes,
								...seededAnchorHashes,
								...seededRegistryHashes,
							])
						}).pipe(sql.withTransaction)
					}

					// The phase-1 entity gate is skipped when a run resumes from a checkpoint
					// (the loop that decides the verdict does not re-run), so re-check the stored
					// verdict here: evidence about no company at all fails closed before phase 2
					// instead of extracting a lookalike's profile on resume.
					if (entityMatch === 'absent') {
						yield* failClosedOnEntity(entityMatch)
						return
					}

					// ── Phase 2: Structured output ──
					// Skipped on resume if findings were already captured.
					let findings: unknown
					if (checkpointPhase >= 2 && existingFindingsHasValue) {
						findings = existingFindings
						yield* Effect.logInfo('research.phase2.resume').pipe(
							Effect.annotateLogs({ research_id: researchId }),
						)
						// Same as the gathering checkpoint above: reusing the earlier
						// attempt's findings skips the work that would otherwise report,
						// so tick once to show the run is moving.
						yield* recordProgress
					} else {
						if (retryFindings !== undefined) {
							// The discovery-scan retry path already ran extraction under the
							// shared budget — reuse those findings.
							findings = retryFindings
						} else {
							// Fill the phase-2 page budget with the company's own
							// (anchor-seeded) pages first, so if the budget truncates it drops
							// third-party pages, never the official site the run grounds on.
							const anchorHashes = new Set(seededAnchorHashes)
							const anchorFirstCorpus = [...scrapeCorpus].sort(
								(a, b) =>
									(anchorHashes.has(a.urlHash) ? 0 : 1) -
									(anchorHashes.has(b.urlHash) ? 0 : 1),
							)
							const extracted = yield* extractStructuredFindings(
								researchText,
								[
									evidenceText,
									...seededEvidenceParts,
									...groundedPageTexts(entityTargets, scrapeCorpus),
								].join('\n'),
								labelledGroundedPages(entityTargets, anchorFirstCorpus),
							)
							findings = extracted.findings
							// A company field dropped for coming from a person page or a social
							// post means the strong whole-corpus match was partly built on a
							// source that can't speak for the company. Downgrade the verdict so
							// the run reports honestly (and the quality signal sees it).
							if (
								extracted.entityFieldsDropped > 0 &&
								entityMatch === 'strong'
							) {
								entityMatch = 'weak'
								yield* Effect.logWarning(
									'research.entity.downgraded_source',
								).pipe(Effect.annotateLogs({ research_id: researchId }))
							}
							// Gap rounds: for each high-value firmographic the broad pass and
							// the focused rescues still left empty, first fetch the cited
							// pages the run never opened (turning the per-source check's
							// fail-open into a real verdict on the cited page), then fire one
							// focused web search per missing field, and re-extract over the
							// enlarged evidence. Loops while the gaps keep closing —
							// hard-capped, and every round first checks the wall-clock and
							// budget margin, because finishing low-confidence is a result
							// while riding into the terminal run deadline loses the run.
							// Phase-2 runs outside the loop's Budget scope, so each round
							// tallies its scrape/search cost into gapSpentCents to keep the
							// margin check and the stamped cost honest.
							const gapSearch = yield* SearchProvider
							const gapScrape = yield* ScrapeProvider
							const perFieldTargetName =
								(run as { query: string }).query.split(',')[0]?.trim() ||
								(run as { query: string }).query
							// Cited pages already attempted this run (fetched, empty, or errored),
							// so one that yields nothing is not re-fetched every round — otherwise
							// it never enters the corpus and keeps reappearing as cited-but-unscraped.
							const citedAttempted = new Set<string>()
							for (let gapRound = 1; gapRound <= MAX_GAP_ROUNDS; gapRound++) {
								const perFieldMissing = needsPerFieldSearch(findings).slice(
									0,
									MAX_PER_FIELD_SEARCHES,
								)
								const openedHashes = new Set(
									openedPages(scrapeCorpus).map(page => page.urlHash),
								)
								const citedUnscraped = citedUnscrapedSources(
									findings,
									hash => openedHashes.has(hash) || citedAttempted.has(hash),
									MAX_CITED_SCRAPES_PER_ROUND,
								)
								// Grounded and fully fetched — nothing left to close.
								if (perFieldMissing.length === 0 && citedUnscraped.length === 0)
									break
								const elapsedMs =
									DateTime.toEpochMillis(DateTime.nowUnsafe()) - runStartedAtMs
								const thinDeadline =
									elapsedMs >
									runDeadlineSeconds * 1000 * GAP_ROUND_DEADLINE_FRACTION
								// Phase 2 has no live budget scope; the margin reads the run's
								// policy budget less everything spent so far — phase 1 plus the
								// gap rounds already run — so it actually tightens each round.
								const gapPolicy = (run as { paidPolicy: ResolvedPolicy | null })
									.paidPolicy
								const thinBudget =
									(gapPolicy?.budgetCents ?? 0) -
										cheapSpentCents -
										gapSpentCents <
									SCRAPE_COST_CENTS * 2
								if (thinDeadline || thinBudget) {
									yield* Effect.logInfo('research.gap_rounds.stopped').pipe(
										Effect.annotateLogs({
											research_id: researchId,
											round: gapRound,
											reason: thinDeadline
												? 'deadline_margin'
												: 'budget_margin',
										}),
									)
									break
								}
								// Counted here, past both stop checks: the body below can leave
								// by several different exits, so a round counted at the end
								// would go unreported whenever it takes one of them.
								yield* recordProgress
								const roundHashes: string[] = []
								// Fetch the cited pages first: cheap certainty about sources
								// the run already leans on.
								yield* Effect.forEach(
									citedUnscraped,
									citedUrl =>
										Effect.gen(function* () {
											// Mark the attempt (fetched, empty, or errored) so a page that
											// yields nothing is not re-fetched next round.
											citedAttempted.add(urlHashForScrape(citedUrl))
											if (isUnsupportedScrapeUrl(citedUrl)) return
											const cited = yield* gapScrape.scrape({
												url: citedUrl,
												formats: ['markdown'],
											})
											// Charged once the fetch is back, so a URL that errors out
											// leaves the round's remaining budget intact.
											gapSpentCents += SCRAPE_COST_CENTS
											if (
												cited.markdown !== undefined &&
												cited.markdown.trim().length > 0
											) {
												const citedHash = urlHashForScrape(cited.url)
												roundHashes.push(citedHash)
												scrapeCorpus.push({
													urlHash: citedHash,
													text: cited.markdown,
													host: domainHost(cited.resolvedUrl ?? cited.url),
													kind: 'page',
												})
											}
										}).pipe(
											// Let a pure interruption (cancel/deploy) unwind the run instead of
											// being logged as a skip while the loop keeps spending.
											Effect.catchCause(cause =>
												Cause.hasInterruptsOnly(cause)
													? Effect.failCause(cause)
													: Effect.logInfo(
															'research.gap_rounds.cited_scrape_skipped',
														).pipe(
															Effect.annotateLogs({
																research_id: researchId,
																url: citedUrl,
																cause: Cause.pretty(cause),
															}),
														),
											),
										),
									{ concurrency: GAP_ROUND_CONCURRENCY },
								)
								// Cited pages fetched: re-judge the kept fields against them
								// right away — the point of fetching is that a wrong-company
								// page can now void the field it sourced, no LLM call needed.
								if (roundHashes.length > 0 && entityTargets) {
									const gapOpenedByHash = new Map(
										openedPages(scrapeCorpus).map(
											page =>
												[
													page.urlHash,
													{ text: page.text, host: page.host },
												] as const,
										),
									)
									const recheck = guardEntitySources(
										findings,
										entityTargets,
										sourceId => gapOpenedByHash.get(urlHashForScrape(sourceId)),
									)
									findings = recheck.findings
									if (recheck.droppedOffEntity > 0) {
										if (entityMatch === 'strong') entityMatch = 'weak'
										yield* Effect.logWarning(
											'research.gap_rounds.cited_voided',
										).pipe(
											Effect.annotateLogs({
												research_id: researchId,
												dropped: recheck.droppedOffEntity,
											}),
										)
									}
								}
								// Nothing missing: the cited fetches were the whole round —
								// link them and let the next round's top check close the loop.
								if (perFieldMissing.length === 0) {
									if (roundHashes.length > 0) yield* linkRunSources(roundHashes)
									continue
								}
								const perFieldFired = perFieldMissing.length
								yield* Effect.forEach(
									perFieldMissing,
									field =>
										Effect.gen(function* () {
											gapSpentCents += SEARCH_COST_CENTS
											const searched = yield* gapSearch
												.search({
													query: perFieldSearchQuery(
														perFieldTargetName,
														hintLocation,
														field,
													),
													limit: 3,
													location: hintLocation,
												})
												.pipe(
													// Let a pure interruption (cancel/deploy) unwind the run instead of
													// being swallowed as an empty result while the loop keeps spending.
													Effect.catchCause(cause =>
														Cause.hasInterruptsOnly(cause)
															? Effect.failCause(cause)
															: Effect.succeed(null),
													),
												)
											for (const item of searched?.items ?? []) {
												const host = domainHost(item.url)
												if (host !== undefined) searchResultHosts.add(host)
												if (item.content && item.content.trim().length > 0) {
													const hash = urlHashForScrape(item.url)
													roundHashes.push(hash)
													scrapeCorpus.push({
														urlHash: hash,
														text: item.content,
														host,
														kind: 'passage',
													})
												}
											}
										}),
									{ concurrency: GAP_ROUND_CONCURRENCY },
								)
								// Nothing new reached the evidence — more rounds would only
								// repeat the same searches, so the remaining gaps are treated
								// as absent and the quality signal reports the thinness.
								if (roundHashes.length === 0) break
								yield* linkRunSources(roundHashes)
								const perFieldAnchorFirst = [...scrapeCorpus].sort(
									(a, b) =>
										(anchorHashes.has(a.urlHash) ? 0 : 1) -
										(anchorHashes.has(b.urlHash) ? 0 : 1),
								)
								const refreshed = yield* extractStructuredFindings(
									researchText,
									[
										evidenceText,
										...seededEvidenceParts,
										...groundedPageTexts(entityTargets, scrapeCorpus),
									].join('\n'),
									labelledGroundedPages(entityTargets, perFieldAnchorFirst),
								)
								const merged = mergePerFieldSearch(findings, refreshed.findings)
								findings = merged.findings
								yield* Effect.annotateCurrentSpan({
									'research.gap_rounds.round': gapRound,
									'research.per_field_search.fired': perFieldFired,
									'research.per_field_search.filled': merged.filled,
									'research.gap_rounds.contacts_kept':
										contactFill(findings).named,
									'research.gap_rounds.titled_kept':
										contactFill(findings).titled,
								})
								yield* Effect.logInfo('research.gap_rounds.closed').pipe(
									Effect.annotateLogs({
										research_id: researchId,
										round: gapRound,
										cited_fetched: citedUnscraped.length,
										fired: perFieldFired,
										filled: merged.filled,
									}),
								)
								// A round that filled nothing and resolved no cited page has
								// stopped closing gaps — stop before burning the remaining
								// rounds on the same result.
								if (merged.filled === 0 && citedUnscraped.length === 0) break
							}
						}
						yield* Ref.update(toolLog, log => [
							...log,
							{
								timestamp: DateTime.nowUnsafe().toString(),
								type: 'result' as const,
								tool: 'llm.generateObject',
								output: { schema: schemaName },
							},
						])
						// Skip this write if the run was cancelled during phase 2, so a
						// stopped run keeps its 'cancelled' state instead of gaining findings.
						yield* sql`
							UPDATE research_runs
							SET phase = 2,
								findings = ${JSON.stringify(findings)},
								updated_at = now()
							WHERE id = ${researchId} AND status = 'running'
						`
					}

					// ── Phase 3: Brief generation ──
					const briefLang = context?.hints?.language ?? 'en'
					// The brief labels itself: a company keeps one running set of notes, and
					// each run's brief is added to the end of it, so the brief has to say which
					// company and date it is about. The writer model puts that heading in the
					// run's own language, which is why the wording is asked for here rather
					// than composed later by the code that appends it.
					const briefDate = DateTime.formatIsoDateUtc(DateTime.nowUnsafe())
					const briefMd = yield* Effect.gen(function* () {
						yield* publishEvent(researchId, 'tool.called', {
							tool: 'llm.generateText',
							phase: 3,
							language: briefLang,
						})

						const briefResponse = yield* writerLlm.generateText({
							prompt: `Write a concise human-readable research brief in ${briefLang}, summarizing ONLY the structured findings below. Begin with a single markdown heading line (starting "## ") naming the company and the date ${briefDate}, worded in ${briefLang}. Do not add any fact, number, name, or contact detail that is not present in the findings. When the findings carry news or dated events, give recent developments (roughly the last 12 months) a short section of their own.\n\n${JSON.stringify(findings)}`,
						})

						// The writer model is an open-weights model that often prefixes the
						// brief with a `<think>` block; strip it so the human-facing brief
						// never shows the model's reasoning.
						const briefText = stripReasoning(briefResponse.text)

						yield* Ref.update(toolLog, log => [
							...log,
							{
								timestamp: DateTime.nowUnsafe().toString(),
								type: 'result' as const,
								tool: 'llm.generateText',
								output: { phase: 3, briefLength: briefText.length },
							},
						])

						return briefText
					}).pipe(
						Effect.withSpan('research.phase3', {
							attributes: {
								'research.run_id': researchId,
								language: briefLang,
							},
						}),
					)

					// ── Persist results ──
					const finalToolLog = yield* Ref.get(toolLog)

					// Grounding gate (fail-closed): a run that fetched no page cannot
					// ground its findings, so it is marked no_reliable_data instead of
					// reporting success with fabricated data. Returns before the cache
					// write and parent merge below, like any run that does not succeed.
					const [sources] = yield* sql<{ n: number }>`
						SELECT COUNT(*)::int AS n FROM research_run_sources
						WHERE research_id = ${researchId}
					`
					if ((sources?.n ?? 0) < MIN_GROUNDED_SOURCES) {
						yield* sql`
							UPDATE research_runs
							SET status = 'no_reliable_data',
								reason_code = ${'no_sources' satisfies ReasonCode},
								phase = 3,
								findings = ${JSON.stringify(
									withRegistryFlag({
										error:
											'No pages were fetched, so the findings could not be grounded.',
										reason: 'no_reliable_data',
									}),
								)},
								tool_log = ${JSON.stringify(finalToolLog)},
								completed_at = now(),
								updated_at = now()
							WHERE id = ${researchId} AND status = 'running'
						`
						yield* publishEvent(researchId, 'run.no_reliable_data', {
							sourceCount: sources?.n ?? 0,
						})
						yield* stampRunUsage
						const parentGroupId = (run as { parentId: string | null }).parentId
						if (parentGroupId) yield* rollupParentLocked(parentGroupId)
						return
					}

					// An open-ended discovery scan that came back empty even after a
					// refined retry has no reliable findings to report — mark it
					// no_reliable_data instead of a green success over an empty list.
					if (
						entityTargets === null &&
						isRetryEligible(schemaName) &&
						isDiscoveryScanEmpty(schemaName, findings)
					) {
						yield* sql`
							UPDATE research_runs
							SET status = 'no_reliable_data',
								reason_code = ${'no_sources' satisfies ReasonCode},
								phase = 3,
								findings = ${JSON.stringify({
									error:
										'The search found no companies matching the criteria, even after a refined retry, so there are no reliable findings to report.',
									reason: 'no_reliable_data',
								})},
								tool_log = ${JSON.stringify(finalToolLog)},
								completed_at = now(),
								updated_at = now()
							WHERE id = ${researchId} AND status = 'running'
						`
						yield* publishEvent(researchId, 'run.no_reliable_data', {
							reason: 'no_results',
						})
						yield* stampRunUsage
						const parentGroupId = (run as { parentId: string | null }).parentId
						if (parentGroupId) yield* rollupParentLocked(parentGroupId)
						return
					}

					// The country this run was about, taken from the model's extracted
					// country and normalized to an ISO alpha-2 code. Stored on the run so
					// applying its findings can stamp the country onto the company; null
					// when the model gave no country or gave something that isn't a code.
					const runCountry =
						parseCountryAlpha2(readEnrichmentCountry(findings)) ?? null

					// Quality signal: derive a compact block plus a low-confidence flag so an
					// automation can gate on `status` without inspecting the run. First-party
					// sources are those on the company's own domain — the ones most trusted
					// to speak for it.
					const sourceUrls = yield* sql<{ url: string }>`
						SELECT DISTINCT s.url
						FROM research_run_sources rs JOIN sources s ON s.id = rs.source_id
						WHERE rs.research_id = ${researchId}
					`
					const targetDomains = entityTargets?.domains ?? []
					const sourcesFirstParty = sourceUrls.filter(row => {
						const host = hostOf(row.url)
						return host !== null && isFirstPartyHost(host, targetDomains)
					}).length
					const fill =
						schemaName === 'company_enrichment_v1'
							? enrichmentFill(findings)
							: { filled: 0, total: 0 }
					const quality = computeRunQuality({
						schemaName,
						entityMatch,
						rounds: runRounds,
						sourcesTotal: sources?.n ?? 0,
						sourcesFirstParty,
						fieldsGrounded: fill.filled,
						fieldsTotal: fill.total,
						citationsSeen,
						citationsKept,
					})
					const findingsWithQuality = {
						...withRegistryFlag(findings as Record<string, unknown>),
						quality,
					}
					// A thin result flips to a distinct terminal status an automation can
					// gate on. A fan-out is not failed by one thin leaf — its group
					// carries the same marker instead, so the batch reads as needing a
					// look rather than as either broken or clean.
					const finalStatus = quality.low_confidence
						? 'succeeded_low_confidence'
						: 'succeeded'

					yield* sql`
						UPDATE research_runs
						SET status = ${finalStatus},
							phase = 3,
							findings = ${JSON.stringify(findingsWithQuality)},
							country = ${runCountry},
							brief_md = ${briefMd},
							entity_match = ${entityMatch},
							tool_log = ${JSON.stringify(finalToolLog)},
							completed_at = now(),
							updated_at = now()
						WHERE id = ${researchId} AND status = 'running'
					`

					// Stamp the run's cost before the parent group rolls up below.
					yield* stampRunUsage

					// ── Write to research_cache so identical requests can skip the fiber ──
					// Only a full 'succeeded' run is cached: a low-confidence result is
					// thin enough that serving it as a silent cache hit would deny an
					// identical repeat the fresh attempt (discovery + gap rounds) that
					// might do better, and cloneCacheHitRun only clones 'succeeded' rows
					// anyway, so caching a low-confidence run leaves a dead entry.
					if (finalStatus === 'succeeded') {
						const cacheKey = computeResearchCacheKey({
							userId,
							query: (run as { query: string }).query,
							schemaName,
							schemaVersion: schemaVersionFor(schemaName),
							subjects: context?.subjects,
							hints: context?.hints,
							templateFingerprint,
						})
						const ttlDays = researchCacheTtlDaysFor(schemaName)
						yield* sql`
							INSERT INTO research_cache (
								key_hash, organization_id, user_id, research_id, cached_at, expires_at
							) VALUES (
								${cacheKey}, ${(run as { organizationId: string }).organizationId}, ${userId}, ${researchId},
								now(), now() + (${`${ttlDays} days`})::interval
							)
							ON CONFLICT (organization_id, key_hash) DO UPDATE SET
								research_id = EXCLUDED.research_id,
								user_id     = EXCLUDED.user_id,
								cached_at   = EXCLUDED.cached_at,
								expires_at  = EXCLUDED.expires_at
						`.pipe(Effect.ignore)
					}

					// Merge findings onto parent group row if this is a leaf
					const parentId = (run as { parentId: string | null }).parentId
					if (parentId) {
						yield* mergeToParent(parentId, findings)
					}

					const finalUsage = yield* meter.snapshot()
					yield* publishEvent(researchId, 'run.succeeded', {
						tokensIn: finalUsage.tokensIn,
						tokensOut: finalUsage.tokensOut,
					})
				}).pipe(
					// One span covering the whole run, so every phase/tool span nests
					// under it and a failed run points straight at the phase/tool that
					// broke it.
					Effect.withSpan('research.run', {
						attributes: { 'research.run_id': researchId, user_id: userId },
					}),
					// Whole-run deadline: fail a run that keeps its heartbeat beating
					// but never finishes — creeping across many slow-but-not-timed-out
					// model calls — which the stale-heartbeat sweep can't catch (it
					// spares a still-beating run). Fails into the catchCause below, so
					// it records + rolls up like any error.
					Effect.timeoutOrElse({
						duration: `${runDeadlineSeconds} seconds`,
						orElse: () =>
							Effect.fail(
								new Error(
									`research run exceeded its ${runDeadlineSeconds}s time limit`,
								),
							),
					}),
					// Scope the run so the heartbeat fiber (forked above) is
					// interrupted the moment the run finishes, fails, or is cancelled.
					Effect.scoped,
					Effect.catchCause(cause => {
						if (shouldMarkRunFailed(cause)) {
							return Effect.gen(function* () {
								const detail = Cause.pretty(cause)
								const [failedRun] = yield* sql<{ id: string }>`
									UPDATE research_runs
									SET status = 'failed',
										reason_code = ${reasonCodeFor(cause)},
										findings = ${JSON.stringify({ error: detail })},
										completed_at = now(),
										updated_at = now()
									WHERE id = ${researchId} AND status = 'running'
									RETURNING id
								`
								yield* publishEvent(researchId, 'run.failed', {
									error: detail,
								})
								// Record what the run spent before the group rolls up, but only
								// when this actually flipped the run to failed — an error after
								// the run already succeeded leaves that row's figures alone. A
								// run that dies partway still spent real money getting there, so
								// what it measured is written down rather than lost.
								if (failedRun) {
									const usage = yield* (yield* UsageMeter).snapshot()
									yield* stampRunCostFromLedger(
										sql,
										researchId,
										usage.costCents,
										usage,
									)
								}
								// If this leaf belongs to a group, roll the parent up now so
								// an all-failed group resolves instead of hanging in 'running'.
								// A follow-up is excluded on purpose: its parent is the origin
								// run, which already finished, and recomputing it from a
								// follow-up's outcome would mark a succeeded run failed and
								// wipe what it recorded spending.
								const [failedParent] = yield* sql<{
									parentId: string | null
									kind: string
								}>`SELECT parent_id, kind FROM research_runs WHERE id = ${researchId}`
								if (failedParent?.parentId && failedParent.kind !== 'followup')
									yield* rollupParentLocked(failedParent.parentId)
							})
						}
						// Pure interrupt (cancel/shutdown): propagate it; the cancel
						// path sets the status itself, so don't overwrite it.
						return Effect.interrupt
					}),
					Effect.annotateLogs({
						research_id: researchId,
						user_id: userId,
						event: 'research.fiber',
					}),
					// One record of spend per run, wrapping everything the run does, so
					// every phase adds into the same tally.
					Effect.provideServiceEffect(UsageMeter, makeUsageMeter),
				)

			// ── Dispatch ──
			// Three layer-scoped daemons: the reconcile re-offers committed queued
			// runs, a periodic sweep fails runs whose worker died (stale heartbeat),
			// and the consumer drains the queue and runs each job on the layer fiber's
			// clean services — never a request's committed connection. Runs fork into
			// the layer scope so a shutdown interrupts them; the periodic sweep then
			// reclaims their rows. A failure in any is logged, not fatal.
			const layerScope = yield* Effect.scope
			yield* reofferQueued.pipe(
				Effect.catchCause(cause =>
					Effect.logError('research.dispatch: reconcile failed').pipe(
						Effect.annotateLogs({ cause: Cause.pretty(cause) }),
					),
				),
				Effect.repeat(Schedule.spaced('2 seconds')),
				Effect.forkScoped,
			)
			yield* Effect.gen(function* () {
				const swept = yield* sweepOrphanRuns(ORPHAN_AGE_SECONDS)
				if (swept.running.length > 0) {
					yield* Effect.logWarning(
						'research.sweepOrphans: failed runs orphaned mid-run',
					).pipe(
						Effect.annotateLogs({
							running_count: swept.running.length,
							running_ids: swept.running.map(r => r.id),
						}),
					)
				}
			}).pipe(
				Effect.catchCause(cause =>
					Effect.logError('research.dispatch: sweep failed').pipe(
						Effect.annotateLogs({ cause: Cause.pretty(cause) }),
					),
				),
				Effect.repeat(Schedule.spaced(`${orphanSweepIntervalSeconds} seconds`)),
				Effect.forkScoped,
			)
			yield* Queue.take(dispatch).pipe(
				Effect.flatMap(({ researchId, userId }) =>
					Effect.gen(function* () {
						// Skip a run already in flight: the reconcile re-offers queued
						// rows, so the same run can arrive twice. (The guarded claim is
						// the final backstop; this just avoids a redundant fiber.)
						const inFlight = yield* Ref.get(activeFibers)
						if (HashMap.has(inFlight, researchId)) return
						const fiber = yield* fiberSem
							.withPermit(userId)(runFiber(researchId, userId))
							.pipe(
								Effect.ensuring(cleanupRun(researchId)),
								Effect.forkIn(layerScope),
							)
						yield* Ref.update(activeFibers, m =>
							HashMap.set(m, researchId, fiber),
						)
					}),
				),
				Effect.catchCause(cause =>
					Effect.logError('research.dispatch: failed to start run').pipe(
						Effect.annotateLogs({ cause: Cause.pretty(cause) }),
					),
				),
				Effect.forever,
				Effect.forkScoped,
			)

			return {
				/** Create a research run, enqueue it, and return the run id. */
				create: (
					userId: string,
					organizationId: string,
					input: CreateResearchInput,
					systemDefaults: SystemDefaults,
					instructions?: ResolvedInstructions,
				) =>
					Effect.gen(function* () {
						yield* Effect.logInfo('research.create').pipe(
							Effect.annotateLogs({
								user_id: userId,
								organization_id: organizationId,
								query_length: input.query.length,
								schema: input.schemaName ?? 'freeform',
								mode: input.mode ?? 'deep',
								has_subjects: !!input.context?.subjects?.length,
								has_selector: !!input.context?.selector,
							}),
						)

						// A run pinned to a record only makes sense if the record is
						// this organization's. Checked before the cache is consulted,
						// because a cache hit links the same subjects to a new run and
						// would carry a foreign id through untouched. Refused rather
						// than returned as a result, so a caller cannot read past it:
						// every other way out of here starts a run.
						const asked = input.context?.subjects ?? []
						if (asked.length > 0) {
							const missing = yield* subjectsNotOwned(organizationId, asked)
							if (missing.length > 0) {
								yield* Effect.logWarning(
									'research.create.subject_unavailable',
								).pipe(
									Effect.annotateLogs({
										user_id: userId,
										organization_id: organizationId,
										missing_count: missing.length,
									}),
								)
								return yield* new SubjectUnavailable({ subjects: missing })
							}
						}

						// ── Outer research-run cache check ──
						// Identical (user, query, schema, subjects, hints, templates)
						// within TTL returns immediately without forking a fiber.
						// `forceFresh` overrides this and always executes.
						// Instructions are resolved by the app layer (empty when no
						// templates apply). The fingerprint enters the cache key so an
						// edited/swapped stack can't serve a stale run; the same value
						// is threaded to the forked fiber for the write-back key.
						const segments = instructions?.segments ?? []
						const templateFingerprint = instructions?.fingerprint ?? ''
						const templateIds = instructions?.templateIds ?? []
						const templateNames = instructions?.templateNames ?? []
						const schemaNameForKey = input.schemaName ?? 'freeform'
						const cacheKey = computeResearchCacheKey({
							userId,
							query: input.query,
							schemaName: schemaNameForKey,
							schemaVersion: schemaVersionFor(schemaNameForKey),
							subjects: input.context?.subjects,
							hints: input.context?.hints,
							templateFingerprint,
						})
						if (!input.forceFresh) {
							// The SQL client camelCases result keys (snake_case DB ↔
							// camelCase TS), so a selected `research_id` column arrives as
							// `researchId`.
							const hits = yield* sql<{ researchId: string }>`
								SELECT research_id
								FROM research_cache
								WHERE key_hash = ${cacheKey}
									AND organization_id = ${organizationId}
									AND user_id = ${userId}
									AND expires_at > now()
								LIMIT 1
							`
							if (hits[0]) {
								const cloned = yield* cloneCacheHitRun({
									sql,
									cachedId: hits[0].researchId,
									organizationId,
									userId,
									input,
									templateIds,
									templateNames,
									templateFingerprint,
								})
								if (cloned)
									return { id: cloned.id, status: 'succeeded' as const }
							}
						}

						// Resolve policy
						const policy = yield* resolvePolicy({
							sql,
							userId,
							systemDefaults,
							perRunOverrides: {
								budgetCents: input.budgetCents,
								paidBudgetCents: input.paidBudgetCents,
								autoApprovePaidCents: input.autoApprovePaidCents,
							},
						})

						// A selector fans the run out across matching companies: one
						// group parent plus a leaf run per company, sharing this run's
						// policy and instructions. The group's status rolls up from the
						// leaves as they finish. This runs after (and instead of) the
						// cache check above — a fan-out is not one cacheable result.
						const selector = input.context?.selector
						if (selector) {
							const selectorMax = selectorMaxCompanies

							// Resolve targets from a safe subset of company columns — never
							// raw SQL, so the filter can't inject. Default to an empty filter
							// if one is somehow missing, so a malformed selector reaching this
							// far degrades to "match nothing extra" instead of crashing on
							// `filter.status` (callers are validated at the API boundary).
							const filter = (selector.filter ?? {}) as {
								status?: string
								industry?: string
								country?: string
								tags?: ReadonlyArray<string>
							}
							const conds: Array<
								import('effect/unstable/sql').Statement.Fragment
							> = [
								sql`organization_id = ${organizationId}`,
								sql`deleted_at IS NULL`,
							]
							if (filter.status) conds.push(sql`status = ${filter.status}`)
							if (filter.industry)
								conds.push(sql`industry = ${filter.industry}`)
							if (filter.country) conds.push(sql`country = ${filter.country}`)
							if (filter.tags && filter.tags.length > 0)
								conds.push(sql`tags && ${filter.tags}`)

							// Fetch one past the cap so a truncated fan-out is visible.
							const matched = yield* sql<{ id: string }>`
								SELECT id FROM companies
								WHERE ${sql.and(conds)}
								ORDER BY created_at
								LIMIT ${selectorMax + 1}
							`
							const capped = matched.length > selectorMax
							const targets = capped ? matched.slice(0, selectorMax) : matched
							if (capped) {
								yield* Effect.logWarning('research.selector.capped').pipe(
									Effect.annotateLogs({
										user_id: userId,
										matched: matched.length,
										cap: selectorMax,
									}),
								)
							}

							// Fan-out cost gate: a selector launches one run per matched
							// company, so a caller that hasn't set `confirm` gets the
							// scale back first and re-submits with `confirm: true` once the
							// count is acceptable. Nothing has been written yet, so
							// returning here leaves no partial group behind.
							//
							// The figure quoted covers both what a run may spend: the
							// searching and page-fetching every company gets, plus paid
							// vendor data — the latter only as far as the company's month
							// still allows, since that is where charging would stop anyway.
							// Quoting the paid ceiling alone named a number many times what
							// could actually be spent, while leaving out the larger half.
							if (targets.length > 0 && input.confirm !== true) {
								const paidLeft = yield* monthlyRemainingCents(sql, {
									organizationId,
									defaultCapCents: defaultMonthlyCapCents,
									systemCeiling: monthlyCapHardCeilingCents,
								})
								yield* Effect.logInfo(
									'research.selector.confirm_required',
								).pipe(
									Effect.annotateLogs({
										user_id: userId,
										subject_count: targets.length,
									}),
								)
								return {
									status: 'confirm_required' as const,
									subjectCount: targets.length,
									estimatedCostCents:
										targets.length * policy.budgetCents +
										Math.min(targets.length * policy.paidBudgetCents, paidLeft),
								}
							}

							// The group is 'running' with no heartbeat/started_at, so the
							// orphan sweep (which only reclaims stale 'running' rows) never
							// touches it, and it is never dispatched or run itself.
							const [groupRow] = yield* sql<{ id: string }>`
								INSERT INTO research_runs (
									organization_id, query, mode, schema_name, kind, status,
									context, budget_cents, paid_budget_cents, paid_policy,
									created_by, template_ids, template_names,
									template_fingerprint, instruction_segments
								) VALUES (
									${organizationId}, ${input.query}, ${input.mode ?? 'deep'},
									${input.schemaName ?? null}, 'group', 'running',
									${JSON.stringify(input.context ?? {})},
									${policy.budgetCents}, ${policy.paidBudgetCents},
									${JSON.stringify(policy)}, ${userId},
									${JSON.stringify(templateIds)}, ${JSON.stringify(templateNames)},
									${templateFingerprint}, ${JSON.stringify(segments)}
								) RETURNING id
							`
							const groupId = (groupRow as { id: string }).id

							yield* Effect.forEach(targets, company =>
								Effect.gen(function* () {
									// The leaf researches one company; it inherits the hints
									// but not the selector, so it runs as an ordinary subject.
									const leafContext = {
										...(input.context ?? {}),
										selector: undefined,
										subjects: [{ table: 'companies' as const, id: company.id }],
									}
									const [leafRow] = yield* sql<{ id: string }>`
										INSERT INTO research_runs (
											organization_id, parent_id, query, mode, schema_name,
											kind, status, context, budget_cents, paid_budget_cents,
											paid_policy, created_by, template_ids, template_names,
											template_fingerprint, instruction_segments
										) VALUES (
											${organizationId}, ${groupId}, ${input.query},
											${input.mode ?? 'deep'}, ${input.schemaName ?? null},
											'leaf', 'queued', ${JSON.stringify(leafContext)},
											${policy.budgetCents}, ${policy.paidBudgetCents},
											${JSON.stringify(policy)}, ${userId},
											${JSON.stringify(templateIds)},
											${JSON.stringify(templateNames)},
											${templateFingerprint}, ${JSON.stringify(segments)}
										) RETURNING id
									`
									const leafId = (leafRow as { id: string }).id
									yield* sql`
										INSERT INTO research_links (organization_id, research_id, subject_table, subject_id, link_kind)
										VALUES (${organizationId}, ${leafId}, 'companies', ${company.id}, 'input')
										ON CONFLICT DO NOTHING
									`
									const leafPubsub = yield* PubSub.unbounded<ResearchEvent>()
									yield* Ref.update(activePubSubs, m =>
										HashMap.set(m, leafId, leafPubsub),
									)
									yield* Queue.offer(dispatch, { researchId: leafId, userId })
								}),
							)

							// Set the group's initial status from its leaves (and resolve it
							// straight away when the selector matched nothing).
							yield* rollupParentLocked(groupId)

							yield* Effect.logInfo('research.selector.fanout').pipe(
								Effect.annotateLogs({
									user_id: userId,
									group_id: groupId,
									leaves: targets.length,
								}),
							)
							return { id: groupId, status: 'running' as const }
						}

						// Insert the run row
						const [row] = yield* sql`
							INSERT INTO research_runs (
								organization_id,
								query, mode, schema_name, status, context,
								budget_cents, paid_budget_cents,
								paid_policy, idempotency_key, created_by,
								template_ids, template_names, template_fingerprint,
								instruction_segments
							) VALUES (
								${organizationId},
								${input.query},
								${input.mode ?? 'deep'},
								${input.schemaName ?? null},
								'queued',
								${JSON.stringify(input.context ?? {})},
								${policy.budgetCents},
								${policy.paidBudgetCents},
								${JSON.stringify(policy)},
								${input.idempotencyKey ?? null},
								${userId},
								${JSON.stringify(templateIds)},
								${JSON.stringify(templateNames)},
								${templateFingerprint},
								${JSON.stringify(segments)}
							) RETURNING id
						`
						const researchId = (row as { id: string }).id

						// Link input subjects. research_links is RLS-checked against
						// the per-row organization_id, so the column has to be set.
						if (input.context?.subjects) {
							for (const s of input.context.subjects) {
								yield* sql`
									INSERT INTO research_links (organization_id, research_id, subject_table, subject_id, link_kind)
									VALUES (${organizationId}, ${researchId}, ${s.table}, ${s.id}, 'input')
									ON CONFLICT DO NOTHING
								`
							}
						}

						// Create PubSub for SSE streaming
						const pubsub = yield* PubSub.unbounded<ResearchEvent>()
						yield* Ref.update(activePubSubs, m =>
							HashMap.set(m, researchId, pubsub),
						)

						// The row is queued; the dispatch consumer runs it on the
						// service's own connection once a concurrency slot frees.
						// Running it on this request's fiber would reuse the request
						// transaction's connection — already committed by the time
						// the job writes its first cache row.
						yield* Queue.offer(dispatch, { researchId, userId })

						return { id: researchId, status: 'queued' as const }
					}),

				/** Get a research run by id. Groups include children inline. */
				get: (researchId: string) =>
					Effect.gen(function* () {
						// A non-uuid id can match no run; short-circuit to not-found (see isValidUuid)
						// so a bad path param returns 404 instead of a uuid-cast SqlError (500).
						if (!isValidUuid(researchId)) return null
						const [run] = yield* sql`
							-- A failed run keeps its error text inside findings; lift it out
							-- so the detail view can show why the run failed.
							SELECT r.*, r.findings->>'error' AS error_message,
								COALESCE(
									(SELECT json_agg(json_build_object(
										'source_id', rs.source_id,
										'local_ref', rs.local_ref,
										'fetched_at', rs.fetched_at,
										'cost_cents', rs.cost_cents,
										'source', json_build_object(
											'id', s.id,
											'kind', s.kind,
											'provider', s.provider,
											'url', s.url,
											'title', s.title,
											'domain', s.domain,
											'content_hash', s.content_hash,
											'content_ref', s.content_ref
										)
									))
									FROM research_run_sources rs
									JOIN sources s ON s.id = rs.source_id
									WHERE rs.research_id = r.id),
									'[]'::json
								) AS sources,
								COALESCE(
									(SELECT json_agg(json_build_object(
										'subject_table', rl.subject_table,
										'subject_id', rl.subject_id,
										'link_kind', rl.link_kind
									))
									FROM research_links rl
									WHERE rl.research_id = r.id),
									'[]'::json
								) AS links,
								CASE WHEN r.kind = 'group' THEN
									COALESCE(
										(SELECT json_agg(json_build_object(
											'id', c.id,
											'kind', c.kind,
											'status', c.status,
											'query', c.query,
											'findings', c.findings,
											'brief_md', c.brief_md,
											'cost_cents', c.cost_cents,
											'completed_at', c.completed_at
										) ORDER BY c.created_at)
										FROM research_runs c
										WHERE c.parent_id = r.id AND c.status != 'deleted'),
										'[]'::json
									)
								ELSE '[]'::json END AS children
							FROM research_runs r
							WHERE r.id = ${researchId} AND r.status != 'deleted'
						`
						if (run === undefined) return null
						// Decode the run's own columns so its `Date` timestamps become
						// wire-safe DateTime.Utc values; the aggregates (error_message,
						// sources, links, children) are already plain JSON/text, so keep
						// them as-is. A decode failure is a server-invariant bug → die.
						const decoded = yield* Schema.decodeUnknownEffect(ResearchRun)(
							run,
						).pipe(Effect.orDie)
						const extras = run as {
							readonly errorMessage: string | null
							readonly sources: ReadonlyArray<unknown>
							readonly links: ReadonlyArray<unknown>
							readonly children: ReadonlyArray<unknown>
						}
						return {
							...decoded,
							errorMessage: extras.errorMessage,
							sources: extras.sources,
							links: extras.links,
							children: extras.children,
						}
					}),

				/** List research runs with filters. */
				list: (filters: {
					createdBy?: string | undefined
					status?: string | undefined
					subjectTable?: string | undefined
					subjectId?: string | undefined
					since?: string | undefined
					limit?: number | undefined
					offset?: number | undefined
					count?: 'exact' | 'none' | undefined
				}) =>
					Effect.gen(function* () {
						const conditions: Array<
							import('effect/unstable/sql').Statement.Fragment
						> = [sql`r.status != 'deleted'`]
						if (filters.createdBy)
							conditions.push(sql`r.created_by = ${filters.createdBy}`)
						// A comma-separated status asks for several at once — "everything
						// that needs a human", say — and answering that here saves the
						// caller from paging through runs and sifting them by hand.
						if (filters.status) {
							const requestedStatuses = filters.status
								.split(',')
								.map(s => s.trim())
								.filter(s => s !== '')
							if (requestedStatuses.length > 1) {
								conditions.push(sql`r.status = ANY(${requestedStatuses})`)
							} else if (requestedStatuses.length === 1) {
								conditions.push(sql`r.status = ${requestedStatuses[0]}`)
							}
						}
						if (filters.since)
							conditions.push(sql`r.created_at >= ${filters.since}`)

						if (filters.subjectTable && filters.subjectId) {
							conditions.push(sql`EXISTS (
								SELECT 1 FROM research_links rl
								WHERE rl.research_id = r.id
								  AND rl.subject_table = ${filters.subjectTable}
								  AND rl.subject_id = ${filters.subjectId}
							)`)
						}

						// Clamp pagination before it reaches SQL (see clampPagination).
						const { limit, offset } = clampPagination(
							filters.limit,
							filters.offset,
						)
						const count = filters.count ?? 'none'

						const probed = yield* sql<{ readonly total?: string | number }>`
							SELECT r.id, r.kind, r.query, r.mode, r.schema_name,
								r.status, r.cost_cents, r.paid_cost_cents,
								r.created_by, r.created_at, r.completed_at
								${count === 'exact' ? sql`, COUNT(*) OVER () AS total` : sql``}
							FROM research_runs r
							WHERE ${sql.and(conditions)}
							ORDER BY r.created_at DESC
							LIMIT ${probeLimit(limit)}
							OFFSET ${offset}
						`
						const { rows, hasMore } = takePage(probed, limit)
						const total = yield* resolvePageTotal(
							rows,
							offset,
							count,
							() => sql<{ readonly count: string | number }>`
								SELECT count(*) AS count
								FROM research_runs r
								WHERE ${sql.and(conditions)}
							`,
						).pipe(Effect.orDie)
						const items = yield* decodeResearchRunSummaries(rows).pipe(
							Effect.orDie,
						)
						return { items, total, limit, offset, hasMore }
					}),

				/** Pending proposed updates across the org, for the review inbox. */
				listPendingProposals: (filters: {
					subjectTable?: string | undefined
					status?: string | undefined
					minConfidence?: number | undefined
					machineCheckable?: boolean | undefined
					limit?: number | undefined
					offset?: number | undefined
					count?: 'exact' | 'none' | undefined
				}) => queryPendingProposals(sql, filters),

				/** Paid lookups across the org still waiting on a person's decision. */
				listPendingPaidActions: (filters: {
					researchId?: string | undefined
					limit?: number | undefined
					offset?: number | undefined
					count?: 'exact' | 'none' | undefined
				}) => queryPendingPaidActions(sql, filters),

				/** Get all runs linked to a subject row. */
				bySubject: (table: string, id: string) =>
					Effect.gen(function* () {
						const rows = yield* sql`
							SELECT r.id, r.kind, r.query, r.mode, r.schema_name,
								r.status, r.cost_cents, r.paid_cost_cents,
								r.created_by, r.created_at, r.completed_at
							FROM research_runs r
							JOIN research_links rl ON rl.research_id = r.id
							WHERE rl.subject_table = ${table}
							  AND rl.subject_id = ${id}
							  AND r.status != 'deleted'
							ORDER BY r.created_at DESC
						`
						return yield* decodeResearchRunSummaries(rows).pipe(Effect.orDie)
					}),

				// Aggregates research_paid_spend rows for the current org.
				// `range` clamps the time window (defaults to "all"); `groupBy`
				// chooses which dimension to bucket by. The org_isolation_*
				// policy on research_paid_spend already filters cross-org rows
				// because OrgMiddleware sets app.current_org_id at the edge,
				// so the WHERE clause only needs the time bound.
				spend: (filters: {
					range?: 'month' | '30d' | 'all'
					groupBy?: 'provider' | 'user' | 'tool'
				}) =>
					Effect.gen(function* () {
						const groupBy = filters.groupBy ?? 'provider'
						const range = filters.range ?? 'all'

						const sinceFragment =
							range === 'month'
								? sql`AND at >= date_trunc('month', now())`
								: range === '30d'
									? sql`AND at >= now() - interval '30 days'`
									: sql``

						const keyFragment =
							groupBy === 'user'
								? sql`user_id`
								: groupBy === 'tool'
									? sql`tool`
									: sql`provider`

						// Column names arrive camelCased by the SQL client, so the row
						// type names them the way a reader receives them.
						return yield* sql<{
							readonly key: string | null
							readonly amountCents: number
							readonly calls: number
						}>`
							SELECT ${keyFragment} AS key,
								SUM(amount_cents)::int AS amount_cents,
								COUNT(*)::int AS calls
							FROM research_paid_spend
							WHERE 1=1 ${sinceFragment}
							GROUP BY ${keyFragment}
							ORDER BY amount_cents DESC
						`
					}),

				/** Subscribe to SSE events for a run. Returns a Stream. */
				subscribe: (researchId: string) =>
					Effect.gen(function* () {
						const map = yield* Ref.get(activePubSubs)
						const maybePubSub = HashMap.get(map, researchId)
						if (maybePubSub._tag === 'None') return null
						return Stream.fromPubSub(maybePubSub.value)
					}),

				/** Cancel a running research fiber. */
				cancel: (researchId: string) =>
					Effect.gen(function* () {
						yield* Effect.logInfo('research.cancel').pipe(
							Effect.annotateLogs({ research_id: researchId }),
						)
						const map = yield* Ref.get(activeFibers)
						const maybeFiber = HashMap.get(map, researchId)
						if (maybeFiber._tag === 'Some') {
							yield* Fiber.interrupt(maybeFiber.value)
						}
						// RETURNING tells us whether a queued/running row actually
						// flipped, so the caller can tell a real cancel apart from a
						// no-op on a missing or already-finished run. `kind` decides what
						// else to cancel: a group fans out to its leaves, a leaf rolls its
						// group up, a follow-up leaves its origin untouched.
						const [cancelled] = yield* sql<{
							id: string
							parentId: string | null
							kind: string
						}>`
							UPDATE research_runs
							SET status = 'cancelled', completed_at = now(), updated_at = now()
							WHERE id = ${researchId} AND status IN ('queued', 'running')
							RETURNING id, parent_id, kind
						`
						const flipped = cancelled !== undefined
						if (flipped) {
							// A cancelled run may have spent before it stopped; record it.
							// The cheap tally isn't reachable from here, so cost_cents is
							// best-effort 0 while the paid ledger stays authoritative.
							yield* stampRunCostFromLedger(sql, researchId, 0)
							if (cancelled?.kind === 'group') {
								// Cancelling a group stops the whole fan-out, not just the
								// group row: cancel its leaves that are still in flight so
								// they stop spending. The group keeps its 'cancelled' status.
								yield* cancelGroupLeaves(researchId)
							} else if (cancelled?.kind === 'leaf' && cancelled.parentId) {
								// A group's leaf: recompute the parent now — a group whose
								// last leaf is cancelled would otherwise sit in 'running'
								// forever (no fiber left to roll it up, and the orphan sweep
								// spares a group row that never had a heartbeat of its own).
								// A follow-up run is excluded on purpose: its parent is the
								// origin run, which already finished and must not be
								// recomputed from a follow-up's outcome.
								yield* rollupParentLocked(cancelled.parentId)
							}
							yield* publishEvent(researchId, 'run.cancelled', {})
							return { outcome: cancelOutcome(true, true) }
						}
						// Nothing flipped: tell an already-finished run apart from one
						// that doesn't exist at all.
						const [existing] = yield* sql<{ id: string }>`
							SELECT id FROM research_runs
							WHERE id = ${researchId} AND status != 'deleted'
							LIMIT 1
						`
						return { outcome: cancelOutcome(false, existing !== undefined) }
					}),

				/** Soft-delete a research run. */
				softDelete: (researchId: string) =>
					sql`
						UPDATE research_runs
						SET status = 'deleted', updated_at = now()
						WHERE id = ${researchId}
					`,

				/** Post-hoc attach a subject to a run. */
				attach: (
					organizationId: string,
					researchId: string,
					subjectTable: 'companies' | 'contacts',
					subjectId: string,
				) =>
					Effect.gen(function* () {
						// Guard against orphan links: the subject row must exist and
						// belong to this org before we record the link. Branch on the
						// (enum-constrained) table so its name is always a literal,
						// never interpolated into the statement.
						const subjectLookup =
							subjectTable === 'companies'
								? sql<{ id: string }>`
									SELECT id FROM companies
									WHERE id = ${subjectId}
									  AND organization_id = ${organizationId}
									  AND deleted_at IS NULL
									LIMIT 1
								`
								: sql<{ id: string }>`
									SELECT id FROM contacts
									WHERE id = ${subjectId}
									  AND organization_id = ${organizationId}
									  AND deleted_at IS NULL
									LIMIT 1
								`
						const [subject] = yield* subjectLookup
						// Skip the run lookup when the subject is already missing.
						if (!subject) return { outcome: attachOutcome(false, false) }

						// The run must exist under this org as well.
						const [run] = yield* sql<{ id: string }>`
							SELECT id FROM research_runs
							WHERE id = ${researchId}
							  AND organization_id = ${organizationId}
							  AND status != 'deleted'
							LIMIT 1
						`
						const outcome = attachOutcome(true, run !== undefined)
						if (outcome === 'attached') {
							yield* sql`
								INSERT INTO research_links (organization_id, research_id, subject_table, subject_id, link_kind)
								VALUES (${organizationId}, ${researchId}, ${subjectTable}, ${subjectId}, 'finding')
								ON CONFLICT DO NOTHING
							`
						}
						return { outcome }
					}),

				/**
				 * Approve a pending paid action: spawn a follow-up run that performs
				 * the paid call and merges its result onto the origin run. Idempotent —
				 * a re-approve returns the follow-up already spawned rather than
				 * charging again.
				 */
				/**
				 * Re-run a run that grounded on the wrong company, locking onto a
				 * human-supplied correct official domain. Reuses the origin's inputs and
				 * frozen policy, seeding context.anchorDomain so the grounding path treats
				 * that site as authoritative. A clean top-level run, not a child of origin.
				 */
				rerun: (
					userId: string,
					organizationId: string,
					originRunId: string,
					domain: string,
				) =>
					Effect.gen(function* () {
						const host = domainHost(domain)
						if (host === undefined) return { status: 'invalid_domain' as const }
						const [origin] = yield* sql<{
							query: string
							mode: string | null
							schemaName: string | null
							context: unknown
							budgetCents: number
							paidBudgetCents: number
							paidPolicy: string | null
							templateIds: unknown
							templateNames: unknown
							templateFingerprint: string | null
							instructionSegments: unknown
						}>`
							SELECT query, mode, schema_name AS "schemaName", context,
								budget_cents AS "budgetCents",
								paid_budget_cents AS "paidBudgetCents",
								paid_policy::text AS "paidPolicy",
								template_ids AS "templateIds",
								template_names AS "templateNames",
								template_fingerprint AS "templateFingerprint",
								instruction_segments AS "instructionSegments"
							FROM research_runs
							WHERE id = ${originRunId} AND organization_id = ${organizationId}
							LIMIT 1
						`
						if (!origin) return { status: 'run_not_found' as const }

						const originContext =
							origin.context != null && typeof origin.context === 'object'
								? (origin.context as Record<string, unknown>)
								: {}

						// The origin's subjects are carried into the new run as they were
						// stored, so they are checked again here rather than trusted. A run
						// created before subjects were checked at all, or one whose company
						// has since been deleted, must not become runnable by re-running it.
						const originSubjects = Array.isArray(originContext['subjects'])
							? (originContext['subjects'] as ReadonlyArray<unknown>).filter(
									(s): s is { table: string; id: string } =>
										typeof s === 'object' &&
										s !== null &&
										typeof (s as { table?: unknown }).table === 'string' &&
										typeof (s as { id?: unknown }).id === 'string',
								)
							: []
						if (originSubjects.length > 0) {
							const missing = yield* subjectsNotOwned(
								organizationId,
								originSubjects,
							)
							if (missing.length > 0)
								return yield* new SubjectUnavailable({ subjects: missing })
						}

						const mergedContext: Record<string, unknown> = {
							...originContext,
							anchorDomain: host,
						}

						const [row] = yield* sql<{ id: string }>`
							INSERT INTO research_runs (
								organization_id,
								query, mode, schema_name, status, context,
								budget_cents, paid_budget_cents,
								paid_policy, idempotency_key, created_by,
								template_ids, template_names, template_fingerprint,
								instruction_segments
							) VALUES (
								${organizationId},
								${origin.query},
								${origin.mode ?? 'deep'},
								${origin.schemaName},
								'queued',
								${JSON.stringify(mergedContext)},
								${origin.budgetCents},
								${origin.paidBudgetCents},
								${origin.paidPolicy ?? '{}'}::jsonb,
								${null},
								${userId},
								${JSON.stringify(origin.templateIds ?? [])},
								${JSON.stringify(origin.templateNames ?? [])},
								${origin.templateFingerprint ?? ''},
								${JSON.stringify(origin.instructionSegments ?? [])}
							) RETURNING id
						`
						const researchId = (row as { id: string }).id

						// Re-link the origin's input subjects onto the new run.
						const subjects = Array.isArray(mergedContext['subjects'])
							? (mergedContext['subjects'] as Array<{
									table?: unknown
									id?: unknown
								}>)
							: []
						for (const s of subjects) {
							if (
								(s.table === 'companies' || s.table === 'contacts') &&
								typeof s.id === 'string'
							) {
								yield* sql`
									INSERT INTO research_links (organization_id, research_id, subject_table, subject_id, link_kind)
									VALUES (${organizationId}, ${researchId}, ${s.table}, ${s.id}, 'input')
									ON CONFLICT DO NOTHING
								`
							}
						}

						const pubsub = yield* PubSub.unbounded<ResearchEvent>()
						yield* Ref.update(activePubSubs, m =>
							HashMap.set(m, researchId, pubsub),
						)
						yield* Queue.offer(dispatch, { researchId, userId })
						return { status: 'started' as const, id: researchId }
					}),

				approvePaidAction: (runId: string, paId: string, userId: string) =>
					Effect.gen(function* () {
						// Approving the same request twice at once would otherwise start
						// two follow-up runs, each buying the same thing and each charged
						// for it, because both would read the request as still waiting
						// before either marked it approved. Taking turns per run means the
						// second one reads the first's answer and hands it back instead.
						yield* sql`SELECT pg_advisory_xact_lock(hashtext(${runId}))`
						const [origin] = yield* sql<{
							findings: {
								pending_paid_actions?: Array<Record<string, unknown>>
							} | null
							context: { subjects?: unknown } | null
							organizationId: string
							paidPolicy: string | null
							createdBy: string | null
						}>`
							SELECT findings, context,
								organization_id, paid_policy::text AS paid_policy, created_by
							FROM research_runs WHERE id = ${runId}
						`
						if (!origin) return { status: 'run_not_found' as const }
						const actions = origin.findings?.pending_paid_actions ?? []
						const index = actions.findIndex(a => a['id'] === paId)
						if (index === -1) return { status: 'action_not_found' as const }
						const action = actions[index] as Record<string, unknown>
						const existing = action['followup_run_id']
						if (typeof existing === 'string')
							return { status: 'approved' as const, followup_run_id: existing }
						if (action['status'] !== 'pending')
							return { status: 'not_pending' as const }
						// Coerce the model-written tool to a real paid tool; a name that
						// matches none can only be skipped, so it stays unsupported.
						const tool = normalizePaidActionTool(action['tool'])
						if (tool === null) return { status: 'unsupported_tool' as const }

						// A discover_contacts gate whose args carry neither the company
						// name nor its domain can't be run as written. When the run is
						// about a single company, fill both from that company (its name +
						// its website's bare domain) so the approve still discovers the
						// run's own company. A gate that named some other company (its args
						// are present) is used as written, and a run about several companies
						// is left to fail rather than guess which one was meant.
						const rawArgs = (action['args'] ?? {}) as Record<string, unknown>
						let resolvedArgs: Record<string, unknown> = rawArgs
						if (tool === 'discover_contacts') {
							const hasName =
								typeof rawArgs['company_name'] === 'string' &&
								rawArgs['company_name'].trim() !== ''
							const hasDomain =
								typeof rawArgs['domain'] === 'string' &&
								rawArgs['domain'].trim() !== ''
							if (!hasName && !hasDomain) {
								const subjects = Array.isArray(origin.context?.subjects)
									? origin.context.subjects
									: []
								const companies = subjects.filter(
									(s): s is { table: string; id: string } =>
										typeof s === 'object' &&
										s !== null &&
										(s as { table?: unknown }).table === 'companies' &&
										typeof (s as { id?: unknown }).id === 'string',
								)
								const subject =
									companies.length === 1 ? companies[0] : undefined
								if (subject) {
									// The company's own site is one of the addresses it holds
									// rather than a column, so it is read from there. A company
									// with none simply yields no domain, which the discovery
									// call now accepts.
									// The subject id comes off the run's stored context, so it
									// is named by whoever asked for the run rather than looked
									// up here. It is read for this run's own organization —
									// the same rule the fiber follows — so a stored id from
									// somewhere else reads as no company at all.
									const [row] = yield* sql<{
										name: string | null
										website: string | null
									}>`
										SELECT c.name,
											(SELECT ch.address FROM channels ch
												WHERE ch.subject_table = 'companies' AND ch.subject_id = c.id
													AND ch.organization_id = ${origin.organizationId}
													AND ch.channel = 'website'
												ORDER BY ch.is_primary DESC LIMIT 1) AS website
										FROM companies c
										WHERE c.id = ${subject.id}
											AND c.organization_id = ${origin.organizationId}
											AND c.deleted_at IS NULL
										LIMIT 1
									`
									const domain = row?.website
										? domainHost(row.website)
										: undefined
									if (row?.name && domain)
										resolvedArgs = {
											...rawArgs,
											company_name: row.name,
											domain,
										}
								}
							}
						}

						const paidPolicy = origin.paidPolicy
							? (JSON.parse(origin.paidPolicy) as {
									budgetCents?: number
									paidBudgetCents?: number
								})
							: {}
						const followupContext = {
							paid_action: {
								tool,
								args: resolvedArgs,
								origin_run_id: runId,
								action_id: paId,
							},
						}
						const [followup] = yield* sql<{ id: string }>`
							INSERT INTO research_runs (
								organization_id, parent_id, query, mode, kind, status, context,
								budget_cents, paid_budget_cents, paid_policy, created_by
							) VALUES (
								${origin.organizationId}, ${runId}, 'paid follow-up', 'deep',
								'followup', 'queued', ${JSON.stringify(followupContext)},
								${paidPolicy.budgetCents ?? 0}, ${paidPolicy.paidBudgetCents ?? 0},
								${origin.paidPolicy ?? '{}'}::jsonb, ${origin.createdBy ?? userId}
							) RETURNING id
						`
						const followupId = (followup as { id: string }).id
						yield* sql`
							UPDATE research_runs SET findings = jsonb_set(
								jsonb_set(
									findings,
									${`{pending_paid_actions,${index},status}`}::text[],
									'"approved"'::jsonb
								),
								${`{pending_paid_actions,${index},followup_run_id}`}::text[],
								${JSON.stringify(followupId)}::jsonb
							), updated_at = now() WHERE id = ${runId}
						`
						const pubsub = yield* PubSub.unbounded<ResearchEvent>()
						yield* Ref.update(activePubSubs, m =>
							HashMap.set(m, followupId, pubsub),
						)
						yield* Queue.offer(dispatch, {
							researchId: followupId,
							userId: origin.createdBy ?? userId,
						})
						return { status: 'approved' as const, followup_run_id: followupId }
					}).pipe(sql.withTransaction),

				/** Skip a pending paid action: record the decision, spend nothing. */
				skipPaidAction: (runId: string, paId: string) =>
					Effect.gen(function* () {
						const [origin] = yield* sql<{
							findings: {
								pending_paid_actions?: Array<Record<string, unknown>>
							} | null
						}>`
							SELECT findings FROM research_runs WHERE id = ${runId}
						`
						if (!origin) return { status: 'run_not_found' as const }
						const actions = origin.findings?.pending_paid_actions ?? []
						const index = actions.findIndex(a => a['id'] === paId)
						if (index === -1) return { status: 'action_not_found' as const }
						yield* sql`
							UPDATE research_runs SET findings = jsonb_set(
								findings,
								${`{pending_paid_actions,${index},status}`}::text[],
								'"skipped"'::jsonb
							), updated_at = now() WHERE id = ${runId}
						`
						return { status: 'skipped' as const }
					}),

				/** Get user's research policy. */
				getPolicy: (userId: string, organizationId: string) =>
					Effect.gen(function* () {
						const [row] = yield* sql`
							SELECT * FROM user_research_policy WHERE user_id = ${userId}
						`
						if (row === undefined) return null
						// The monthly ceiling is the company's, not this person's, so it
						// is read from the company and shown alongside their own limits.
						const [orgRow] = yield* sql<{ paidMonthlyCapCents: number }>`
							SELECT paid_monthly_cap_cents
							FROM organization_research_policy
							WHERE organization_id = ${organizationId}
						`
						// Decode so the row's `updated_at` Date becomes a wire-safe
						// DateTime.Utc; a decode failure is a server bug → die.
						return yield* decodeResearchPolicy({
							...(row as Record<string, unknown>),
							paidMonthlyCapCents: Math.min(
								orgRow?.paidMonthlyCapCents ?? defaultMonthlyCapCents,
								monthlyCapHardCeilingCents,
							),
						}).pipe(Effect.orDie)
					}),

				/** Update user's research policy. */
				updatePolicy: (
					userId: string,
					organizationId: string,
					fields: {
						budgetCents?: number | undefined
						paidBudgetCents?: number | undefined
						autoApprovePaidCents?: number | undefined
						paidMonthlyCapCents?: number | undefined
						autoApplyMinConfidence?: number | null | undefined
					},
				) =>
					Effect.gen(function* () {
						// The monthly ceiling is the company's, so it is written there and
						// applies to everyone in it, while the rest stay this person's own.
						if (fields.paidMonthlyCapCents !== undefined) {
							yield* sql`
								INSERT INTO organization_research_policy (organization_id, paid_monthly_cap_cents, updated_at)
								VALUES (${organizationId}, ${fields.paidMonthlyCapCents}, now())
								ON CONFLICT (organization_id) DO UPDATE SET
									paid_monthly_cap_cents = ${fields.paidMonthlyCapCents},
									updated_at = now()
							`
						}
						const [row] = yield* sql`
							INSERT INTO user_research_policy (user_id, budget_cents, paid_budget_cents, auto_approve_paid_cents, auto_apply_min_confidence, updated_at)
							VALUES (
								${userId},
								${fields.budgetCents ?? 100},
								${fields.paidBudgetCents ?? 500},
								${fields.autoApprovePaidCents ?? 200},
								${fields.autoApplyMinConfidence ?? null},
								now()
							)
							ON CONFLICT (user_id) DO UPDATE SET
								budget_cents = COALESCE(${fields.budgetCents ?? null}, user_research_policy.budget_cents),
								paid_budget_cents = COALESCE(${fields.paidBudgetCents ?? null}, user_research_policy.paid_budget_cents),
								auto_approve_paid_cents = COALESCE(${fields.autoApprovePaidCents ?? null}, user_research_policy.auto_approve_paid_cents),
								-- Nullable on purpose: passing null turns auto-apply off, so a
								-- provided value (even null) is honored while an omitted one keeps
								-- the current setting.
								auto_apply_min_confidence = CASE
									WHEN ${fields.autoApplyMinConfidence !== undefined}
									THEN ${fields.autoApplyMinConfidence ?? null}
									ELSE user_research_policy.auto_apply_min_confidence
								END,
								updated_at = now()
							RETURNING *
						`
						// The upsert always affects a row; a missing one means the write
						// produced nothing, which is a defect worth failing loudly on.
						if (row === undefined)
							return yield* Effect.die(
								new Error('user_research_policy upsert returned no row'),
							)
						// The monthly ceiling is the company's, not this person's, so it is
						// read from the company and returned alongside their own limits.
						const [savedOrgRow] = yield* sql<{ paidMonthlyCapCents: number }>`
							SELECT paid_monthly_cap_cents
							FROM organization_research_policy
							WHERE organization_id = ${organizationId}
						`
						return yield* decodeResearchPolicy({
							...(row as Record<string, unknown>),
							paidMonthlyCapCents: Math.min(
								savedOrgRow?.paidMonthlyCapCents ?? defaultMonthlyCapCents,
								monthlyCapHardCeilingCents,
							),
						}).pipe(Effect.orDie)
					}),

				/** Mark orphaned running + queued rows as failed. */
				sweepOrphans: (maxAgeSeconds: number) => sweepOrphanRuns(maxAgeSeconds),
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
