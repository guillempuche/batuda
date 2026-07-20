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
	contactEvalSpanAttributes,
	contactEvalSummaryAttributes,
	type EvalSummary,
	evalSpanAttributes,
	evalSummaryAttributes,
	type GoldenExpectation,
	type ModelProbeResult,
	makeResearchLlmLive,
	makeResearchProvidersLive,
	outcomeFromContactRun,
	outcomeFromRun,
	parseContactGoldenSet,
	parseGoldenSet,
	probeModelCapabilities,
	type RawContactGoldenRow,
	type RawGoldenRow,
	ResearchEventSink,
	ResearchService,
	type RunScore,
	researchToolkitWireFormat,
	type SystemDefaults,
	scoreContactRun,
	scoreRun,
} from '@batuda/research'

import { SqlLive } from '../db'

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
 * The API key defaults to the agent tier's key so it reuses the research setup.
 *
 * It probes with the real research tools, so a pass means the model accepts what a
 * run would actually send it.
 */
export const researchProbe = (opts: {
	readonly baseUrl: string
	readonly apiKey: Option.Option<Redacted.Redacted<string>>
	readonly models: ReadonlyArray<string>
}) =>
	Effect.gen(function* () {
		const apiKey = yield* Option.match(opts.apiKey, {
			onSome: key => Effect.succeed(key),
			onNone: () => Config.redacted('RESEARCH_LLM_AGENT_API_KEY'),
		})
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

// ── eval ───────────────────────────────────────────────────

// Scrape-content cache for one eval process. With forceFresh runs there is
// nothing to reuse across companies, so an in-memory map is both enough and
// correct — it keeps each run isolated and never persists between processes.
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
				: Effect.die(new Error(`blob not found: ${key}`))
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

const TERMINAL = new Set([
	'succeeded',
	'failed',
	'cancelled',
	'no_reliable_data',
])

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
			if (TERMINAL.has(run?.status ?? 'unknown')) return run
			yield* Effect.sleep('1 second')
		}
		return run
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
		const svc = yield* ResearchService
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
		const created = yield* svc.create(user, org, input, defaults)
		// A single-subject eval never fans out, so it always carries a run id;
		// rule out the confirm-required variant to keep the type honest.
		if (created.status === 'confirm_required')
			return yield* Effect.die(new Error('eval run should not fan out'))
		// A deep run does several search/scrape/LLM rounds, so allow up to ~15
		// minutes to finish (900 one-second polls) before reporting its last status.
		const run = yield* pollToTerminal(created.id, 900)
		// Grounding is judged by the pages the run reached, so pull its fetched
		// source URLs — per-field citations may point at third-party fact-sources.
		const sql = yield* SqlClient.SqlClient
		const sourceRows = yield* sql<{ url: string }>`
			SELECT DISTINCT s.url
			FROM research_run_sources rs JOIN sources s ON s.id = rs.source_id
			WHERE rs.research_id = ${created.id}
		`
		const outcome = outcomeFromRun({
			status: run?.status ?? 'failed',
			findings: run?.findings,
			fetchedUrls: sourceRows.map(row => row.url),
		})
		return scoreRun(golden, outcome)
	})

// Aggregate a company's repeated runs into shares (grounded 3/5, …). Per-run
// grounding is noisy, so the fraction across runs is the trustworthy signal.
const formatCompanyRuns = (
	id: string,
	scores: ReadonlyArray<RunScore>,
): string => {
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

const formatSummary = (summary: EvalSummary): string =>
	[
		'',
		`Runs:                   ${summary.runs}`,
		`Grounding accuracy:     ${pct(summary.groundingAccuracy)}`,
		`Field precision:        ${pct(summary.fieldPrecision)}`,
		`Field recall:           ${pct(summary.fieldRecall)}`,
		`Titled-contact recall:  ${pct(summary.contactRecall)}`,
		`Wrong-company rate:     ${pct(summary.wrongCompanyRate)}`,
		`Empty rate:             ${pct(summary.emptyRate)}`,
	].join('\n')

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
					)}  wrong ${pct(s.wrongCompanyRate)}  empty ${pct(s.emptyRate)}`,
			),
	].join('\n')

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
		yield* Console.log(`Evaluating ${golden.length} companies…\n`)

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
			// Each company runs `runs` times: per-run grounding is noisy, so averaging
			// several runs is what makes the reported rates trustworthy. The service
			// caps how many execute at once, so this just stops runs waiting in line.
			const tasks = golden.flatMap(company =>
				Array.from({ length: opts.runs }, () => company),
			)
			return yield* Effect.forEach(
				tasks,
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
								'eval.agent_model': agentModel,
								'eval.extract_model': extractModel,
							},
						}),
					),
				{ concurrency: opts.concurrency },
			)
		}).pipe(Effect.provide(researchLive))

		for (const company of golden) {
			yield* Console.log(
				formatCompanyRuns(
					company.id,
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
		}).pipe(
			Effect.provide(contactsLive),
			Effect.provide(
				ConfigProvider.layerAdd(
					ConfigProvider.fromEnv({ env: enrichOverrides }),
					{ asPrimary: true },
				),
			),
		)

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
