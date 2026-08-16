import { fileURLToPath } from 'node:url'

import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { Console, Data, Effect, Option, Redacted } from 'effect'
import { Argument, Command, Flag, Prompt } from 'effect/unstable/cli'

import { isLangCode, LANG_CODES, type LangCode } from '@batuda/domain'

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
import { companiesBackfillGeocode } from './commands/companies'
import { dataInspect, ENTITY_NAMES } from './commands/data'
import { dbMigrate, dbReset } from './commands/db'
import { doctor } from './commands/doctor'
import { emailBackfillBodies, emailInject } from './commands/email'
import {
	researchCap,
	researchEval,
	researchEvalContacts,
	researchEvalInvariance,
	researchProbe,
	researchProbeConfig,
} from './commands/research'
import { seed, seedIdentities } from './commands/seed'
import { servicesDown, servicesStatus, servicesUp } from './commands/services'
import type { EnvFileResult } from './commands/setup'
import { setup } from './commands/setup'
import {
	accessUrls,
	worktreeDoctor,
	worktreeDone,
	worktreeDown,
	worktreeLs,
	worktreePrune,
	worktreeUp,
	worktreeWatch,
} from './commands/worktree'
import { withDb } from './db'
import { requireLocalDatabase } from './lib/confirm-cloud'
import { appendEnvKeys, resetEnvFile } from './lib/env-file'
import { loadEnv } from './lib/load-env'
import { emailClear } from './lib/mail-catcher'
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
		quiet: Flag.boolean('quiet').pipe(
			Flag.withDescription(
				'Skip the dev-server access hints — for seeding a disposable integration DB, where nothing is being served',
			),
			Flag.withDefault(false),
		),
	},
	({ preset, quiet }) =>
		// Ahead of `withDb` so the check lands before `seedIdentities` writes
		// its first user, not between that and the rest of the seed.
		Effect.andThen(
			requireLocalDatabase('seed'),
			withDb(
				Effect.gen(function* () {
					yield* seedIdentities
					const counts = yield* seed(preset)
					yield* Console.log('')
					yield* Console.log(
						`Seeded (${preset}): ${counts.products} products, ${counts.companies} companies, ${counts.contacts} contacts, ${counts.interactions} interactions, ${counts.tasks} tasks, ${counts.documents} documents, ${counts.proposals} proposals, ${counts.pages} pages, ${counts.callRecordings} call recordings`,
					)
					// These hints would name the dev server — which serves the dev DB, not the
					// integration DB just seeded — so skip them for a disposable integration DB.
					if (quiet) return
					// Hosts follow this checkout: bare batuda.localhost in the main
					// checkout, <label>.batuda.localhost inside a worktree — so the hints
					// name the URL actually being served, not main's.
					const { web, api } = yield* accessUrls
					yield* Console.log('')
					yield* Console.log('─── Access hints ───────────────────────────────')
					yield* Console.log(`  API server:   pnpm dev:server   → ${api}`)
					yield* Console.log(`  Batuda web:    pnpm dev:internal → ${web}`)
					yield* Console.log('')
					yield* Console.log(`  API docs (Scalar): ${api}/docs`)
					yield* Console.log(`  OpenAPI spec:      ${api}/openapi.json`)
					yield* Console.log(`  Auth docs:         ${api}/auth/reference`)
					yield* Console.log(
						`  Auth OpenAPI:      ${api}/auth/open-api/generate-schema`,
					)
					yield* Console.log('')
					yield* Console.log(`  Health check:    curl ${api}/health`)
					yield* Console.log(`  List companies:  curl ${api}/v1/companies`)
					yield* Console.log(
						'  Docker DB:       docker exec -it batuda-db psql -U batuda',
					)
					yield* Console.log('────────────────────────────────────────────────')
				}),
			),
		),
).pipe(
	Command.withShortDescription('Insert sample data'),
	Command.withDescription(
		'Insert sample data (chain `pnpm cli db reset && pnpm cli seed` for a clean slate)',
	),
)

// ── Setup ──────────────────────────────────────────────────

// The db/bucket names a worktree-managed result actually carries — only the
// keys that file receives (e.g. `apps/cli/.env` never gets a bucket).
const worktreeIdentity = (result: EnvFileResult): string =>
	[result.worktree?.db, result.worktree?.bucket].filter(Boolean).join(' / ')

