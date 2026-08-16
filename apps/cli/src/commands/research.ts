import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

import {
	Config,
	ConfigProvider,
	Console,
	Effect,
	Layer,
	Option,
	type Redacted,
} from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { SqlClient } from 'effect/unstable/sql'

import { isTerminalResearchStatus } from '@batuda/domain'
import { makeOtlpObservability } from '@batuda/observability'
import {
	BlobStorage,
	buildContactEvalReport,
	buildEvalReport,
	ContactDiscovery,
	type ContactEvalSummary,
	type ContactGoldenExpectation,
	type ContactRunScore,
	type CreateResearchInput,
	compareFramings,
	configuredSlots,
	contactEvalSpanAttributes,
	contactEvalSummaryAttributes,
	type EvalSummary,
	evalSpanAttributes,
	evalSummaryAttributes,
	type FramingOutcome,
	type GoldenExpectation,
	type MarketExpectation,
	type MarketScore,
	type ModelProbeResult,
	makeResearchLlmLive,
	makeResearchProvidersLive,
	outcomeFromContactRun,
	outcomeFromRun,
	ProviderError,
	parseContactGoldenSet,
	parseGoldenSet,
	probeModelCapabilities,
	type RawContactGoldenRow,
	type RawGoldenRow,
	ResearchEventSink,
	ResearchService,
	type ResolvedInstructions,
	type RunScore,
	type RunUsage,
	researchToolkitWireFormat,
	type SystemDefaults,
	scoreContactRun,
	scoreRun,
} from '@batuda/research'

import { SqlLive } from '../db'
import { requireLocalDatabase } from '../lib/confirm-cloud'
import { requireLiveProviders } from '../lib/require-live-providers'

// `pnpm cli` runs from apps/cli, so resolve a relative --golden/--out against the
// repo root — where a reader of the docs expects the path to be.
const REPO_ROOT = resolve(import.meta.dirname, '../../../..')
const fromRepoRoot = (path: string): string =>
	isAbsolute(path) ? path : resolve(REPO_ROOT, path)

const mark = (ok: boolean): string => (ok ? '✓' : '✗')

// ── probe ──────────────────────────────────────────────────

const formatProbe = (result: ModelProbeResult): string =>
	[
		`${mark(result.passed)} ${result.model}`,
		`    tool_choice  ${mark(result.toolChoice.ok)}  ${result.toolChoice.detail}`,
		`    json_schema  ${mark(result.jsonSchema.ok)}  ${result.jsonSchema.detail}`,
	].join('\n')

/**
 * Probe each candidate model on an OpenAI-compatible endpoint for the two features
 * the research tiers depend on — forced tool calling and strict JSON-schema output.
 *
 * The key is read from whichever environment variable is named, so probing a
 * tier's second model is a matter of naming that tier's second key. The key
 * itself never appears on the command line, where it would be echoed into logs
 * and shell history.
 *
 * It probes with the real research tools, so a pass means the model accepts what a
 * run would actually send it.
 */
export const researchProbe = (opts: {
	readonly baseUrl: string
	readonly apiKeyEnv: string
	readonly models: ReadonlyArray<string>
}) =>
	Effect.gen(function* () {
		const apiKey = yield* Config.redacted(opts.apiKeyEnv)
		const tools = researchToolkitWireFormat()
		yield* Console.log(
			`Probing ${opts.models.length} model(s) at ${opts.baseUrl} with ${tools.length} research tool(s)\n`,
		)
		const results: ModelProbeResult[] = []
		for (const model of opts.models) {
			const result = yield* probeModelCapabilities({
				baseUrl: opts.baseUrl,
				apiKey,
				model,
				tools,
			})
			results.push(result)
			yield* Console.log(formatProbe(result))
		}
		const passed = results.filter(result => result.passed)
		yield* Console.log(
			`\nGate: ${passed.length}/${results.length} passed (tool_choice + json_schema).`,
		)
		if (passed.length > 0) {
			yield* Console.log(`Eligible: ${passed.map(r => r.model).join(', ')}`)
		}
	}).pipe(Effect.provide(FetchHttpClient.layer))

/**
 * Ask every model the settings point a tier at whether it can still do what
 * that tier needs.
 *
 * A model can stop supporting a feature without anything here changing, and
 * nothing notices until the moment it is needed — which is exactly when the
 * first-choice model is already struggling. This is meant to be run on a
 * schedule so that day arrives with warning.
 *
 * It fails only when a model itself will not do the work. A rejected key, a
 * rate limit or a vendor having a bad minute are reported and let through:
 * treating those as a verdict would raise an alarm about a model over somebody
 * else's outage.
 */
export const researchProbeConfig = () =>
	Effect.gen(function* () {
		const slots = yield* configuredSlots()
		if (slots.length === 0) {
			yield* Console.log('No tier reaches a vendor; nothing to check.')
			return
		}
		const tools = researchToolkitWireFormat()
		const unusable: string[] = []
		const unknown: string[] = []

		for (const slot of slots) {
			const where = `${slot.tier} slot ${slot.slot} — ${slot.model} on ${slot.vendor}`
			const apiKey = yield* Config.redacted(slot.apiKeyEnv).pipe(
				Effect.map(Option.some),
				Effect.orElseSucceed(() => Option.none<Redacted.Redacted<string>>()),
			)
			if (Option.isNone(apiKey)) {
				unknown.push(`${where}: no key in ${slot.apiKeyEnv}`)
				yield* Console.log(`? ${where} — no key in ${slot.apiKeyEnv}`)
				continue
			}
			const result = yield* probeModelCapabilities({
				baseUrl: slot.baseUrl,
				apiKey: apiKey.value,
				model: slot.model,
				tools,
			})
			yield* Console.log(`${mark(result.passed)} ${where}`)
			yield* Console.log(formatProbe(result).split('\n').slice(1).join('\n'))
			for (const check of [result.toolChoice, result.jsonSchema]) {
				if (check.ok) continue
				if (check.verdict === 'capability')
					unusable.push(`${where}: ${check.detail}`)
				else unknown.push(`${where}: [${check.verdict}] ${check.detail}`)
			}
		}

		if (unknown.length > 0) {
			yield* Console.log(
				`\nCould not tell for ${unknown.length} check(s) — nothing here says a model went bad:\n${unknown.map(line => `  ${line}`).join('\n')}`,
			)
		}
		if (unusable.length > 0) {
			yield* Console.log(
				`\n${unusable.length} model(s) can no longer do what their tier needs:\n${unusable.map(line => `  ${line}`).join('\n')}`,
			)
			return yield* Effect.fail(
				new Error(`${unusable.length} configured model(s) unusable`),
			)
		}
		yield* Console.log('\nEvery configured model can still do its tier’s work.')
	}).pipe(Effect.provide(FetchHttpClient.layer))

