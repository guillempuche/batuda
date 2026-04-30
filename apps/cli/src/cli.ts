import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { Console, Effect, Option, Redacted } from 'effect'
import { Command, Flag, Prompt } from 'effect/unstable/cli'

import { authCreateKey } from './commands/auth'
import { authBootstrap } from './commands/auth-bootstrap'
import { authBootstrapOrg } from './commands/auth-bootstrap-org'
import { authInvite } from './commands/auth-invite'
import { authInviteAdmin } from './commands/auth-invite-admin'
import { authListKeys } from './commands/auth-list-keys'
import { authListUsers } from './commands/auth-list-users'
import { authPromote } from './commands/auth-promote'
import { authResetPassword } from './commands/auth-reset-password'
import { authRevokeKey } from './commands/auth-revoke-key'
import { authSessions } from './commands/auth-sessions'
import { calendarSeed } from './commands/calendar/seed'
import {
	calendarSimulateWebhook,
	SIMULATE_TRIGGERS,
} from './commands/calendar/simulate-webhook'
import { dbMigrate, dbReset } from './commands/db'
import { doctor } from './commands/doctor'
import { seed, seedIdentities } from './commands/seed'
import { servicesDown, servicesStatus, servicesUp } from './commands/services'
import { appendEnvKeys, resetEnvFile, setup } from './commands/setup'
import { withDb } from './db'
import { loadEnv } from './lib/load-env'
import { recoveryHint } from './lib/recovery-hint'

// ── Seed ───────────────────────────────────────────────────

const seedCommand = Command.make(
	'seed',
	{
		preset: Flag.choice('preset', ['minimal', 'full'] as const).pipe(
			Flag.withDescription(
				'Data preset: minimal (2 companies) or full (10 companies)',
			),
			Flag.withDefault('full' as const),
		),
	},
	({ preset }) =>
		withDb(
			Effect.gen(function* () {
				yield* seedIdentities
				const counts = yield* seed(preset)
				yield* Console.log('')
				yield* Console.log(
					`Seeded (${preset}): ${counts.products} products, ${counts.companies} companies, ${counts.contacts} contacts, ${counts.interactions} interactions, ${counts.tasks} tasks, ${counts.documents} documents, ${counts.proposals} proposals, ${counts.pages} pages, ${counts.callRecordings} call recordings`,
				)
				yield* Console.log('')
				yield* Console.log('─── Access hints ───────────────────────────────')
				yield* Console.log(
					'  API server:   pnpm dev:server   → https://api.batuda.localhost',
				)
				yield* Console.log(
					'  Batuda web:    pnpm dev:internal → https://batuda.localhost',
				)
				yield* Console.log('')
				yield* Console.log(
					'  API docs (Scalar): https://api.batuda.localhost/docs',
				)
				yield* Console.log(
					'  OpenAPI spec:      https://api.batuda.localhost/openapi.json',
				)
				yield* Console.log(
					'  Auth docs:         https://api.batuda.localhost/auth/reference',
				)
				yield* Console.log(
					'  Auth OpenAPI:      https://api.batuda.localhost/auth/open-api/generate-schema',
				)
				yield* Console.log('')
				yield* Console.log(
					'  Health check:    curl https://api.batuda.localhost/health',
				)
				yield* Console.log(
					'  List companies:  curl https://api.batuda.localhost/v1/companies',
				)
				yield* Console.log(
					'  Docker DB:       docker exec -it batuda-db psql -U batuda',
				)
				yield* Console.log('────────────────────────────────────────────────')
			}),
		),
).pipe(
	Command.withDescription(
		'Insert sample data (use `db reset` for clean slate)',
	),
)

// ── Setup ──────────────────────────────────────────────────