const setupCommand = Command.make(
	'setup',
	{
		update: Flag.boolean('update').pipe(
			Flag.withDescription(
				'Append missing .env keys from .env.example (no effect on the worktree-managed .env/apps/cli/.env)',
			),
			Flag.withDefault(false),
		),
		reset: Flag.boolean('reset').pipe(
			Flag.withDescription(
				'Replace .env files entirely from .env.example (no effect on the worktree-managed .env/apps/cli/.env)',
			),
			Flag.withDefault(false),
		),
	},
	({ update, reset }) =>
		Effect.gen(function* () {
			yield* Effect.logInfo('Setting up project...')
			const results = yield* setup
			for (const result of results) {
				// Per-worktree overrides: never templated, never reset from the
				// example — `--update`/`--reset` don't apply to these two files.
				if (result.status === 'worktree-synced') {
					yield* Console.log(
						`  ${result.target} → ${worktreeIdentity(result)} (this worktree)`,
					)
					continue
				}
				if (result.status === 'worktree-unprovisioned') {
					yield* Console.log(
						`  ${result.target}: ${worktreeIdentity(result)} not provisioned yet → run \`pnpm cli worktree up\``,
					)
					continue
				}
				if (result.status === 'worktree-error') {
					yield* Console.log(
						`  ${result.target}: couldn't sync from this worktree's data — ${result.error}`,
					)
					continue
				}
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
).pipe(
	Command.withShortDescription('Copy .env templates into place'),
	Command.withDescription(
		'Set up local environment (copy .env files). Inside a linked worktree, ' +
			'`.env` and `apps/cli/.env` are instead repaired from that worktree’s ' +
			'own database/bucket if already provisioned, or left alone with a hint ' +
			'to run `pnpm cli worktree up` — this command never creates a database ' +
			'or bucket.',
	),
)

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

// The check sits outside `withDb` on purpose: providing the SQL layer opens the
// connection, so checking inside would already be talking to the database.
const dbResetCommand = Command.make('reset', {}, () =>
	Effect.andThen(requireLocalDatabase('db reset'), withDb(dbReset)),
).pipe(
	Command.withShortDescription('Drop schema + re-run migrations'),
	Command.withDescription(
		'Drop the public schema and re-run migrations (no seed; chain `seed` for sample data). Leaves the mail catcher alone — it is shared with every checkout; empty it with `email clear` if you mean to',
	),
)

const dbCommand = Command.make('db').pipe(
	Command.withDescription('Database management'),
	Command.withSubcommands([dbMigrateCommand, dbResetCommand]),
)

// ── Auth ───────────────────────────────────────────────────

// Shared by every auth command that writes, so a script or agent can run them
// without a terminal to answer the confirm.
const confirmHostFlag = Flag.string('confirm-host').pipe(
	Flag.withDescription(
		'Database host this command should run against (e.g. the value shown by `doctor --env cloud`). Replaces the interactive confirm; refuses if it disagrees with DATABASE_URL',
	),
	Flag.optional,
)

export class InvalidLocale extends Data.TaggedError('InvalidLocale')<{
	readonly value: string
}> {}

// The language the new account reads in. Validated here because the list of
// languages lives in the domain package, which `@batuda/auth` deliberately
// does not depend on — so this edge is the last place that can check it.
const localeFlag = Flag.string('locale').pipe(
	Flag.withDescription(
		`Language for their email and first sign-in (${LANG_CODES.join(' | ')}). Omitted leaves it unset.`,
	),
	Flag.optional,
)

const readLocaleFlag = (
	flag: Option.Option<string>,
): Effect.Effect<LangCode | undefined, InvalidLocale> => {
	const value = Option.getOrUndefined(flag)
	if (value === undefined) return Effect.succeed(undefined)
	if (isLangCode(value)) return Effect.succeed(value)
	// Say what would have worked. The tagged error alone shows the rejected
	// value but not the alternatives, which is the part the caller needs.
	return Console.error(
		`Unknown language '${value}'. Valid values: ${LANG_CODES.join(', ')}.`,
	).pipe(Effect.andThen(Effect.fail(new InvalidLocale({ value }))))
}

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
		confirmHost: confirmHostFlag,
	},
	({ email, name, prefix, expiresIn, confirmHost }) =>
		authCreateKey({
			email,
			name,
			prefix,
			expiresIn: Option.getOrUndefined(expiresIn),
			confirmHost: Option.getOrUndefined(confirmHost),
		}),
).pipe(
	Command.withShortDescription('Create an API key for a user'),
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
		confirmHost: confirmHostFlag,
	},
	({ email, name, password, confirmHost }) =>
		authBootstrap({
			email,
			name,
			password: Redacted.value(password),
			confirmHost: Option.getOrUndefined(confirmHost),
		}),
).pipe(
	Command.withShortDescription('Create the first admin user'),
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
		locale: localeFlag,
		confirmHost: confirmHostFlag,
	},
	({ email, name, role, locale, confirmHost }) =>
		Effect.gen(function* () {
			const validated = yield* readLocaleFlag(locale)
			return yield* authInvite({
				email,
				name,
				role,
				locale: validated,
				confirmHost: Option.getOrUndefined(confirmHost),
			})
		}),
).pipe(
	Command.withShortDescription('Create a passwordless user + magic link'),
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
		confirmHost: confirmHostFlag,
	},
	({ email, name, password, orgName, orgSlug, confirmHost }) =>
		authBootstrapOrg({
			email,
			name,
			password: Redacted.value(password),
			orgName,
			orgSlug,
			confirmHost: Option.getOrUndefined(confirmHost),
		}),
).pipe(
	Command.withShortDescription('Create the first admin and their org'),
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
		locale: localeFlag,
		confirmHost: confirmHostFlag,
	},
	({ email, name, orgName, orgSlug, allowExistingOrg, locale, confirmHost }) =>
		Effect.gen(function* () {
			const validated = yield* readLocaleFlag(locale)
			return yield* authInviteAdmin({
				email,
				name,
				orgName,
				orgSlug,
				allowExistingOrg,
				locale: validated,
				confirmHost: Option.getOrUndefined(confirmHost),
			})
		}),
).pipe(
	Command.withShortDescription('Create an org and its first admin'),
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
).pipe(
	Command.withShortDescription('List API keys'),
	Command.withDescription('List API keys (all, or filtered by --email)'),
)

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
		confirmHost: confirmHostFlag,
	},
	({ email, role, confirmHost }) =>
		authPromote({
			email,
			role,
			confirmHost: Option.getOrUndefined(confirmHost),
		}),
).pipe(
	Command.withShortDescription("Set a user's platform role"),
	Command.withDescription("Change a user's role (admin|user)"),
)