// ── eval ───────────────────────────────────────────────────

// Holds scraped page text for one eval process only, so a pass leaves no page
// bodies behind. A key with no bytes fails as a recoverable provider error,
// which the scrape cache answers by treating the page as unread and fetching it
// again: the database outlives this map, so a pass can meet a page an earlier
// pass recorded and stopping the run over it would be wrong.
const inMemoryBlob = Layer.sync(BlobStorage, () => {
	const store = new Map<string, Uint8Array>()
	return BlobStorage.of({
		put: (key, bytes) =>
			Effect.sync(() => {
				store.set(key, bytes)
			}),
		get: key => {
			const bytes = store.get(key)
			return bytes !== undefined
				? Effect.succeed(bytes)
				: Effect.fail(
						new ProviderError({
							provider: 'eval-blob',
							message: `blob not found: ${key}`,
							recoverable: true,
						}),
					)
		},
	})
})

// A run fires observability events the eval does not consume, and it never needs
// to reach a real contact — both are stubbed so only the quality-relevant layers
// (the live LLM tiers + providers) shape the numbers.
const noopEventSink = Layer.succeed(ResearchEventSink)(
	ResearchEventSink.of({ fire: () => Effect.void }),
)
const noopContactDiscovery = Layer.succeed(ContactDiscovery)({
	discover: () =>
		Effect.succeed({ status: 'no_reliable_contact' as const, researchId: '' }),
})

// The eval assembles the same minimal ResearchService the server's dispatch
// integration test does, but with the LIVE llm + provider layers (from research
// env) rather than stubs — because measuring quality is the whole point.
const researchLive = ResearchService.layer.pipe(
	Layer.provide(makeResearchLlmLive),
	Layer.provide(makeResearchProvidersLive),
	Layer.provide(noopContactDiscovery),
	Layer.provide(noopEventSink),
	Layer.provide(inMemoryBlob),
	Layer.provide(FetchHttpClient.layer),
	Layer.provideMerge(SqlLive),
)

const systemDefaults = Effect.gen(function* () {
	const readCents = (name: string, fallback: number) =>
		Config.int(name).pipe(Config.withDefault(fallback))
	return {
		budgetCents: yield* readCents('RESEARCH_DEFAULT_BUDGET_CENTS', 100),
		paidBudgetCents: yield* readCents(
			'RESEARCH_DEFAULT_PAID_BUDGET_CENTS',
			500,
		),
		autoApprovePaidCents: yield* readCents(
			'RESEARCH_DEFAULT_AUTO_APPROVE_PAID_CENTS',
			200,
		),
		paidMonthlyCapCents: yield* readCents(
			'RESEARCH_DEFAULT_PAID_MONTHLY_CAP_CENTS',
			2000,
		),
		hardCeiling: yield* readCents(
			'RESEARCH_MONTHLY_CAP_HARD_CEILING_CENTS',
			10000,
		),
	} satisfies SystemDefaults
})

interface FinishedRun {
	readonly status?: string
	readonly findings?: unknown
	// What the run was billed and what it consumed, from its own columns.
	readonly costCents?: number
	readonly paidCostCents?: number
	readonly tokensIn?: number
	readonly tokensOut?: number
	readonly quotaBreakdown?: Record<string, number> | null
	// How many calls each model answered, keyed `<tier>@<model>`.
	readonly llmModels?: Record<string, number> | null
	// The run's final entity verdict, from its own column (not the findings JSON).
	readonly entityMatch?: string | null
}

// What the run recorded spending, taken from the row rather than tallied here,
// so the report shows what was actually stored against the run. Credits are
// summed across providers: a pass may cascade between them, and the question the
// report answers is what one run consumed in total.
const usageOf = (run: FinishedRun): RunUsage => {
	const credits = Object.values(run.quotaBreakdown ?? {})
	const callsByModel = run.llmModels ?? {}
	return {
		costCents: run.costCents ?? 0,
		paidCostCents: run.paidCostCents ?? 0,
		tokensIn: run.tokensIn ?? 0,
		tokensOut: run.tokensOut ?? 0,
		creditsUsed: credits.reduce((total, n) => total + n, 0),
		...(Object.keys(callsByModel).length > 0 ? { callsByModel } : {}),
	}
}

// Poll get() until the dispatch consumer drives the run to a terminal status, or
// the attempt budget runs out (so a stuck run reports its last status, not hangs).
const pollToTerminal = (runId: string, maxAttempts: number) =>
	Effect.gen(function* () {
		const svc = yield* ResearchService
		let run: FinishedRun | null = null
		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			run = (yield* svc
				.get(runId)
				.pipe(Effect.orElseSucceed(() => null))) as FinishedRun | null
			if (isTerminalResearchStatus(run?.status ?? 'unknown')) return run
			yield* Effect.sleep('1 second')
		}
		return run
	})