const setupCommand = Command.make(
	'setup',
	{
		update: Flag.boolean('update').pipe(
			Flag.withDescription('Append missing .env keys from .env.example'),
			Flag.withDefault(false),
		),
		reset: Flag.boolean('reset').pipe(
			Flag.withDescription('Replace .env files entirely from .env.example'),
			Flag.withDefault(false),
		),
	},
	({ update, reset }) =>
		Effect.gen(function* () {
			yield* Effect.logInfo('Setting up project...')
			const results = yield* setup
			for (const result of results) {
				if (result.status === 'skipped') {
					yield* Console.log(`  skip ${result.target} (no ${result.example})`)
					continue
				}
				if (reset && result.status !== 'created') {
					yield* resetEnvFile(result.example, result.target)
					yield* Console.log(
						`  ${result.target} replaced from ${result.example}`,
					)
					continue
				}
				switch (result.status) {
					case 'created':
						yield* Console.log(`  created ${result.target}`)
						break
					case 'up-to-date':
						yield* Console.log(`  ${result.target} up to date`)
						break
					case 'stale': {
						yield* Console.log(
							`  ${result.target} has ${result.missing.length} missing key(s):`,
						)
						for (const e of result.missing) {
							yield* Console.log(`    ${e.key}`)
						}
						if (update) {
							yield* appendEnvKeys(result.target, result.missing)
							yield* Console.log(`  → appended ${result.missing.length} key(s)`)
						} else {
							yield* Console.log(
								`  → run with --update to append or --reset to replace`,
							)
						}
						break
					}
				}
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

// ── Auth ───────────────────────────────────────────────────

const authCreateKeyCommand = Command.make(
	'create-key',
	{
		email: Flag.string('email').pipe(
			Flag.withDescription('User email that will own the key'),
			Flag.withDefault('dev@batuda.co'),
		),
		name: Flag.string('name').pipe(
			Flag.withDescription('Key name (used for listing/revoking later)'),
			Flag.withDefault('local-dev'),
		),
		prefix: Flag.string('prefix').pipe(
			Flag.withDescription('Plaintext prefix shown on every generated key'),
			Flag.withDefault('batuda_'),
		),
		expiresIn: Flag.integer('expires-in').pipe(
			Flag.withDescription('Expiration in seconds (omit for no expiry)'),
			Flag.optional,
		),
	},
	({ email, name, prefix, expiresIn }) =>
		authCreateKey({
			email,
			name,
			prefix,
			expiresIn: Option.getOrUndefined(expiresIn),
		}),
).pipe(
	Command.withDescription(
		'Create a Better Auth API key for a user (local dev signup bypass)',
	),
)

const authBootstrapCommand = Command.make(
	'bootstrap',
	{
		email: Flag.string('email').pipe(
			Flag.withDescription('Admin email address'),
			Flag.withFallbackPrompt(Prompt.text({ message: 'Admin email:' })),
		),
		name: Flag.string('name').pipe(
			Flag.withDescription('Admin display name'),
			Flag.withFallbackPrompt(Prompt.text({ message: 'Admin name:' })),
		),
		password: Flag.redacted('password').pipe(
			Flag.withDescription('Admin password (prompted if omitted)'),
			Flag.withFallbackPrompt(Prompt.hidden({ message: 'Admin password:' })),
		),
	},
	({ email, name, password }) =>
		authBootstrap({
			email,
			name,
			password: Redacted.value(password),
		}),
).pipe(
	Command.withDescription(
		'Create the first admin user (refuses if any user already exists)',
	),
)

const authInviteCommand = Command.make(
	'invite',
	{
		email: Flag.string('email').pipe(
			Flag.withDescription('Email address of the user to invite'),
			Flag.withFallbackPrompt(Prompt.text({ message: 'Invitee email:' })),
		),
		name: Flag.string('name').pipe(
			Flag.withDescription('Display name'),
			Flag.withFallbackPrompt(Prompt.text({ message: 'Invitee name:' })),
		),
		role: Flag.choice('role', ['admin', 'user'] as const).pipe(
			Flag.withDescription('Role to grant'),
			Flag.withDefault('user' as const),
		),
	},
	({ email, name, role }) => authInvite({ email, name, role }),
).pipe(
	Command.withDescription(
		'Create a passwordless user and issue a magic link (local prints the URL)',
	),
)

const authBootstrapOrgCommand = Command.make(
	'bootstrap-org',
	{
		email: Flag.string('email').pipe(
			Flag.withDescription('Admin email address'),
			Flag.withFallbackPrompt(Prompt.text({ message: 'Admin email:' })),
		),
		name: Flag.string('name').pipe(
			Flag.withDescription('Admin display name'),
			Flag.withFallbackPrompt(Prompt.text({ message: 'Admin name:' })),
		),
		password: Flag.redacted('password').pipe(
			Flag.withDescription('Admin password (prompted if omitted)'),
			Flag.withFallbackPrompt(Prompt.hidden({ message: 'Admin password:' })),
		),
		orgName: Flag.string('org-name').pipe(
			Flag.withDescription('Organization display name'),
			Flag.withFallbackPrompt(Prompt.text({ message: 'Organization name:' })),
		),
		orgSlug: Flag.string('org-slug').pipe(
			Flag.withDescription('Organization URL slug (lowercase, kebab-case)'),
			Flag.withFallbackPrompt(Prompt.text({ message: 'Organization slug:' })),
		),
	},
	({ email, name, password, orgName, orgSlug }) =>
		authBootstrapOrg({
			email,
			name,
			password: Redacted.value(password),
			orgName,
			orgSlug,
		}),
).pipe(
	Command.withDescription(
		'Create the first admin and their organization (refuses if any user exists)',
	),
)

const authInviteAdminCommand = Command.make(
	'invite-admin',
	{
		email: Flag.string('email').pipe(
			Flag.withDescription('Email address of the admin to invite'),
			Flag.withFallbackPrompt(Prompt.text({ message: 'Admin email:' })),
		),
		name: Flag.string('name').pipe(
			Flag.withDescription('Display name'),
			Flag.withFallbackPrompt(Prompt.text({ message: 'Admin name:' })),
		),
		orgName: Flag.string('org-name').pipe(
			Flag.withDescription('Organization display name'),
			Flag.withFallbackPrompt(Prompt.text({ message: 'Organization name:' })),
		),
		orgSlug: Flag.string('org-slug').pipe(
			Flag.withDescription('Organization URL slug (lowercase, kebab-case)'),
			Flag.withFallbackPrompt(Prompt.text({ message: 'Organization slug:' })),
		),
		allowExistingOrg: Flag.boolean('allow-existing-org').pipe(
			Flag.withDescription(
				'Reuse an existing org with this slug; otherwise the command aborts',
			),
			Flag.withDefault(false),
		),
	},
	({ email, name, orgName, orgSlug, allowExistingOrg }) =>
		authInviteAdmin({
			email,
			name,
			orgName,
			orgSlug,
			allowExistingOrg,
		}),
).pipe(
	Command.withDescription(
		'Create-or-find org, create-or-find user, attach as admin, send magic link',
	),
)

const authListUsersCommand = Command.make(
	'list-users',
	{},
	() => authListUsers,
).pipe(Command.withDescription('List every user in the auth database'))

const authListKeysCommand = Command.make(
	'list-keys',
	{
		email: Flag.string('email').pipe(
			Flag.withDescription('Scope the listing to a single user'),
			Flag.optional,
		),
	},
	({ email }) => authListKeys({ email: Option.getOrUndefined(email) }),
).pipe(Command.withDescription('List API keys (all, or filtered by --email)'))

const authPromoteCommand = Command.make(
	'promote',
	{
		email: Flag.string('email').pipe(
			Flag.withDescription('User to promote'),
			Flag.withFallbackPrompt(Prompt.text({ message: 'Email:' })),
		),
		role: Flag.choice('role', ['admin', 'user'] as const).pipe(
			Flag.withDescription('Target role'),
			Flag.withDefault('admin' as const),
		),
	},
	({ email, role }) => authPromote({ email, role }),
).pipe(Command.withDescription("Change a user's role (admin|user)"))

const authDemoteCommand = Command.make(
	'demote',
	{
		email: Flag.string('email').pipe(
			Flag.withDescription('User to demote'),
			Flag.withFallbackPrompt(Prompt.text({ message: 'Email:' })),
		),
	},
	({ email }) => authPromote({ email, role: 'user' }),
).pipe(
	Command.withDescription(
		"Set a user's role to 'user' (alias for promote --role user)",
	),
)

const authRevokeKeyCommand = Command.make(
	'revoke-key',
	{
		keyId: Flag.string('key-id').pipe(
			Flag.withDescription('The id of the API key to revoke'),
			Flag.withFallbackPrompt(Prompt.text({ message: 'Key id:' })),
		),
	},
	({ keyId }) => authRevokeKey({ keyId }),
).pipe(Command.withDescription('Disable an API key (enabled=false)'))

const authResetPasswordCommand = Command.make(
	'reset-password',
	{
		email: Flag.string('email').pipe(
			Flag.withDescription('User whose password to reset'),
			Flag.withFallbackPrompt(Prompt.text({ message: 'Email:' })),
		),
		password: Flag.redacted('password').pipe(
			Flag.withDescription('New password (prompted if omitted)'),
			Flag.withFallbackPrompt(Prompt.hidden({ message: 'New password:' })),
		),
	},
	({ email, password }) =>
		authResetPassword({ email, password: Redacted.value(password) }),
).pipe(
	Command.withDescription("Overwrite a user's credential in the account table"),
)

const authSessionsCommand = Command.make(
	'sessions',
	{
		email: Flag.string('email').pipe(
			Flag.withDescription('Scope the listing to a single user'),
			Flag.optional,
		),
	},
	({ email }) => authSessions({ email: Option.getOrUndefined(email) }),
).pipe(
	Command.withDescription('List active sessions (all, or filtered by --email)'),
)

const authCommand = Command.make('auth').pipe(
	Command.withDescription('Better Auth utilities'),
	Command.withSubcommands([
		authBootstrapCommand,
		authBootstrapOrgCommand,
		authInviteCommand,
		authInviteAdminCommand,
		authListUsersCommand,
		authListKeysCommand,
		authCreateKeyCommand,
		authPromoteCommand,
		authDemoteCommand,
		authRevokeKeyCommand,
		authResetPasswordCommand,
		authSessionsCommand,
	]),
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

// ── Calendar ───────────────────────────────────────────────

const calendarSeedCommand = Command.make('seed', {}, () =>
	withDb(calendarSeed),
).pipe(
	Command.withDescription(
		'Seed default calendar_event_types (idempotent; respects CALENDAR_PROVIDER)',
	),
)

const calendarSimulateWebhookCommand = Command.make(
	'simulate-webhook',
	{
		trigger: Flag.choice('trigger', SIMULATE_TRIGGERS).pipe(
			Flag.withDescription('Cal.com webhook trigger to simulate'),
			Flag.withDefault('BOOKING_CREATED' as const),
		),
		url: Flag.string('url').pipe(
			Flag.withDescription('Target webhook URL'),
			Flag.withDefault('http://localhost:3010/webhooks/calcom'),
		),
		icalUid: Flag.string('ical-uid').pipe(
			Flag.withDescription(
				'Override the iCalUID (handy to chain CREATED → CANCELLED on the same row)',
			),
			Flag.optional,
		),
	},
	({ trigger, url, icalUid }) =>
		calendarSimulateWebhook({
			trigger,
			url,
			icalUid: Option.getOrUndefined(icalUid) ?? null,
		}),
).pipe(
	Command.withDescription(
		'Post a signed cal.com webhook envelope to the local server (no cal.com account needed)',
	),
)

const calendarCommand = Command.make('calendar').pipe(
	Command.withDescription('Calendar: seed event types, simulate webhooks'),
	Command.withSubcommands([
		calendarSeedCommand,
		calendarSimulateWebhookCommand,
	]),
)

// ── Root ───────────────────────────────────────────────────

const batuda = Command.make('batuda').pipe(
	Command.withDescription('Batuda CLI'),
	Command.withSubcommands([
		setupCommand,
		doctorCommand,
		seedCommand,
		dbCommand,
		authCommand,
		servicesCommand,
		calendarCommand,
	]),
)

// ── Run ────────────────────────────────────────────────────

// Parse `--env local|cloud` (default local), strip the flag + pnpm's `--`
// separator, and populate process.env via dotenv BEFORE Effect Config
// resolves any variable. Every subsequent `Config.redacted('DATABASE_URL')`
// / `Config.string(...)` read hits a fully-loaded process.env.
loadEnv()

// Format tagged errors as `Tag(field=…)`. `Schema.TaggedErrorClass` instances
// extend the native `Error`, so schema fields that collide with built-ins
// (`message`) land as non-enumerable own properties — `Object.entries` drops
// them. `core.Error#toJSON` exposes the original construction args through a
// `plainArgs` symbol, so we prefer that when available.
const formatError = (e: unknown): string => {
	if (e && typeof e === 'object' && '_tag' in e) {
		const tag = String((e as { _tag: unknown })._tag)
		const withJson = e as { toJSON?: () => unknown }
		const raw =
			typeof withJson.toJSON === 'function'
				? (withJson.toJSON() as Record<string, unknown>)
				: (e as Record<string, unknown>)
		const fields = Object.entries(raw)
			.filter(([k]) => k !== '_tag' && !k.startsWith('_'))
			.map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
			.join(', ')
		return fields ? `${tag}(${fields})` : tag
	}
	if (e instanceof Error) return e.message
	return String(e)
}

const program = Command.run(batuda, { version: '0.0.1' }).pipe(
	Effect.provide(NodeServices.layer),
	Effect.tapError(e => {
		const hint = recoveryHint(e)
		if (hint) {
			const tag =
				e && typeof e === 'object' && '_tag' in e
					? String((e as { _tag: unknown })._tag)
					: undefined
			const short = tag ?? (e instanceof Error ? e.message : String(e))
			return Console.error(`${short}\n\n  Hint: ${hint}`)
		}
		return Console.error(formatError(e))
	}),
)
NodeRuntime.runMain(program as unknown as Effect.Effect<void, unknown, never>, {
	disableErrorReporting: true,
})