const authDemoteCommand = Command.make(
	'demote',
	{
		email: Flag.string('email').pipe(
			Flag.withDescription('User to demote'),
			Flag.withFallbackPrompt(Prompt.text({ message: 'Email:' })),
		),
		confirmHost: confirmHostFlag,
	},
	({ email, confirmHost }) =>
		authPromote({
			email,
			role: 'user',
			confirmHost: Option.getOrUndefined(confirmHost),
		}),
).pipe(
	Command.withShortDescription("Demote a user to 'user' role"),
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
		confirmHost: confirmHostFlag,
	},
	({ keyId, confirmHost }) =>
		authRevokeKey({ keyId, confirmHost: Option.getOrUndefined(confirmHost) }),
).pipe(
	Command.withShortDescription('Disable an API key'),
	Command.withDescription('Disable an API key (enabled=false)'),
)

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
		confirmHost: confirmHostFlag,
	},
	({ email, password, confirmHost }) =>
		authResetPassword({
			email,
			password: Redacted.value(password),
			confirmHost: Option.getOrUndefined(confirmHost),
		}),
).pipe(
	Command.withShortDescription("Overwrite a user's password"),
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
	Command.withShortDescription('List active sessions'),
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
).pipe(Command.withDescription('Start the shared Docker services'))

const servicesDownCommand = Command.make(
	'down',
	{
		force: Flag.boolean('force').pipe(
			Flag.withDescription(
				'Stop the shared stack even from inside a worktree (affects every worktree)',
			),
			Flag.withDefault(false),
		),
	},
	({ force }) =>
		Effect.gen(function* () {
			yield* Effect.logInfo('Stopping services...')
			yield* servicesDown(force)
		}),
).pipe(
	Command.withDescription(
		'Stop the shared Docker services (affects all worktrees)',
	),
)

const servicesStatusCommand = Command.make(
	'status',
	{},
	() => servicesStatus,
).pipe(Command.withDescription('Show shared Docker services status'))

const servicesCommand = Command.make('services').pipe(
	Command.withDescription(
		'Manage the one shared Docker stack (Postgres, MinIO, GreenMail) all worktrees use',
	),
	Command.withSubcommands([
		servicesUpCommand,
		servicesDownCommand,
		servicesStatusCommand,
	]),
)

// ── Worktree ───────────────────────────────────────────────

const worktreeUpCommand = Command.make('up', {}, () => worktreeUp).pipe(
	Command.withShortDescription(
		'Provision this worktree (database + bucket + seed)',
	),
	Command.withDescription(
		'Provision this worktree inside the shared stack: create its own Postgres ' +
			'database (batuda_<branch>) and MinIO bucket, write its .env, then migrate ' +
			'and seed. Idempotent, and auto-runs on session start.',
	),
)