// How long to wait for one run, in one-second polls: three quarters of an hour. A
// search for a whole market is a long job — the one this measures ran for 32 minutes
// over some 300 pages — and a run still going when the poll gives up is read as a
// run that failed, which would score every market request as having found nothing.
//
// This has to stay above `RESEARCH_RUN_DEADLINE_SEC`, which is what actually bounds
// a run: the run ends itself at that deadline, and waiting past it is what lets the
// poll read the answer rather than time out alongside it. That setting defaults to
// twenty minutes, which is *below* a market search's normal length, so a market pass
// has to raise it — otherwise the run is killed mid-search and the list it had so
// far is thrown away, which reads as a market with nothing in it.
const MARKET_RUN_POLL_ATTEMPTS = 2_700

// What a run answering about one company gets. A profile run finishes in minutes, so
// a market-sized wait here only lengthens how long a wedged one holds its slot — but
// it still has to clear `RESEARCH_RUN_DEADLINE_SEC` for the same reason the market
// wait does. At the old 900 it sat below that setting's twenty-minute default, so a
// profile run that took longer than fifteen minutes was read as having found nothing
// while it was still working, and scored as an empty result rather than a slow one.
const COMPANY_RUN_POLL_ATTEMPTS = 1_500

// Create a fresh eval run and poll it to a terminal status. A single golden
// company never fans out, so a confirm-required result is a bug — die on it.
// Returns the run id (for source lookups) and the finished run.
const createRunToTerminal = (
	user: string,
	org: string,
	input: CreateResearchInput,
	defaults: SystemDefaults,
	instructions: ResolvedInstructions | undefined,
	pollAttempts: number,
) =>
	Effect.gen(function* () {
		const svc = yield* ResearchService
		const created = yield* svc.create(user, org, input, defaults, instructions)
		if (created.status === 'confirm_required')
			return yield* Effect.die(new Error('eval run should not fan out'))
		const run = yield* pollToTerminal(created.id, pollAttempts)
		return { runId: created.id, run }
	})

const driveOne = (
	org: string,
	user: string,
	defaults: SystemDefaults,
	golden: GoldenExpectation,
	schemaName: string,
	language: string | undefined,
) =>
	Effect.gen(function* () {
		// Narrow the free-text flag to a supported language, dropping anything else.
		const lang = (['ca', 'es', 'en'] as const).find(l => l === language)
		const input: CreateResearchInput = {
			query: golden.query,
			schemaName,
			// Always execute a fresh run; a cached clone would score stale data.
			forceFresh: true,
			// Carry the language hint so the search looks in the target's own
			// language — the seam for testing a non-English company end to end.
			...(lang ? { context: { hints: { language: lang } } } : {}),
		}
		// A market request is the long job; anything else answers about one company.
		const { runId, run } = yield* createRunToTerminal(
			user,
			org,
			input,
			defaults,
			undefined,
			golden.market === undefined
				? COMPANY_RUN_POLL_ATTEMPTS
				: MARKET_RUN_POLL_ATTEMPTS,
		)
		// Grounding is judged by the pages the run reached, so pull its fetched
		// source URLs — per-field citations may point at third-party fact-sources.
		const sql = yield* SqlClient.SqlClient
		const sourceRows = yield* sql<{ url: string }>`
			SELECT DISTINCT s.url
			FROM research_run_sources rs JOIN sources s ON s.id = rs.source_id
			WHERE rs.research_id = ${runId}
		`
		const outcome = outcomeFromRun({
			status: run?.status ?? 'failed',
			findings: run?.findings,
			schemaName,
			fetchedUrls: sourceRows.map(row => row.url),
			...(run ? { usage: usageOf(run) } : {}),
		})
		return scoreRun(golden, outcome)
	})

// A market request's repeated runs, as what its list got right. Nothing a company
// row reports applies — there is no company to have reached and no field of its own
// to have filled — so this is a separate line rather than the same one with most of
// it reading "n/a".
const formatMarketRuns = (
	id: string,
	market: MarketExpectation,
	scores: ReadonlyArray<RunScore>,
): string => {
	const markets = scores.flatMap(score => score.market ?? [])
	// Every run died or was stopped, so there is nothing to divide. Saying so is the
	// point: falling through to the company line would report a market request as
	// having failed to reach a company nobody named.
	if (markets.length === 0)
		return `${id.padEnd(20)} market ${market.name.padEnd(6)}  no run reached an answer (${scores.length} attempted)`
	const total = (pick: (market: MarketScore) => number): number =>
		markets.reduce((sum, market) => sum + pick(market), 0)
	const rows = total(market => market.rowsReturned)
	const share = (matched: number): string =>
		rows === 0 ? 'n/a' : `${matched}/${rows}`
	const parts = total(market => market.partsExpected)
	// The shares divide by their own totals, so summing across repeats is right for
	// them. The row count is not a share: printing the sum would read 186 rows for one
	// 62-row list asked for three times, so it is the rows one run came back with.
	const rowsPerRun = rows / markets.length
	return [
		`${id.padEnd(20)} market ${market.name.padEnd(6)}`,
		`rows ${rowsPerRun.toFixed(0).padStart(3)}`,
		`right kind ${share(total(market => market.rowsRightKind))}`,
		`confirmed ${share(total(market => market.rowsConfirmed))}`,
		`duplicates ${share(total(market => market.rowsDuplicated))}`,
		`located ${share(total(market => market.rowsLocated))}`,
		`parts ${parts === 0 ? 'n/a' : `${total(market => market.partsAnswered)}/${parts}`}`,
	].join('  ')
}

