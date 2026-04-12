import * as p from '@clack/prompts'
import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { Effect } from 'effect'
import pc from 'picocolors'

import { authCreateKey } from './commands/auth'
import { authBootstrap } from './commands/auth-bootstrap'
import { authInvite } from './commands/auth-invite'
import { authListKeys } from './commands/auth-list-keys'
import { authListUsers } from './commands/auth-list-users'
import { authPromote } from './commands/auth-promote'
import { authResetPassword } from './commands/auth-reset-password'
import { authRevokeKey } from './commands/auth-revoke-key'
import { authSessions } from './commands/auth-sessions'
import { dbMigrate, dbReset } from './commands/db'
import { doctor } from './commands/doctor'
import { seed } from './commands/seed'
import { servicesDown, servicesStatus, servicesUp } from './commands/services'
import { appendEnvKeys, resetEnvFile, setup } from './commands/setup'
import { withDb } from './db'
import { getTarget, loadEnv } from './lib/load-env'

// Populate process.env + resolve --env before any Effect Config reads.
loadEnv()

// ── TUI ────────────────────────────────────────────────────

const tui = Effect.gen(function* () {
	const target = getTarget()
	const targetBadge =
		target === 'cloud'
			? pc.bgRed(pc.white(' CLOUD '))
			: pc.bgGreen(pc.black(' LOCAL '))
	p.intro(`${pc.bgCyan(pc.black(' Engranatge CLI '))} ${targetBadge}`)

	const command = yield* Effect.promise(() =>
		p.select({
			message: 'What do you want to do?',
			options: [
				{
					value: 'setup' as const,
					label: 'Setup',
					hint: 'Configure local environment (.env, etc.)',
				},
				{
					value: 'doctor' as const,
					label: 'Doctor',
					hint: 'Check environment health',
				},
				{
					value: 'seed' as const,
					label: 'Seed',
					hint: 'Populate database with sample data',
				},
				{
					value: 'db' as const,
					label: 'DB',
					hint: 'Database management',
				},
				{
					value: 'services' as const,
					label: 'Services',
					hint: 'Manage local Docker services',
				},
				{
					value: 'auth' as const,
					label: 'Auth',
					hint: 'Better Auth users, keys, and sessions',
				},
			],
		}),
	)

	if (p.isCancel(command)) {
		p.cancel('Cancelled.')
		return
	}

	switch (command) {
		case 'setup': {
			const s = p.spinner()
			s.start('Configuring environment...')
			const results = yield* setup
			s.stop('Environment configured!')

			for (const result of results) {
				switch (result.status) {
					case 'created':
						p.log.success(`created ${result.target}`)
						break
					case 'up-to-date':
						p.log.success(`${result.target} up to date`)
						break
					case 'skipped':
						p.log.warn(`skip ${result.target} (no ${result.example})`)
						break
					case 'stale': {
						const lines = result.missing.map(
							e => `${pc.cyan(e.key)}=${e.line.slice(e.key.length + 1)}`,
						)
						p.note(lines.join('\n'), `Missing in ${result.target}`)

						const action = yield* Effect.promise(() =>
							p.select({
								message: `${result.target} has ${result.missing.length} missing key(s)`,
								options: [
									{
										value: 'append' as const,
										label: 'Append missing keys',
									},
									{
										value: 'reset' as const,
										label: 'Replace entire file from .env.example',
									},
									{ value: 'skip' as const, label: 'Skip' },
								],
							}),
						)

						if (p.isCancel(action) || action === 'skip') break
						if (action === 'append') {
							yield* appendEnvKeys(result.target, result.missing)
							p.log.success(
								`Appended ${result.missing.length} key(s) to ${result.target}`,
							)
						} else {
							yield* resetEnvFile(result.example, result.target)
							p.log.success(`Replaced ${result.target} from ${result.example}`)
						}
						break
					}
				}
			}
			break
		}

		case 'doctor': {
			const s = p.spinner()
			s.start('Checking...')
			const results = yield* doctor
			s.stop('Diagnosis complete!')
			const lines = results.map(r => {
				const icon =
					r.status === 'ok'
						? pc.green('\u2713')
						: r.status === 'warn'
							? pc.yellow('!')
							: pc.red('\u2717')
				return `${icon} ${r.name}: ${r.detail}`
			})
			p.note(lines.join('\n'), 'Status')
			break
		}

		case 'seed': {
			yield* withDb(
				Effect.gen(function* () {
					const s = p.spinner()
					s.start('Inserting data...')
					const counts = yield* seed('full')
					s.stop('Seed complete!')

					p.note(
						[
							`${pc.cyan(String(counts.products))} products`,
							`${pc.cyan(String(counts.companies))} companies`,
							`${pc.cyan(String(counts.contacts))} contacts`,
							`${pc.cyan(String(counts.interactions))} interactions`,
							`${pc.cyan(String(counts.tasks))} tasks`,
							`${pc.cyan(String(counts.documents))} documents`,
							`${pc.cyan(String(counts.proposals))} proposals`,
							`${pc.cyan(String(counts.pages))} pages`,
						].join('\n'),
						'Summary',
					)
				}),
			)
			break
		}

		case 'db': {
			const action = yield* Effect.promise(() =>
				p.select({
					message: 'Action?',
					options: [
						{
							value: 'migrate' as const,
							label: 'Migrate',
							hint: 'Run database migrations',
						},
						{
							value: 'reset' as const,
							label: 'Reset',
							hint: 'Truncate + migrate + seed',
						},
					],
				}),
			)

			if (p.isCancel(action)) {
				p.cancel('Cancelled.')
				return
			}

			switch (action) {
				case 'migrate': {
					const s = p.spinner()
					s.start('Running migrations...')
					yield* dbMigrate
					s.stop('Migrations complete!')
					break
				}
				case 'reset': {
					const confirm = yield* Effect.promise(() =>
						p.confirm({
							message: 'Are you sure? All data will be lost.',
							initialValue: false,
						}),
					)
					if (p.isCancel(confirm) || !confirm) {
						p.cancel('Cancelled.')
						return
					}
					const s = p.spinner()
					s.start('Resetting database...')
					yield* withDb(dbReset)
					s.stop('Database reset!')
					break
				}
			}
			break
		}

		case 'services': {
			const action = yield* Effect.promise(() =>
				p.select({
					message: 'Action?',
					options: [
						{
							value: 'up' as const,
							label: 'Up',
							hint: 'Start services',
						},
						{
							value: 'down' as const,
							label: 'Down',
							hint: 'Stop services',
						},
						{
							value: 'status' as const,
							label: 'Status',
							hint: 'Show services status',
						},
					],
				}),
			)

			if (p.isCancel(action)) {
				p.cancel('Cancelled.')
				return
			}

			switch (action) {
				case 'up':
					yield* servicesUp
					break
				case 'down':
					yield* servicesDown
					break
				case 'status':
					yield* servicesStatus
					break
			}
			break
		}

		case 'auth': {
			const action = yield* Effect.promise(() =>
				p.select({
					message: 'Action?',
					options: [
						{
							value: 'bootstrap' as const,
							label: 'Bootstrap',
							hint: 'Create the first admin user',
						},
						{
							value: 'invite' as const,
							label: 'Invite',
							hint: 'Passwordless user + magic link',
						},
						{
							value: 'list-users' as const,
							label: 'List users',
							hint: 'Dump the user table',
						},
						{
							value: 'list-keys' as const,
							label: 'List API keys',
							hint: 'Every API key (all or by email)',
						},
						{
							value: 'create-key' as const,
							label: 'Create API key',
							hint: 'Mint a new key for a user',
						},
						{
							value: 'promote' as const,
							label: 'Promote / Demote',
							hint: "Change a user's role",
						},
						{
							value: 'revoke-key' as const,
							label: 'Revoke API key',
							hint: 'Disable an API key',
						},
						{
							value: 'reset-password' as const,
							label: 'Reset password',
							hint: "Overwrite a user's credential",
						},
						{
							value: 'sessions' as const,
							label: 'Sessions',
							hint: 'Active sessions (all or by email)',
						},
					],
				}),
			)

			if (p.isCancel(action)) {
				p.cancel('Cancelled.')
				return
			}

			switch (action) {
				case 'bootstrap': {
					const email = yield* Effect.promise(() =>
						p.text({
							message: 'Admin email:',
							validate: v =>
								v && v.includes('@') ? undefined : 'Must be an email address',
						}),
					)
					if (p.isCancel(email)) {
						p.cancel('Cancelled.')
						return
					}
					const name = yield* Effect.promise(() =>
						p.text({
							message: 'Admin name:',
							validate: v => (v && v.trim() ? undefined : 'Required'),
						}),
					)
					if (p.isCancel(name)) {
						p.cancel('Cancelled.')
						return
					}
					const password = yield* Effect.promise(() =>
						p.password({
							message: 'Admin password:',
							validate: v =>
								v && v.length >= 8 ? undefined : 'At least 8 characters',
						}),
					)
					if (p.isCancel(password)) {
						p.cancel('Cancelled.')
						return
					}
					yield* authBootstrap({ email, name, password })
					break
				}
				case 'invite': {
					const email = yield* Effect.promise(() =>
						p.text({
							message: 'Invitee email:',
							validate: v =>
								v && v.includes('@') ? undefined : 'Must be an email address',
						}),
					)
					if (p.isCancel(email)) {
						p.cancel('Cancelled.')
						return
					}
					const name = yield* Effect.promise(() =>
						p.text({
							message: 'Invitee name:',
							validate: v => (v && v.trim() ? undefined : 'Required'),
						}),
					)
					if (p.isCancel(name)) {
						p.cancel('Cancelled.')
						return
					}
					const role = yield* Effect.promise(() =>
						p.select({
							message: 'Role?',
							options: [
								{ value: 'user' as const, label: 'User' },
								{ value: 'admin' as const, label: 'Admin' },
							],
							initialValue: 'user' as const,
						}),
					)
					if (p.isCancel(role)) {
						p.cancel('Cancelled.')
						return
					}
					yield* authInvite({ email, name, role })
					break
				}
				case 'list-users': {
					yield* authListUsers
					break
				}
				case 'list-keys': {
					const scope = yield* Effect.promise(() =>
						p.select({
							message: 'Scope?',
							options: [
								{ value: 'all' as const, label: 'All keys' },
								{ value: 'by-email' as const, label: 'Filter by email' },
							],
							initialValue: 'all' as const,
						}),
					)
					if (p.isCancel(scope)) {
						p.cancel('Cancelled.')
						return
					}
					let email: string | undefined
					if (scope === 'by-email') {
						const input = yield* Effect.promise(() =>
							p.text({
								message: 'Email:',
								validate: v =>
									v && v.includes('@') ? undefined : 'Must be an email address',
							}),
						)
						if (p.isCancel(input)) {
							p.cancel('Cancelled.')
							return
						}
						email = input
					}
					yield* authListKeys({ email })
					break
				}
				case 'create-key': {
					const email = yield* Effect.promise(() =>
						p.text({
							message: 'Owner email:',
							validate: v =>
								v && v.includes('@') ? undefined : 'Must be an email address',
						}),
					)
					if (p.isCancel(email)) {
						p.cancel('Cancelled.')
						return
					}
					const name = yield* Effect.promise(() =>
						p.text({
							message: 'Key name:',
							initialValue: 'local-dev',
							validate: v => (v && v.trim() ? undefined : 'Required'),
						}),
					)
					if (p.isCancel(name)) {
						p.cancel('Cancelled.')
						return
					}
					const prefix = yield* Effect.promise(() =>
						p.text({
							message: 'Key prefix:',
							initialValue: 'forja_',
							validate: v => (v && v.trim() ? undefined : 'Required'),
						}),
					)
					if (p.isCancel(prefix)) {
						p.cancel('Cancelled.')
						return
					}
					yield* authCreateKey({
						email,
						name,
						prefix,
						expiresIn: undefined,
					})
					break
				}
				case 'promote': {
					const email = yield* Effect.promise(() =>
						p.text({
							message: 'Email:',
							validate: v =>
								v && v.includes('@') ? undefined : 'Must be an email address',
						}),
					)
					if (p.isCancel(email)) {
						p.cancel('Cancelled.')
						return
					}
					const role = yield* Effect.promise(() =>
						p.select({
							message: 'New role?',
							options: [
								{ value: 'admin' as const, label: 'Admin' },
								{ value: 'user' as const, label: 'User' },
							],
							initialValue: 'admin' as const,
						}),
					)
					if (p.isCancel(role)) {
						p.cancel('Cancelled.')
						return
					}
					yield* authPromote({ email, role })
					break
				}
				case 'revoke-key': {
					const keyId = yield* Effect.promise(() =>
						p.text({
							message: 'Key id:',
							validate: v => (v && v.trim() ? undefined : 'Required'),
						}),
					)
					if (p.isCancel(keyId)) {
						p.cancel('Cancelled.')
						return
					}
					yield* authRevokeKey({ keyId })
					break
				}
				case 'reset-password': {
					const email = yield* Effect.promise(() =>
						p.text({
							message: 'Email:',
							validate: v =>
								v && v.includes('@') ? undefined : 'Must be an email address',
						}),
					)
					if (p.isCancel(email)) {
						p.cancel('Cancelled.')
						return
					}
					const password = yield* Effect.promise(() =>
						p.password({
							message: 'New password:',
							validate: v =>
								v && v.length >= 8 ? undefined : 'At least 8 characters',
						}),
					)
					if (p.isCancel(password)) {
						p.cancel('Cancelled.')
						return
					}
					yield* authResetPassword({ email, password })
					break
				}
				case 'sessions': {
					const scope = yield* Effect.promise(() =>
						p.select({
							message: 'Scope?',
							options: [
								{ value: 'all' as const, label: 'All sessions' },
								{ value: 'by-email' as const, label: 'Filter by email' },
							],
							initialValue: 'all' as const,
						}),
					)
					if (p.isCancel(scope)) {
						p.cancel('Cancelled.')
						return
					}
					let email: string | undefined
					if (scope === 'by-email') {
						const input = yield* Effect.promise(() =>
							p.text({
								message: 'Email:',
								validate: v =>
									v && v.includes('@') ? undefined : 'Must be an email address',
							}),
						)
						if (p.isCancel(input)) {
							p.cancel('Cancelled.')
							return
						}
						email = input
					}
					yield* authSessions({ email })
					break
				}
			}
			break
		}
	}

	p.outro(pc.green('Done!'))
})

// ── Run ────────────────────────────────────────────────────

const program = tui.pipe(
	Effect.provide(NodeServices.layer),
	Effect.tapError(e =>
		Effect.sync(() => p.cancel(e instanceof Error ? e.message : String(e))),
	),
)
NodeRuntime.runMain(program as unknown as Effect.Effect<void, unknown, never>, {
	disableErrorReporting: true,
})