const worktreeDownCommand = Command.make('down', {}, () => worktreeDown).pipe(
	Command.withShortDescription('Drop this worktree’s database + bucket'),
	Command.withDescription(
		'Drop this worktree’s Postgres database and MinIO bucket from the shared ' +
			'stack. The shared containers and every other worktree are left untouched.',
	),
)

const worktreeDoneCommand = Command.make(
	'done',
	{
		force: Flag.boolean('force').pipe(
			Flag.withDescription(
				'Ignore a dirty working tree and force branch/worktree removal',
			),
			Flag.withDefault(false),
		),
		stash: Flag.boolean('stash').pipe(
			Flag.withDescription(
				'Stash uncommitted changes before cleanup, then pop them on main',
			),
			Flag.withDefault(false),
		),
	},
	({ force, stash }) => worktreeDone({ force, stash }),
).pipe(
	Command.withShortDescription('Finish a feature branch / linked worktree'),
	Command.withDescription(
		'Clean up after a merged PR: drop the worktree data, remove a linked ' +
			'worktree directory, and delete the local feature branch. From the main ' +
			'checkout it just checks out main, pulls, and deletes the branch. ' +
			'Fails if the working tree is dirty unless --stash or --force is passed.',
	),
)

const worktreePruneCommand = Command.make(
	'prune',
	{
		yes: Flag.boolean('yes').pipe(
			Flag.withDescription(
				'Actually drop the orphans (without it, prune only lists them)',
			),
			Flag.withDefault(false),
		),
	},
	({ yes }) => worktreePrune(yes),
).pipe(
	Command.withShortDescription(
		'List (or, with --yes, drop) orphaned worktree data',
	),
	Command.withDescription(
		'Find databases and buckets left behind by worktrees that no longer exist ' +
			'(removed with `git worktree remove`, crashed sessions, non-interactive ' +
			'runs). Lists them by default; pass `--yes` to drop. Ownership is read ' +
			'from each live worktree’s .env, so the main checkout and every live ' +
			'worktree — even one whose branch was swapped — are kept.',
	),
)

const worktreeLsCommand = Command.make('ls', {}, () => worktreeLs).pipe(
	Command.withShortDescription(
		'List all worktrees + their database/bucket/URL',
	),
	Command.withDescription(
		'Show every git worktree with its Postgres database, whether it is ' +
			'provisioned (✓), and its portless URL — the at-a-glance map for ' +
			'juggling parallel sessions.',
	),
)

const worktreeDoctorCommand = Command.make(
	'doctor',
	{},
	() => worktreeDoctor,
).pipe(
	Command.withShortDescription('Diagnose this worktree’s data layer'),
	Command.withDescription(
		'Check the current worktree’s health: shared stack reachable, its database ' +
			'exists + migrated, its bucket exists, and the portless URL it serves.',
	),
)

const worktreeWatchCommand = Command.make(
	'watch',
	{
		stop: Flag.boolean('stop').pipe(
			Flag.withDescription(
				'Close this worktree’s watch window (leaves other worktrees’ windows open)',
			),
			Flag.withDefault(false),
		),
	},
	({ stop }) => worktreeWatch({ stop }),
).pipe(
	Command.withShortDescription('Open this worktree in a live browser window'),
	Command.withDescription(
		'Open this worktree’s app in its own visible Chrome window (a stable ' +
			'per-worktree browser session), so parallel worktrees can be watched ' +
			'navigating live, side by side. Re-running reuses the same window; ' +
			'`--stop` closes only this worktree’s window, never the others.',
	),
)

const worktreeCommand = Command.make('worktree').pipe(
	Command.withShortDescription('Per-worktree dev data on the shared stack'),
	Command.withDescription(
		'Give each git worktree its own Postgres database + MinIO bucket inside the ' +
			'one shared Docker stack — low-RAM isolation for parallel sessions. ' +
			'Auto-provisioned on session start; `up` (re)provisions, `down` removes ' +
			'this worktree, `prune` reaps orphans, `ls` maps them, `doctor` ' +
			'diagnoses. Example: `pnpm cli worktree up`.',
	),
	Command.withSubcommands([
		worktreeUpCommand,
		worktreeDownCommand,
		worktreeDoneCommand,
		worktreePruneCommand,
		worktreeLsCommand,
		worktreeDoctorCommand,
		worktreeWatchCommand,
	]),
)

// ── Calendar ───────────────────────────────────────────────