// Aggregate one golden row's repeated runs into shares (grounded 3/5, …). Per-run
// grounding is noisy, so the fraction across runs is the trustworthy signal. A row
// that asked for a market answers none of those questions and prints its own line.
const formatGoldenRuns = (
	golden: GoldenExpectation,
	scores: ReadonlyArray<RunScore>,
): string => {
	const id = golden.id
	if (golden.market !== undefined)
		return formatMarketRuns(id, golden.market, scores)
	const total = scores.length
	const share = (matched: number): string => `${matched}/${total}`
	const grounded = scores.filter(score => score.grounded).length
	const wrong = scores.filter(score => score.wrongCompany).length
	const empty = scores.filter(score => score.empty).length
	const scored = scores.reduce((sum, score) => sum + score.fieldsScored, 0)
	const correct = scores.reduce((sum, score) => sum + score.fieldsCorrect, 0)
	const fields = scored === 0 ? 'n/a' : pct(correct / scored)
	const contactsExpected = scores.reduce(
		(sum, score) => sum + score.contactsExpected,
		0,
	)
	const contactsFound = scores.reduce(
		(sum, score) => sum + score.contactsFound,
		0,
	)
	const contacts =
		contactsExpected === 0 ? 'n/a' : `${contactsFound}/${contactsExpected}`
	return `${id.padEnd(20)} grounded ${share(grounded)}  wrong ${share(wrong)}  empty ${share(empty)}  fields ${fields}  contacts ${contacts}`
}

const pct = (value: number | null): string =>
	value === null ? 'n/a' : `${Math.round(value * 100)}%`

// Money reads in cents to the penny; tokens and credits are whole things.
const cents = (value: number | null): string =>
	value === null ? 'n/a' : `${value.toFixed(1)}c`
const count = (value: number | null): string =>
	value === null ? 'n/a' : String(Math.round(value))

// A per-run average of whole things lands between them, so keep one decimal:
// three people across two runs is 1.5, and rounding that to 2 overstates it.
const decimal = (value: number | null): string =>
	value === null ? 'n/a' : value.toFixed(1)

const formatSummary = (summary: EvalSummary): string =>
	[
		'',
		`Runs:                   ${summary.runs}`,
		`Grounding accuracy:     ${pct(summary.groundingAccuracy)}`,
		`Field precision:        ${pct(summary.fieldPrecision)}`,
		`Field recall:           ${pct(summary.fieldRecall)}`,
		`Titled-contact recall:  ${pct(summary.contactRecall)}`,
		...formatMarketFigures(summary),
		`Profile fields filled:  ${decimal(summary.fieldsFilledPerRun)} of ${count(summary.profileFieldsTotal)}`,
		`People named per run:   ${decimal(summary.contactsNamedPerRun)}`,
		`  of those, titled:     ${decimal(summary.contactsTitledPerRun)}`,
		`Wrong-company rate:     ${pct(summary.wrongCompanyRate)}`,
		`Wrong and unwatched:    ${pct(summary.wrongCompanyAutoApplicableRate)}`,
		`Needs-review rate:      ${pct(summary.lowConfidenceRate)}`,
		`Empty rate:             ${pct(summary.emptyRate)}`,
		`Cost per run:           ${cents(summary.costPerRun)}`,
		`Cost per grounded run:  ${cents(summary.costPerGroundedRun)}`,
		`  of which metered:     ${cents(summary.paidCostPerRun)}`,
		`Tokens per run:         ${count(summary.tokensPerRun)}`,
		`Credits per run:        ${count(summary.creditsPerRun)}`,
		...formatAnsweringModels(summary),
	].join('\n')

// What a pass of market requests got right. Silent for a pass of company profiles,
// which has no list to judge — the figures are all null there, and printing five
// "n/a" lines on every ordinary pass buries the ones that mean something.
const formatMarketFigures = (summary: EvalSummary): ReadonlyArray<string> =>
	summary.rowsPerScan === null
		? []
		: [
				`Rows per market:        ${decimal(summary.rowsPerScan)}`,
				`  right kind:           ${pct(summary.organisationKindPrecision)}`,
				`  confirmed:            ${pct(summary.confirmationRate)}`,
				`  duplicates:           ${pct(summary.duplicateRate)}`,
				`  with a location:      ${pct(summary.locationFill)}`,
				`Request coverage:       ${pct(summary.requestCoverage)}`,
			]

// Which models actually did the work. A tier is configured with a first choice
// and a second one for when the first falters, so a pass can quietly be carried
// out by a model it was not set up to measure — and the quality of the two is
// not the same. Silent when every run stayed on its first choice.
const formatAnsweringModels = (summary: EvalSummary): ReadonlyArray<string> => {
	const entries = Object.entries(summary.callsByModel)
	if (entries.length === 0) return []
	const lines = entries
		.sort(([, a], [, b]) => b - a)
		.map(([key, calls]) => `  ${key}: ${calls} call(s)`)
	return [
		`Answered by:`,
		...lines,
		`Runs that fell back:    ${pct(summary.cascadedRunRate)}`,
	]
}

// One compact line per group (a bucket, a country), so a segment that regressed
// stands out against the whole-set numbers above.
const formatGroups = (
	title: string,
	groups: Record<string, EvalSummary>,
): string =>
	[
		'',
		`── ${title} ──`,
		...Object.entries(groups)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(
				([key, s]) =>
					`${key.padEnd(10)} runs ${String(s.runs).padStart(3)}  ground ${pct(
						s.groundingAccuracy,
					)}  prec ${pct(s.fieldPrecision)}  recall ${pct(
						s.fieldRecall,
					)}  wrong ${pct(s.wrongCompanyRate)}  empty ${pct(
						s.emptyRate,
					)}  cost ${cents(s.costPerRun)}`,
			),
	].join('\n')

