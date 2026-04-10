import * as p from '@clack/prompts'
import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { Effect } from 'effect'
import pc from 'picocolors'

import { dbMigrate, dbReset } from './commands/db'
import { doctor } from './commands/doctor'
import { seed } from './commands/seed'
import { servicesDown, servicesStatus, servicesUp } from './commands/services'
import { appendEnvKeys, resetEnvFile, setup } from './commands/setup'
import { withDb } from './db'

// ── TUI ────────────────────────────────────────────────────

const tui = Effect.gen(function* () {
	p.intro(pc.bgCyan(pc.black(' Engranatge CLI ')))

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