const calendarSeedCommand = Command.make('seed', {}, () =>
	withDb(calendarSeed),
).pipe(
	Command.withShortDescription('Seed default event types'),
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
	Command.withShortDescription('Replay a signed cal.com webhook'),
	Command.withDescription(
		'Post a signed cal.com webhook envelope to the local server (no cal.com account needed)',
	),
)

const calendarCommand = Command.make('calendar').pipe(
	Command.withShortDescription('Seed event types, replay webhooks'),
	Command.withDescription('Calendar: seed event types, simulate webhooks'),
	Command.withSubcommands([
		calendarSeedCommand,
		calendarSimulateWebhookCommand,
	]),
)

// ── Email ──────────────────────────────────────────────────

const emailInjectCommand = Command.make(
	'inject',
	{
		to: Flag.string('to').pipe(
			Flag.withDescription('Recipient address (must match a seeded inbox)'),
			Flag.withFallbackPrompt(
				Prompt.text({ message: 'To (a seeded inbox address):' }),
			),
		),
		from: Flag.string('from').pipe(
			Flag.withDescription('Sender address (any value works locally)'),
			// The catcher accepts any sender, so there is nothing here only a person
			// could answer — and asking would leave a script or an agent waiting
			// forever at a prompt it cannot see.
			Flag.withDefault('dev@batuda.test'),
		),
		subject: Flag.string('subject').pipe(
			Flag.withDescription('Subject line'),
			Flag.withFallbackPrompt(Prompt.text({ message: 'Subject:' })),
		),
		text: Flag.string('text').pipe(
			Flag.withDescription('Plain-text body'),
			Flag.optional,
		),
		html: Flag.string('html').pipe(
			Flag.withDescription('HTML body (sets Content-Type: text/html)'),
			Flag.optional,
		),
		inReplyTo: Flag.string('in-reply-to').pipe(
			Flag.withDescription('Message-Id this reply targets (chains threading)'),
			Flag.optional,
		),
		host: Flag.string('smtp-host').pipe(
			Flag.withDescription('Mail catcher SMTP host'),
			Flag.withDefault('localhost'),
		),
		port: Flag.integer('smtp-port').pipe(
			Flag.withDescription('Mail catcher SMTP port'),
			Flag.withDefault(1025),
		),
	},
	({ to, from, subject, text, html, inReplyTo, host, port }) =>
		emailInject({
			to,
			from,
			subject,
			text: Option.getOrUndefined(text),
			html: Option.getOrUndefined(html),
			inReplyTo: Option.getOrUndefined(inReplyTo),
			host,
			port,
		}),
).pipe(
	Command.withShortDescription('SMTP a canned message into the mail catcher'),
	Command.withDescription(
		'SMTP a canned message into the mail catcher (visible via its REST API; if addressed to a seeded inbox with the worker running, it is also ingested over IMAP)',
	),
)

const emailClearCommand = Command.make('clear', {}, () => emailClear).pipe(
	Command.withShortDescription(
		'Empty the mail catcher (affects every checkout)',
	),
	Command.withDescription(
		'Discard every message the mail catcher is holding. One catcher serves every checkout on this machine, so this empties it for all of them — nothing else does it for you, because the catcher cannot empty one mailbox at a time',
	),
)

const emailBackfillBodiesCommand = Command.make(
	'backfill-bodies',
	{
		dryRun: Flag.boolean('dry-run').pipe(
			Flag.withDescription(
				'List the messages that would be filled in, without writing anything',
			),
			Flag.withDefault(false),
		),
	},
	({ dryRun }) => withDb(emailBackfillBodies({ dryRun })),
).pipe(
	Command.withShortDescription('Fill in the body of already-sent messages'),
	Command.withDescription(
		'Fill in the body of messages sent before the send path stored one, reading each message back from object storage. Only touches messages that still have no body, so it is safe to run twice; a message whose stored copy is missing is counted and skipped. Needs DATABASE_URL and the STORAGE_* settings for the environment being fixed',
	),
)

const emailCommand = Command.make('email').pipe(
	Command.withDescription(
		'Email: inject canned messages into the mail catcher, empty it, or fill in missing message bodies',
	),
	Command.withSubcommands([
		emailInjectCommand,
		emailClearCommand,
		emailBackfillBodiesCommand,
	]),
)

// ── Research ───────────────────────────────────────────────