// One line per market. This is the breakdown the market figures exist for rather
// than a nicety: the organisation-kind guard reads Spanish, Catalan and English, so
// a market answering in one of those scores near 100% while a market answering in
// French or German scores far lower. Averaged together that difference vanishes,
// and it is the whole thing worth watching.
const formatMarketGroups = (groups: Record<string, EvalSummary>): string =>
	[
		'',
		'── By market ──',
		...Object.entries(groups)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(
				([key, s]) =>
					`${key.padEnd(10)} runs ${String(s.runs).padStart(3)}  rows ${decimal(
						s.rowsPerScan,
					)}  right kind ${pct(s.organisationKindPrecision)}  confirmed ${pct(
						s.confirmationRate,
					)}  dupes ${pct(s.duplicateRate)}  located ${pct(
						s.locationFill,
					)}  coverage ${pct(s.requestCoverage)}  cost ${cents(s.costPerRun)}`,
			),
	].join('\n')

// The one shape that answers a market request. Both scan shapes return a list, but
// only a prospect row carries a place, so a market scored against the competitor
// shape reads nought location fill for a field that shape never had. Run a market
// against the profile shape — which is what --schema defaults to — and every row
// scores nought rows and nought coverage, which looks exactly like a pipeline that
// found nothing rather than like the wrong flag.
const MARKET_SCHEMA = 'prospect_scan_v1'

const requireMarketSchema = (
	golden: ReadonlyArray<GoldenExpectation>,
	schemaName: string,
) => {
	const markets = golden.filter(row => row.market !== undefined).length
	return markets > 0 && schemaName !== MARKET_SCHEMA
		? Effect.fail(
				new Error(
					`${markets} golden row(s) ask for a whole market, which only ${MARKET_SCHEMA} answers; --schema is "${schemaName}". Re-run with --schema ${MARKET_SCHEMA}.`,
				),
			)
		: Effect.void
}

/**
 * Run the golden set through the live research pipeline and report the four quality
 * metrics. This drives real runs (LLM + providers + DB), so it needs the research
 * env configured and an org/user to run as; it connects under a BYPASS-RLS role and
 * passes the org explicitly, the way a batch job does.
 */
export const researchEval = (opts: {
	readonly org: string
	readonly user: string
	readonly goldenPath: string
	readonly schemaName: string
	readonly language: Option.Option<string>
	readonly concurrency: number
	readonly runs: number
	readonly out: Option.Option<string>
	readonly byBucket: boolean
}) =>
	Effect.gen(function* () {
		yield* requireLocalDatabase('research eval')
		// A profile pass reads pages the agent finds and the extract tier reads. The
		// writer tier only phrases the human brief, which nothing here scores, and the
		// company registers are asked to be off for a comparison — so neither is
		// required, and demanding them would refuse a correct setup.
		yield* requireLiveProviders('research eval', {
			tiers: ['agent', 'extract'],
			capabilities: ['search', 'scrape'],
		})
		const raw = yield* Effect.tryPromise({
			try: () => readFile(fromRepoRoot(opts.goldenPath), 'utf8'),
			catch: error => new Error(`cannot read golden set: ${String(error)}`),
		})
		const rows = JSON.parse(raw) as ReadonlyArray<RawGoldenRow>
		const { golden, errors } = parseGoldenSet(rows)
		for (const bad of errors) {
			yield* Console.error(`skipped ${bad.id}: ${bad.error}`)
		}
		if (golden.length === 0) {
			return yield* Effect.fail(new Error('golden set has no valid rows'))
		}
		yield* requireMarketSchema(golden, opts.schemaName)

		// One pass is cheap because it reads whatever an earlier pass left behind. A
		// repeat cannot afford to: an answer served from the first round's cache is
		// the first round's answer, and averaging it with itself steadies nothing. So
		// a pass asking for repeats goes past the caches, and pays for every round.
		const repeating = opts.runs > 1
		const cacheSettings = ConfigProvider.layerAdd(
			ConfigProvider.fromEnv({
				env: repeating ? { RESEARCH_CACHE_BYPASS: 'true' } : {},
			}),
			{ asPrimary: true },
		)

		yield* Console.log(`Evaluating ${golden.length} companies…\n`)
		if (repeating) {
			yield* Console.log(
				`Each company runs ${opts.runs} times, in ${opts.runs} rounds over the whole set, and every round asks the providers again rather than reading the last round's answer. Expect roughly ${opts.runs} times the cost and the time of a single pass.\n`,
			)
		}

		// Tag the run's spans so a drift chart can group quality by which models
		// produced it; the endpoint/commit ride the OTLP resource, not here.
		const agentModel = yield* Config.string('RESEARCH_LLM_AGENT_MODEL').pipe(
			Config.withDefault('unknown'),
		)
		const extractModel = yield* Config.string(
			'RESEARCH_LLM_EXTRACT_MODEL',
		).pipe(Config.withDefault('unknown'))
		yield* Effect.annotateCurrentSpan({
			'eval.agent_model': agentModel,
			'eval.extract_model': extractModel,
			'eval.companies': golden.length,
		})

		const scores = yield* Effect.gen(function* () {
			const defaults = yield* systemDefaults
			// A round is one pass over every company. Repeats are rounds rather than a
			// flat list of runs so that a company's second answer is taken after its
			// first has finished, which is what the caches were told to step aside for.
			const rounds = Array.from({ length: opts.runs }, (_, index) => index + 1)
			const perRound = yield* Effect.forEach(rounds, round =>
				Effect.forEach(
					golden,
					company =>
						driveOne(
							opts.org,
							opts.user,
							defaults,
							company,
							opts.schemaName,
							Option.getOrUndefined(opts.language),
						).pipe(
							Effect.tap(score =>
								Effect.annotateCurrentSpan(evalSpanAttributes(score)),
							),
							Effect.withSpan('research_eval.run', {
								attributes: {
									'eval.company_id': company.id,
									'eval.query': company.query,
									'eval.schema': opts.schemaName,
									'eval.round': round,
									'eval.agent_model': agentModel,
									'eval.extract_model': extractModel,
								},
							}),
						),
					{ concurrency: opts.concurrency },
				),
			)
			return perRound.flat()
		}).pipe(Effect.provide(researchLive), Effect.provide(cacheSettings))

		for (const company of golden) {
			yield* Console.log(
				formatGoldenRuns(
					company,
					scores.filter(score => score.id === company.id),
				),
			)
		}

		const report = buildEvalReport(scores)
		yield* Console.log(formatSummary(report.summary))
		if (opts.byBucket) {
			yield* Console.log(formatGroups('By bucket', report.byBucket))
			yield* Console.log(formatGroups('By country', report.byCountry))
		}
		// Not behind the breakdown flag: a market pass is run to read this, and one
		// market's figures averaged with another's is the reading it exists to replace.
		if (Object.keys(report.byMarket).length > 0) {
			yield* Console.log(formatMarketGroups(report.byMarket))
		}
		yield* Effect.annotateCurrentSpan(evalSummaryAttributes(report.summary))
		yield* Option.match(opts.out, {
			onNone: () => Effect.void,
			onSome: path =>
				Effect.tryPromise({
					try: () =>
						writeFile(fromRepoRoot(path), JSON.stringify(report, null, 2)),
					catch: error => new Error(`cannot write report: ${String(error)}`),
				}).pipe(
					Effect.tap(() =>
						Console.log(`\nReport written to ${fromRepoRoot(path)}`),
					),
				),
		})
	}).pipe(
		// One span per eval run plus this batch span, exported to the monitoring
		// board when OTEL_EXPORTER_OTLP_ENDPOINT is set; a no-op native tracer
		// otherwise, so a local run still prints its table and writes its report.
		Effect.withSpan('research_eval.batch', {
			attributes: {
				'eval.schema': opts.schemaName,
				'eval.runs_per_company': opts.runs,
			},
		}),
		Effect.provide(
			makeOtlpObservability({ serviceName: 'batuda-research-eval' }),
		),
	)

