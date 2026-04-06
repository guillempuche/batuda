import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { Console, Effect } from 'effect'
import { Command, Flag, Prompt } from 'effect/unstable/cli'

import { dbMigrate, dbReset } from './commands/db'
import { doctor } from './commands/doctor'
import { seed, seedAuth, seedReset } from './commands/seed'
import { servicesDown, servicesStatus, servicesUp } from './commands/services'
import { setup } from './commands/setup'
import { withDb } from './db'

// ── Seed ───────────────────────────────────────────────────

const seedCommand = Command.make(
	'seed',
	{
		preset: Flag.choice('preset', ['minimal', 'full'] as const).pipe(
			Flag.withDescription(
				'Data preset: minimal (2 companies) or full (10 companies)',
			),
			Flag.withFallbackPrompt(
				Prompt.select({
					message: 'Which seed preset?',
					choices: [
						{
							title: 'minimal — 2 companies, enough to test MCP',
							value: 'minimal' as const,
						},
						{
							title: 'full — 10 companies, full CRM dataset',
							value: 'full' as const,
						},
					],
				}),
			),
		),
		reset: Flag.boolean('reset').pipe(
			Flag.withDescription('Truncate CRM tables before seeding'),
			Flag.withDefault(false),
		),
		auth: Flag.boolean('auth').pipe(
			Flag.withDescription('Create test auth user (dev@forja.cat)'),
			Flag.withDefault(false),
		),
	},
	({ preset, reset, auth }) =>
		withDb(
			Effect.gen(function* () {
				if (reset) yield* seedReset
				const counts = yield* seed(preset)
				if (auth) yield* seedAuth
				yield* Console.log(
					`Seeded (${preset}): ${counts.products} products, ${counts.companies} companies, ${counts.contacts} contacts, ${counts.interactions} interactions, ${counts.tasks} tasks, ${counts.documents} documents, ${counts.proposals} proposals, ${counts.pages} pages`,
				)
			}),
		),
).pipe(
	Command.withDescription(
		'Insert sample data (use `db reset` for clean slate)',
	),
)

// ── Setup ──────────────────────────────────────────────────

const setupCommand = Command.make('setup', {}, () =>
	Effect.gen(function* () {
		yield* Effect.logInfo('Setting up project...')
		const results = yield* setup
		for (const r of results) {
			yield* Console.log(`  ${r}`)
		}
		yield* Effect.logInfo('Setup complete.')
	}),
).pipe(Command.withDescription('Set up local environment (copy .env files)'))

// ── Doctor ─────────────────────────────────────────────────

const doctorCommand = Command.make('doctor', {}, () =>
	Effect.gen(function* () {
		const results = yield* doctor
		const maxLen = Math.max(...results.map(check => check.name.length))
		for (const check of results) {
			const icon =
				check.status === 'ok'
					? '\u2713'
					: check.status === 'warn'
						? '!'
						: '\u2717'
			yield* Console.log(
				`  ${icon} ${check.name.padEnd(maxLen)}  ${check.detail}`,
			)
		}
	}),
).pipe(Command.withDescription('Check local environment health'))

// ── DB ─────────────────────────────────────────────────────

const dbMigrateCommand = Command.make('migrate', {}, () => dbMigrate).pipe(
	Command.withDescription('Run database migrations'),
)

const dbResetCommand = Command.make('reset', {}, () => withDb(dbReset)).pipe(
	Command.withDescription('Truncate all tables, re-migrate, and re-seed'),
)

const dbCommand = Command.make('db').pipe(
	Command.withDescription('Database management'),
	Command.withSubcommands([dbMigrateCommand, dbResetCommand]),
)

// ── Services ───────────────────────────────────────────────

const servicesUpCommand = Command.make('up', {}, () =>
	Effect.gen(function* () {
		yield* Effect.logInfo('Starting services...')
		yield* servicesUp
	}),
).pipe(Command.withDescription('Start local Docker services'))

const servicesDownCommand = Command.make('down', {}, () =>
	Effect.gen(function* () {
		yield* Effect.logInfo('Stopping services...')
		yield* servicesDown
	}),
).pipe(Command.withDescription('Stop local Docker services'))

const servicesStatusCommand = Command.make(
	'status',
	{},
	() => servicesStatus,
).pipe(Command.withDescription('Show Docker services status'))

const servicesCommand = Command.make('services').pipe(
	Command.withDescription('Manage local Docker services'),
	Command.withSubcommands([
		servicesUpCommand,
		servicesDownCommand,
		servicesStatusCommand,
	]),
)

// ── Root ───────────────────────────────────────────────────

const engranatge = Command.make('engranatge').pipe(
	Command.withDescription('Engranatge CLI'),
	Command.withSubcommands([
		setupCommand,
		doctorCommand,
		seedCommand,
		dbCommand,
		servicesCommand,
	]),
)

// ── Run ────────────────────────────────────────────────────

// pnpm injects '--' between script command and user args.
// Strip it so Effect CLI parses subcommands correctly
// and `pnpm cli doctor` works without manual `--`.
const dashIdx = process.argv.indexOf('--')
if (dashIdx !== -1) process.argv.splice(dashIdx, 1)

// Config services are resolved from process.env at runtime by NodeRuntime
const program = Command.run(engranatge, { version: '0.0.1' }).pipe(
	Effect.provide(NodeServices.layer),
	Effect.tapError(e =>
		Console.error(e instanceof Error ? e.message : String(e)),
	),
)
NodeRuntime.runMain(program as unknown as Effect.Effect<void, unknown, never>, {
	disableErrorReporting: true,
})