const researchProbeCommand = Command.make(
	'probe',
	{
		baseUrl: Flag.string('base-url').pipe(
			Flag.withDescription('OpenAI-compatible endpoint to probe'),
			Flag.withDefault('https://api.tokenfactory.nebius.com/v1'),
		),
		// The key is named, never pasted: pnpm echoes its arguments, so a key
		// written on the command line ends up in logs and shell history.
		apiKeyEnv: Flag.string('api-key-env').pipe(
			Flag.withDescription(
				'Name of the environment variable holding the API key (defaults to RESEARCH_LLM_AGENT_API_KEY)',
			),
			Flag.withDefault('RESEARCH_LLM_AGENT_API_KEY'),
		),
		models: Flag.string('models').pipe(
			Flag.withDescription('Comma-separated model ids to probe'),
			Flag.withDefault(
				'openai/gpt-oss-120b,Qwen/Qwen3-235B-A22B-Instruct-2507,deepseek-ai/DeepSeek-V4-Pro,zai-org/GLM-5.2',
			),
		),
	},
	({ baseUrl, apiKeyEnv, models }) =>
		researchProbe({
			baseUrl,
			apiKeyEnv,
			models: models
				.split(',')
				.map(model => model.trim())
				.filter(model => model.length > 0),
		}),
).pipe(
	Command.withShortDescription(
		'Check models for tool-calling + JSON-schema support',
	),
	Command.withDescription(
		'Probe each candidate model on an OpenAI-compatible endpoint (Nebius by default) for forced tool calling and strict JSON-schema output — the two features the research agent and extract tiers depend on. Use it to gate a model out before trusting it in a tier.',
	),
)

const researchProbeConfigCommand = Command.make('probe-config', {}, () =>
	researchProbeConfig(),
).pipe(
	Command.withShortDescription(
		'Check every model the settings point a tier at',
	),
	Command.withDescription(
		'Ask each model the research settings point a tier at whether it can still do what that tier needs — forced tool calling and strict JSON output. Reads the same settings a run reads, so it checks the models a run would really use. Exits non-zero only when a model itself will not do the work; a rejected key, a rate limit or a vendor outage are reported and let through, since none of those say anything about the model.',
	),
)

const researchCapCommand = Command.make(
	'cap',
	{
		org: Flag.string('org').pipe(
			Flag.withDescription('Organization id the ceiling belongs to'),
		),
		cents: Flag.integer('cents').pipe(
			Flag.withDescription(
				'New ceiling in cents per calendar month; omit to read the current one',
			),
			Flag.optional,
		),
	},
	({ org, cents }) => researchCap({ org, cents: Option.getOrUndefined(cents) }),
).pipe(
	Command.withShortDescription(
		"Read or set a company's monthly paid-research ceiling",
	),
	Command.withDescription(
		'What one company may spend at paid research vendors in a calendar month, shared by everyone in it. A company with no figure of its own spends up to the one shipped in configuration; give a company its own figure when it needs more. The system-wide hard ceiling still applies on top, so this alone can never authorise unlimited spending.',
	),
)

const researchEvalCommand = Command.make(
	'eval',
	{
		org: Flag.string('org').pipe(
			Flag.withDescription('Organization id to run the research under'),
		),
		user: Flag.string('user').pipe(
			Flag.withDescription('User id the runs are attributed to'),
		),
		golden: Flag.string('golden').pipe(
			Flag.withDescription('Path to the golden-set JSON file'),
		),
		schema: Flag.string('schema').pipe(
			Flag.withDescription('Research output schema to run'),
			Flag.withDefault('company_enrichment_v1'),
		),
		language: Flag.string('language').pipe(
			Flag.withDescription(
				"Language hint for the runs (e.g. es, ca, en) — carried into the search so it looks in the target's own language, for testing non-English targets",
			),
			Flag.optional,
		),
		concurrency: Flag.integer('concurrency').pipe(
			Flag.withDescription(
				'How many runs to execute at once. One by default: runs competing for the same providers slow each other into timeouts, and a run that times out scores as empty — which reads as a quality drop that no change caused',
			),
			Flag.withDefault(1),
		),
		runs: Flag.integer('runs').pipe(
			Flag.withDescription(
				"How many times to run each company. Repeats inside one invocation are answered from the caches, so they return the first run's answer and average away no noise — to take a real reading, run separate passes with the caches cleared between them",
			),
			Flag.withDefault(1),
		),
		out: Flag.string('out').pipe(
			Flag.withDescription('Write the full JSON report to this path'),
			Flag.optional,
		),
		byBucket: Flag.boolean('by-bucket').pipe(
			Flag.withDescription(
				'Also print the metrics broken out by size/reach bucket and by country, so a regression in one segment is not averaged away',
			),
		),
	},
	({ org, user, golden, schema, language, concurrency, runs, out, byBucket }) =>
		researchEval({
			org,
			user,
			goldenPath: golden,
			schemaName: schema,
			language,
			concurrency,
			runs,
			out,
			byBucket,
		}),
).pipe(
	Command.withShortDescription(
		'Score the research pipeline against a golden set',
	),
	Command.withDescription(
		'Drive each company in a golden-set JSON file through the live research pipeline and report grounding accuracy, field precision, field recall, titled-contact recall, wrong-company rate, and empty rate. Needs the research env configured (LLM + provider keys, DATABASE_URL) and an --org / --user to run as. Writes a full per-run report with --out.',
	),
)