// ── eval-contacts ──────────────────────────────────────────

// Same minimal wiring as researchLive, minus the LLM tiers and ResearchService:
// ContactDiscovery is the thing under test, so it runs live. inMemoryBlob stays
// because makeResearchProvidersLive's cached-scrape layer requires a blob store
// even though contact discovery never scrapes.
const contactsLive = ContactDiscovery.layer.pipe(
	Layer.provide(makeResearchProvidersLive),
	Layer.provide(inMemoryBlob),
	Layer.provide(FetchHttpClient.layer),
	Layer.provideMerge(SqlLive),
)

// Drive one company through discover_contacts and score the ranked contacts.
// Discovery runs synchronously (no create→poll loop the research eval needs), so
// this reads the paid spend straight off the anchor run discovery wrote.
const driveContactOne = (
	org: string,
	user: string,
	defaults: SystemDefaults,
	golden: ContactGoldenExpectation,
) =>
	Effect.gen(function* () {
		const discovery = yield* ContactDiscovery
		const outcome = yield* discovery.discover({
			companyName: golden.companyName,
			domain: golden.domain,
			country: golden.country,
			userId: user,
			organizationId: org,
			systemDefaults: defaults,
		})
		// Paid spend metered to this discovery, summed across the vendors it ran
		// (hunter-enrich, fullenrich-enrich, hunter-verify) — so a config that calls
		// two finders costs more than one that short-circuits. Runs under the CLI's
		// BYPASS-RLS role, so the org-scoped rows are readable by research_id.
		const sql = yield* SqlClient.SqlClient
		const spend = yield* sql<{ cents: number }>`
			SELECT COALESCE(SUM(amount_cents), 0)::int AS cents
			FROM research_paid_spend
			WHERE research_id = ${outcome.researchId}
		`
		const spendCents = spend[0]?.cents ?? 0
		return scoreContactRun(
			golden,
			outcomeFromContactRun(outcome, { spendCents }),
		)
	})

const formatContactCompany = (
	id: string,
	scores: ReadonlyArray<ContactRunScore>,
): string => {
	const total = scores.length
	const sum = (pick: (score: ContactRunScore) => number): number =>
		scores.reduce((acc, score) => acc + pick(score), 0)
	const expected = sum(score => score.contactsExpected)
	const matched = sum(score => score.contactsMatched)
	const deliverable = sum(score => score.deliverableReturned)
	const spend = sum(score => score.spendCents)
	const empty = scores.filter(score => score.empty).length
	const recall = expected === 0 ? 'n/a' : pct(matched / expected)
	return `${id.padEnd(20)} recall ${recall}  deliverable ${deliverable}  spend ${spend}¢  empty ${empty}/${total}`
}

const formatContactSummary = (summary: ContactEvalSummary): string =>
	[
		'',
		`Runs:                    ${summary.runs}`,
		`Contact recall:          ${pct(summary.contactRecall)}`,
		`Decision-maker recall:   ${pct(summary.decisionMakerRecall)}`,
		`Email precision:         ${pct(summary.emailPrecision)}`,
		`Empty rate:              ${pct(summary.emptyRate)}`,
		`Cost / verified contact: ${
			summary.costPerVerifiedContact === null
				? 'n/a'
				: `${summary.costPerVerifiedContact.toFixed(1)}¢`
		}`,
	].join('\n')

// The two opposite framings the invariance eval injects, hand-built so the
// check needs no instruction rows in the database. Each may steer WHERE the
// agent searches; neither may change the facts, the entity verdict, or the
// people — that is the invariant under test.
const FRAMING_A: ResolvedInstructions = {
	segments: [
		'Focus on small, family-run businesses; prefer local, independent companies.',
	],
	fingerprint: 'eval-invariance-a',
	templateIds: [],
	templateNames: ['eval-invariance-a'],
}
const FRAMING_B: ResolvedInstructions = {
	segments: [
		'Focus on large enterprises; prefer companies with hundreds of employees and several offices.',
	],
	fingerprint: 'eval-invariance-b',
	templateIds: [],
	templateNames: ['eval-invariance-b'],
}

// One framed run, adapted to the shape the comparator reads: scorable fields,
// the final entity verdict, and the named contacts.
const driveFramed = (
	org: string,
	user: string,
	defaults: SystemDefaults,
	golden: GoldenExpectation,
	schemaName: string,
	instructions: ResolvedInstructions,
) =>
	Effect.gen(function* () {
		const input: CreateResearchInput = {
			query: golden.query,
			schemaName,
			forceFresh: true,
		}
		const { run } = yield* createRunToTerminal(
			user,
			org,
			input,
			defaults,
			instructions,
			COMPANY_RUN_POLL_ATTEMPTS,
		)
		const outcome = outcomeFromRun({
			status: run?.status ?? 'failed',
			findings: run?.findings,
			schemaName,
			fetchedUrls: [],
		})
		// entity_match is a top-level run column (camelCased by the client), never
		// a key inside the findings JSON — read it from the run, not the findings.
		return {
			fields: outcome.fields,
			entityMatch: run?.entityMatch ?? null,
			contacts: outcome.contacts,
		} satisfies FramingOutcome
	})

export const researchEvalInvariance = (opts: {
	readonly org: string
	readonly user: string
	readonly goldenPath: string
	readonly schemaName: string
	readonly concurrency: number
}) =>
	Effect.gen(function* () {
		yield* requireLocalDatabase('research eval-invariance')
		// Drives the same live runs a profile pass does, so it needs the same parts
		// reachable — two wordings agreeing on canned data says nothing about either.
		yield* requireLiveProviders('research eval-invariance', {
			tiers: ['agent', 'extract'],
			capabilities: ['search', 'scrape'],
		})
		const raw = yield* Effect.tryPromise({
			try: () => readFile(fromRepoRoot(opts.goldenPath), 'utf8'),
			catch: error => new Error(`cannot read golden set: ${String(error)}`),
		})
		const rows = JSON.parse(raw) as ReadonlyArray<RawGoldenRow>
		const { golden, errors } = parseGoldenSet(rows)
		for (const bad of errors) {
			yield* Console.error(`skipped ${bad.id}: ${bad.error}`)
		}
		if (golden.length === 0) {
			return yield* Effect.fail(new Error('golden set has no valid rows'))
		}
		// This command asks whether two wordings of the same question reach the same
		// company, which a market request has no answer to — and it would spend two
		// live runs per row finding that out.
		yield* requireMarketSchema(golden, opts.schemaName)
		yield* Console.log(
			`Framing-invariance eval on ${golden.length} companies (2 runs each)…\n`,
		)
		const results = yield* Effect.gen(function* () {
			const defaults = yield* systemDefaults
			return yield* Effect.forEach(
				golden,
				company =>
					Effect.gen(function* () {
						const a = yield* driveFramed(
							opts.org,
							opts.user,
							defaults,
							company,
							opts.schemaName,
							FRAMING_A,
						)
						const b = yield* driveFramed(
							opts.org,
							opts.user,
							defaults,
							company,
							opts.schemaName,
							FRAMING_B,
						)
						return { id: company.id, comparison: compareFramings(a, b) }
					}).pipe(
						Effect.withSpan('research_eval_invariance.company', {
							attributes: { 'eval.company_id': company.id },
						}),
					),
				{ concurrency: opts.concurrency },
			)
		}).pipe(Effect.provide(researchLive))
		let broken = 0
		for (const { id, comparison } of results) {
			if (comparison.invariant) {
				yield* Console.log(`ok   ${id}: invariant holds`)
				continue
			}
			broken++
			const parts: string[] = []
			if (comparison.divergentFields.length > 0)
				parts.push(`fields: ${comparison.divergentFields.join(', ')}`)
			if (comparison.entityMatchDiverged) parts.push('entity verdict diverged')
			if (comparison.contactsOnlyInA.length > 0)
				parts.push(
					`only under framing A: ${comparison.contactsOnlyInA.join(', ')}`,
				)
			if (comparison.contactsOnlyInB.length > 0)
				parts.push(
					`only under framing B: ${comparison.contactsOnlyInB.join(', ')}`,
				)
			yield* Console.log(`LEAK ${id}: ${parts.join(' · ')}`)
		}
		yield* Console.log(
			`\n${results.length - broken}/${results.length} companies invariant under opposite framings`,
		)
		if (broken > 0)
			return yield* Effect.fail(
				new Error(`framing leaked into acceptance for ${broken} company(ies)`),
			)
	}).pipe(
		Effect.withSpan('research_eval_invariance.batch', {
			attributes: { 'eval.schema': opts.schemaName },
		}),
		Effect.provide(
			makeOtlpObservability({ serviceName: 'batuda-research-eval' }),
		),
	)

/**
 * Run the contact golden set through the live discover_contacts flow and report
 * recall / email precision / cost per verified contact. --enrich and
 * --enrich-mode pick the vendor chain and fallback-vs-union for the run, so the
 * same golden set can be scored under hunter, hunter+fullenrich, and union to
 * read the recall lift against the cost delta.
 */