const researchEvalContactsCommand = Command.make(
	'eval-contacts',
	{
		org: Flag.string('org').pipe(
			Flag.withDescription('Organization id to run discovery under'),
		),
		user: Flag.string('user').pipe(
			Flag.withDescription('User id the runs are attributed to'),
		),
		golden: Flag.string('golden').pipe(
			Flag.withDescription('Path to the contact golden-set JSON file'),
		),
		concurrency: Flag.integer('concurrency').pipe(
			Flag.withDescription(
				'How many companies to discover at once. One by default, so a vendor answering slower under load cannot be read as worse enrichment',
			),
			Flag.withDefault(1),
		),
		runs: Flag.integer('runs').pipe(
			Flag.withDescription(
				'How many times to run each company; discovery is largely deterministic, so 1 is usually enough',
			),
			Flag.withDefault(1),
		),
		enrich: Flag.string('enrich').pipe(
			Flag.withDescription(
				'Override RESEARCH_PROVIDER_ENRICH for this run, e.g. "hunter" or "hunter,fullenrich"',
			),
			Flag.optional,
		),
		enrichMode: Flag.string('enrich-mode').pipe(
			Flag.withDescription(
				'Override RESEARCH_ENRICH_MODE: fallback (stop at the first vendor with people) or union (run all + dedupe)',
			),
			Flag.optional,
		),
		out: Flag.string('out').pipe(
			Flag.withDescription('Write the full JSON report to this path'),
			Flag.optional,
		),
	},
	({ org, user, golden, concurrency, runs, enrich, enrichMode, out }) =>
		researchEvalContacts({
			org,
			user,
			goldenPath: golden,
			concurrency,
			runs,
			enrich,
			enrichMode,
			out,
		}),
).pipe(
	Command.withShortDescription('Score contact discovery against a golden set'),
	Command.withDescription(
		'Drive each company in a contact golden-set JSON file through the live discover_contacts flow and report contact recall, decision-maker recall, email precision, empty rate, and cost per verified contact. --enrich / --enrich-mode pick the vendor chain and fallback-vs-union, so the same set can be scored across configs to read recall lift against cost delta. Needs the research env (provider keys, DATABASE_URL) and an --org / --user to run as.',
	),
)

const researchEvalInvarianceCommand = Command.make(
	'eval-invariance',
	{
		org: Flag.string('org').pipe(
			Flag.withDescription('Organization id to run the research under'),
		),
		user: Flag.string('user').pipe(
			Flag.withDescription('User id the runs are attributed to'),
		),
		golden: Flag.string('golden').pipe(
			Flag.withDescription('Path to the golden-set JSON file'),
		),
		schema: Flag.string('schema').pipe(
			Flag.withDescription('Research output schema to run'),
			Flag.withDefault('company_enrichment_v1'),
		),
		concurrency: Flag.integer('concurrency').pipe(
			Flag.withDescription(
				'How many companies to evaluate at once. One by default, so two wordings are compared under the same conditions rather than one of them under load',
			),
			Flag.withDefault(1),
		),
	},
	({ org, user, golden, schema, concurrency }) =>
		researchEvalInvariance({
			org,
			user,
			goldenPath: golden,
			schemaName: schema,
			concurrency,
		}),
).pipe(
	Command.withShortDescription(
		'Prove instruction framing cannot bend the extracted facts',
	),
	Command.withDescription(
		'Run each golden company twice under two opposite framings (small-family vs large-enterprise) and compare: the firmographics, the entity verdict, and the named contacts must come out the same — a divergence means the framing leaked into what counts as evidence. Live and billable (two runs per company). Needs the research env configured and an --org / --user to run as.',
	),
)

const researchCommand = Command.make('research').pipe(
	Command.withDescription('Research context tools'),
	Command.withSubcommands([
		researchCapCommand,
		researchProbeCommand,
		researchProbeConfigCommand,
		researchEvalCommand,
		researchEvalContactsCommand,
		researchEvalInvarianceCommand,
	]),
)

// ── Root ───────────────────────────────────────────────────