export const researchEvalContacts = (opts: {
	readonly org: string
	readonly user: string
	readonly goldenPath: string
	readonly concurrency: number
	readonly runs: number
	readonly enrich: Option.Option<string>
	readonly enrichMode: Option.Option<string>
	readonly out: Option.Option<string>
}) =>
	Effect.gen(function* () {
		yield* requireLocalDatabase('research eval-contacts')
		// The --enrich / --enrich-mode flags need to reach the settings the
		// enrichment step reads. Those settings are captured from the environment
		// once, before this handler runs, so writing to process.env now would be
		// ignored. Instead the flag values become a top-priority settings source
		// that wins over the existing one, which still supplies everything else.
		const enrichOverrides: Record<string, string> = {}
		if (Option.isSome(opts.enrich)) {
			enrichOverrides['RESEARCH_PROVIDER_ENRICH'] = opts.enrich.value
		}
		if (Option.isSome(opts.enrichMode)) {
			enrichOverrides['RESEARCH_ENRICH_MODE'] = opts.enrichMode.value
		}
		const enrichSettings = ConfigProvider.layerAdd(
			ConfigProvider.fromEnv({ env: enrichOverrides }),
			{ asPrimary: true },
		)
		// Read through the same overridden settings the runs will use, or the check
		// would pass on an environment value the flag is about to replace. Contact
		// discovery never searches or scrapes — it works from a domain it is handed —
		// so only the enrichment it exists to measure is required here.
		yield* requireLiveProviders('research eval-contacts', {
			tiers: [],
			capabilities: ['enrich'],
		}).pipe(Effect.provide(enrichSettings))

		const raw = yield* Effect.tryPromise({
			try: () => readFile(fromRepoRoot(opts.goldenPath), 'utf8'),
			catch: error => new Error(`cannot read golden set: ${String(error)}`),
		})
		const rows = JSON.parse(raw) as ReadonlyArray<RawContactGoldenRow>
		const { golden, errors } = parseContactGoldenSet(rows)
		for (const bad of errors) {
			yield* Console.error(`skipped ${bad.id}: ${bad.error}`)
		}
		if (golden.length === 0) {
			return yield* Effect.fail(
				new Error('contact golden set has no valid rows'),
			)
		}
		const enrichLabel = Option.getOrElse(opts.enrich, () => '(env default)')
		const modeLabel = Option.getOrElse(opts.enrichMode, () => 'fallback')
		yield* Console.log(
			`Evaluating ${golden.length} companies (enrich=${enrichLabel}, mode=${modeLabel})…\n`,
		)
		yield* Effect.annotateCurrentSpan({
			'eval.enrich': enrichLabel,
			'eval.enrich_mode': modeLabel,
			'eval.companies': golden.length,
		})

		const scores = yield* Effect.gen(function* () {
			const defaults = yield* systemDefaults
			const tasks = golden.flatMap(company =>
				Array.from({ length: opts.runs }, () => company),
			)
			return yield* Effect.forEach(
				tasks,
				company =>
					driveContactOne(opts.org, opts.user, defaults, company).pipe(
						Effect.tap(score =>
							Effect.annotateCurrentSpan(contactEvalSpanAttributes(score)),
						),
						Effect.withSpan('research_eval_contacts.run', {
							attributes: {
								'eval.company_id': company.id,
								'eval.domain': company.domain,
							},
						}),
					),
				{ concurrency: opts.concurrency },
			)
		}).pipe(Effect.provide(contactsLive), Effect.provide(enrichSettings))

		for (const company of golden) {
			yield* Console.log(
				formatContactCompany(
					company.id,
					scores.filter(score => score.id === company.id),
				),
			)
		}

		const report = buildContactEvalReport(scores)
		yield* Console.log(formatContactSummary(report.summary))
		yield* Effect.annotateCurrentSpan(
			contactEvalSummaryAttributes(report.summary),
		)
		yield* Option.match(opts.out, {
			onNone: () => Effect.void,
			onSome: path =>
				Effect.tryPromise({
					try: () =>
						writeFile(fromRepoRoot(path), JSON.stringify(report, null, 2)),
					catch: error => new Error(`cannot write report: ${String(error)}`),
				}).pipe(
					Effect.tap(() =>
						Console.log(`\nReport written to ${fromRepoRoot(path)}`),
					),
				),
		})
	}).pipe(
		Effect.withSpan('research_eval_contacts.batch', {
			attributes: { 'eval.runs_per_company': opts.runs },
		}),
		Effect.provide(
			makeOtlpObservability({ serviceName: 'batuda-research-eval-contacts' }),
		),
	)

/**
 * Read or set what one company may spend at paid research vendors in a calendar
 * month, shared by everyone in it.
 *
 * A company with no figure of its own spends up to the one shipped in
 * configuration. Setting a figure here is how a company that needs more gets it;
 * the system ceiling still applies, so a company can never be given unlimited
 * spending by this alone.
 */
export const researchCap = (input: {
	readonly org: string
	readonly cents: number | undefined
}) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		if (input.cents === undefined) {
			const rows = yield* sql<{ paidMonthlyCapCents: number }>`
				SELECT paid_monthly_cap_cents
				FROM organization_research_policy
				WHERE organization_id = ${input.org}
			`
			const row = rows[0]
			yield* Console.log(
				row === undefined
					? `${input.org}: no figure set — spends up to the one shipped in configuration`
					: `${input.org}: ${row.paidMonthlyCapCents}¢ per month`,
			)
			return
		}
		yield* sql`
			INSERT INTO organization_research_policy (organization_id, paid_monthly_cap_cents, updated_at)
			VALUES (${input.org}, ${input.cents}, now())
			ON CONFLICT (organization_id) DO UPDATE SET
				paid_monthly_cap_cents = ${input.cents},
				updated_at = now()
		`
		yield* Console.log(`${input.org}: ${input.cents}¢ per month`)
		yield* Console.log(
			'The system ceiling still applies, so a higher figure than that is capped at it.',
		)
	}).pipe(Effect.provide(SqlLive))