// Exported so the TUI walker (`apps/cli/src/tui.ts`) can introspect the
// command tree and run leaves in-process via `Command.runWith`. Keeping the
// definition here (rather than in a separate `cli-tree.ts`) avoids splitting
// the file just to share one const; the `isMain` guard below makes import
// safe by deferring `runMain` until cli.ts is the entry script.
// The TUI runs a leaf with no argv, so an entity picker only appears if the
// argument itself prompts. Gate that prompt on an interactive stdin: the TUI
// and a bare interactive `data` get the picker, while piped / non-TTY callers
// (CI, scripts, agents) fall straight to the overview instead of blocking on a
// prompt nothing will ever answer. `optional` stays outermost either way, so a
// provided `data <entity>` skips the prompt and Esc lands on the overview.
const dataEntityArg = (() => {
	const base = Argument.choice('entity', ENTITY_NAMES).pipe(
		Argument.withDescription(
			'Seeded entity to list; omit (or Esc the prompt) for an overview',
		),
	)
	return process.stdin.isTTY
		? base.pipe(
				Argument.withFallbackPrompt(
					Prompt.select({
						message: 'Which entity? (Esc for the overview)',
						choices: ENTITY_NAMES.map(name => ({ title: name, value: name })),
					}),
				),
				Argument.optional,
			)
		: base.pipe(Argument.optional)
})()

const dataCommand = Command.make(
	'data',
	{
		entity: dataEntityArg,
		json: Flag.boolean('json').pipe(
			Flag.withDescription('Print JSON instead of a table'),
			Flag.withDefault(false),
		),
	},
	({ entity, json }) => withDb(dataInspect(entity, json)),
).pipe(
	Command.withShortDescription('List seeded mock data'),
	Command.withDescription(
		'Inspect seeded mock data: run bare for a row-count overview, or `data <entity>` (orgs, members, companies, templates, stacks, inboxes, tasks, pages) for the rows. Add --json to script the output.',
	),
)

const companiesBackfillGeocodeCommand = Command.make(
	'backfill-geocode',
	{
		dryRun: Flag.boolean('dry-run').pipe(
			Flag.withDescription('List what would be geocoded without writing'),
			Flag.withDefault(false),
		),
	},
	({ dryRun }) => withDb(companiesBackfillGeocode(dryRun)),
).pipe(
	Command.withShortDescription('Geocode companies missing coordinates'),
	Command.withDescription(
		'One-time backfill: geocode every company that has a location but no coordinates. Calls Nominatim at ~1 request/second across all orgs; add --dry-run to preview.',
	),
)

const companiesCommand = Command.make('companies').pipe(
	Command.withDescription('Company maintenance tasks'),
	Command.withSubcommands([companiesBackfillGeocodeCommand]),
)

export const batuda = Command.make('batuda').pipe(
	Command.withDescription('Batuda CLI'),
	Command.withSubcommands([
		setupCommand,
		doctorCommand,
		seedCommand,
		dbCommand,
		dataCommand,
		companiesCommand,
		authCommand,
		servicesCommand,
		worktreeCommand,
		calendarCommand,
		emailCommand,
		researchCommand,
	]),
)

// ── Run ────────────────────────────────────────────────────

// Standard ESM "is this file the entry point?" check. Equivalent to
// `require.main === module` in CJS. tsx, the dev runner, sets
// `process.argv[1]` to the absolute path of the entry .ts file; the bundled
// `dist/cli.mjs` keeps the same shape. Importing `batuda` from tui.ts
// therefore evaluates this module without ever running `runMain`.
const isMain =
	typeof import.meta?.url === 'string' &&
	process.argv[1] === fileURLToPath(import.meta.url)

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

// Shared by tapError (typed failures) and tapDefect (Effect.die /
// unhandled exceptions). Without the latter, a `disableErrorReporting`
// runtime swallows defects entirely and the user sees an empty exit 1.
const reportError = (e: unknown) => {
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
}

if (isMain) {
	// Parse `--env local|cloud` (default local), strip the flag + pnpm's `--`
	// separator, and populate process.env via dotenv BEFORE Effect Config
	// resolves any variable. Every subsequent `Config.redacted('DATABASE_URL')`
	// / `Config.string(...)` read hits a fully-loaded process.env.
	loadEnv()

	const program = Command.run(batuda, { version: '0.0.1' }).pipe(
		Effect.provide(NodeServices.layer),
		Effect.tapError(reportError),
		Effect.tapDefect(reportError),
	)
	NodeRuntime.runMain(
		program as unknown as Effect.Effect<void, unknown, never>,
		{ disableErrorReporting: true },
	)
}
