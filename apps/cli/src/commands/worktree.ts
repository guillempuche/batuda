import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { Console, Effect, Schedule } from 'effect'

import { exec, execIn, execSilent, ROOT } from '../shell'
import { dbMigrate } from './db'

// The whole machine runs ONE shared Docker stack (the `batuda` compose project).
// A linked worktree is not its own stack — it's a logical tenant inside the shared
// one: its own Postgres database and its own MinIO bucket, with a `.env` pointing
// at them. portless already separates the app servers per branch; this separates
// the data each branch reads/writes, at a fraction of the RAM of a stack-per-worktree.

const BASE = resolve(ROOT, 'docker/docker-compose.yml')
const SHARED_PROJECT = 'batuda'
const DB_CONTAINER = 'batuda-db'
const PG_USER = 'batuda'
// Compose names the default network `<project>_default`.
const STORAGE_NETWORK = `${SHARED_PROJECT}_default`

// Docker-safe slug (lowercase, [a-z0-9-]) derived from the worktree's branch.
const slugify = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 24)

// Postgres identifiers can't contain hyphens unquoted, so the database name uses
// underscores; S3 bucket names can't contain underscores, so the bucket keeps
// hyphens. Both derive from the one slug so they stay paired per worktree.
const dbName = (slug: string) => `batuda_${slug.replace(/-/g, '_')}`
const bucketName = (slug: string) => `batuda-assets-${slug}`

// The shared `.git` is identical from any worktree, so its parent is the main
// checkout — where the real .env (the values to inherit) lives.
const mainCheckoutRoot = () =>
	execSilent(
		'git',
		'rev-parse',
		'--path-format=absolute',
		'--git-common-dir',
	).pipe(Effect.map(dirname))

export const isLinkedWorktree = Effect.gen(function* () {
	const gitDir = yield* execSilent(
		'git',
		'rev-parse',
		'--path-format=absolute',
		'--absolute-git-dir',
	)
	const main = yield* mainCheckoutRoot()
	// In the main checkout gitDir is `<main>/.git`; in a linked worktree it is
	// `<main>/.git/worktrees/<name>`, so it sits below the common `.git`.
	return gitDir !== resolve(main, '.git')
})

const branchName = execSilent('git', 'rev-parse', '--abbrev-ref', 'HEAD')

const slugForCurrentWorktree = branchName.pipe(
	Effect.map(b => slugify(b.replace(/^worktree-/, ''))),
)

// Only the worktree's own database and bucket differ from main; the shared
// endpoints (Postgres host/port, MinIO, Mailpit) are inherited as-is.
const envOverrides = (slug: string): Record<string, string> => ({
	DATABASE_URL: `postgresql://batuda:batuda@localhost:5433/${dbName(slug)}`,
	STORAGE_BUCKET: bucketName(slug),
})

// Rewrite matching keys in a .env body, appending any that weren't present, so the
// worktree inherits every other value from the main checkout's file.
const mergeEnv = (base: string, overrides: Record<string, string>): string => {
	const remaining = new Set(Object.keys(overrides))
	const lines = base.split('\n').map(line => {
		const match = line.match(/^([A-Z0-9_]+)=/)
		const key = match?.[1]
		if (key && key in overrides) {
			remaining.delete(key)
			return `${key}=${overrides[key]}`
		}
		return line
	})
	for (const key of remaining) lines.push(`${key}=${overrides[key]}`)
	return lines.join('\n')
}

// Read the main checkout's .env (the source of every shared value), apply the
// worktree overrides, and write the worktree's copy. Both apps/server (root .env)
// and the CLI (apps/cli/.env) need the DB url, so write both.
const writeWorktreeEnv = (mainRoot: string, slug: string) =>
	Effect.gen(function* () {
		const overrides = envOverrides(slug)
		const targets: Array<{
			from: string
			to: string
			keys?: readonly string[]
		}> = [
			{ from: resolve(mainRoot, '.env'), to: resolve(ROOT, '.env') },
			{
				from: resolve(mainRoot, 'apps/cli/.env'),
				to: resolve(ROOT, 'apps/cli/.env'),
				keys: ['DATABASE_URL'],
			},
		]
		for (const t of targets) {
			if (!existsSync(t.from)) {
				return yield* Effect.fail(
					new Error(
						`No ${t.from} in the main checkout — run \`pnpm cli setup\` there first.`,
					),
				)
			}
			const base = readFileSync(t.from, 'utf-8')
			const subset = t.keys
				? Object.fromEntries(
						t.keys.flatMap(k => {
							const v = overrides[k]
							return v === undefined ? [] : [[k, v] as const]
						}),
					)
				: overrides
			yield* Effect.promise(() => writeFile(t.to, mergeEnv(base, subset)))
		}
	})

const dockerFail = <A, E, R>(self: Effect.Effect<A, E, R>) =>
	self.pipe(
		Effect.catch(() =>
			Effect.fail(
				new Error('Docker command failed. Is Docker/OrbStack running?'),
			),
		),
	)

// `exec` runs through a shell that concatenates its args WITHOUT quoting, so a
// multi-word argument (a SQL statement, a `sh -c` script) would be word-split.
// Each docker command below is therefore passed as one already-quoted command
// string. Interpolated values are all from a `[a-z0-9_-]` slug, so quoting them
// is safe.

// Start the one shared stack if it isn't already up (idempotent).
const ensureSharedStack = dockerFail(
	exec(`docker compose -p ${SHARED_PROJECT} -f "${BASE}" up -d`),
)

// CREATE/DROP DATABASE can't run from inside the target database, so every call
// goes through the shared db container's `postgres` maintenance database.
const databaseExists = (slug: string) =>
	execSilent(
		`docker exec ${DB_CONTAINER} psql -U ${PG_USER} -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${dbName(slug)}'"`,
	).pipe(Effect.map(out => out.trim() === '1'))

const createDatabase = (slug: string) =>
	Effect.gen(function* () {
		if (yield* databaseExists(slug)) return
		yield* dockerFail(
			exec(
				`docker exec ${DB_CONTAINER} psql -U ${PG_USER} -d postgres -c "CREATE DATABASE ${dbName(slug)}"`,
			),
		)
	})

// WITH (FORCE) (PG13+) terminates any open sessions so the drop can't hang.
const dropDatabase = (slug: string) =>
	dockerFail(
		exec(
			`docker exec ${DB_CONTAINER} psql -U ${PG_USER} -d postgres -c "DROP DATABASE IF EXISTS ${dbName(slug)} WITH (FORCE)"`,
		),
	)

// The minio/mc image's entrypoint is `mc` itself, so override it with a shell
// (as the storage-init sidecar does) to set the alias then run one command,
// reaching the shared MinIO over the compose network.
const mcScript = (command: string) =>
	`docker run --rm --network ${STORAGE_NETWORK} --entrypoint /bin/sh minio/mc:latest -c "mc alias set local http://storage:9000 batuda batuda-secret >/dev/null 2>&1 && ${command}"`

const mc = (command: string) => dockerFail(exec(mcScript(command)))
const mcCapture = (command: string) => execSilent(mcScript(command))

// The shared containers may have only just started, so give Postgres/MinIO a few
// seconds to accept connections before the create succeeds.
const settle = <A, E, R>(self: Effect.Effect<A, E, R>) =>
	self.pipe(Effect.retry(Schedule.spaced('2 seconds').pipe(Schedule.take(5))))

// `git worktree list` includes the main checkout; slugifying every branch the
// same way the up path does means a live worktree's data is never swept.
const liveWorktreeSlugs = execSilent(
	'git',
	'worktree',
	'list',
	'--porcelain',
).pipe(
	Effect.map(out => {
		const slugs = new Set<string>()
		for (const line of out.split('\n')) {
			const m = line.match(/^branch refs\/heads\/(.+)$/)
			if (m?.[1]) slugs.add(slugify(m[1].replace(/^worktree-/, '')))
		}
		return slugs
	}),
)

const listDatabases = execSilent(
	`docker exec ${DB_CONTAINER} psql -U ${PG_USER} -d postgres -tAc "SELECT datname FROM pg_database WHERE datname LIKE 'batuda%'"`,
).pipe(
	Effect.map(out =>
		out
			.split('\n')
			.map(s => s.trim())
			.filter(Boolean),
	),
)

const listBuckets = mcCapture('mc ls local --json').pipe(
	Effect.map(out =>
		out
			.split('\n')
			.filter(Boolean)
			.flatMap(line => {
				try {
					const key = (JSON.parse(line) as { key?: string }).key
					return key ? [key.replace(/\/$/, '')] : []
				} catch {
					return []
				}
			}),
	),
)

// Pure: from the databases + buckets that exist and the slugs of currently
// checked-out worktrees, return the slugs whose data no live worktree owns. The
// main checkout's `batuda` database / `batuda-assets` bucket lack the suffix, so
// they're never matched.
const findOrphanSlugs = (
	dbNames: readonly string[],
	bucketNames: readonly string[],
	liveSlugs: ReadonlySet<string>,
): string[] => {
	const fromDbs = dbNames
		.filter(n => n.startsWith('batuda_'))
		.map(n => n.slice('batuda_'.length).replace(/_/g, '-'))
	const fromBuckets = bucketNames
		.filter(n => n.startsWith('batuda-assets-'))
		.map(n => n.slice('batuda-assets-'.length))
	const slugs = new Set([...fromDbs, ...fromBuckets])
	// Drop empty slugs so a bare `batuda_` / `batuda-assets-` (e.g. main) is never swept.
	return [...slugs].filter(s => s.length > 0 && !liveSlugs.has(s))
}

// True only when the shared Postgres answers — the cheapest "is the stack up?"
// probe. Any docker/connection error folds into `false`.
const stackReachable = execSilent(
	`docker exec ${DB_CONTAINER} psql -U ${PG_USER} -d postgres -tAc "SELECT 1"`,
).pipe(
	Effect.map(out => out.trim() === '1'),
	Effect.catch(() => Effect.succeed(false)),
)

// How many public tables a database has — 0 means it exists but isn't migrated.
const tableCount = (db: string) =>
	execSilent(
		`docker exec ${DB_CONTAINER} psql -U ${PG_USER} -d ${db} -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"`,
	).pipe(
		Effect.map(out => Number(out.trim()) || 0),
		Effect.catch(() => Effect.succeed(0)),
	)

// Parse `git worktree list --porcelain` into one entry per worktree; `branch` is
// null for a detached HEAD (which the provisioning flow never targets).
const parseWorktrees = (
	porcelain: string,
): Array<{ path: string; branch: string | null }> => {
	const entries: Array<{ path: string; branch: string | null }> = []
	let path = ''
	let branch: string | null = null
	const flush = () => {
		if (path) entries.push({ path, branch })
		path = ''
		branch = null
	}
	for (const line of porcelain.split('\n')) {
		if (line.startsWith('worktree ')) {
			flush()
			path = line.slice('worktree '.length)
		} else if (line.startsWith('branch refs/heads/')) {
			branch = line.slice('branch refs/heads/'.length)
		}
	}
	flush()
	return entries
}

export const worktreeUp = Effect.gen(function* () {
	if (!(yield* isLinkedWorktree)) {
		return yield* Effect.fail(
			new Error(
				'Not in a worktree. Use `pnpm cli services up` for the main checkout’s shared stack.',
			),
		)
	}
	const main = yield* mainCheckoutRoot()
	const slug = yield* slugForCurrentWorktree

	yield* Effect.logInfo('Ensuring the shared stack is up…')
	yield* ensureSharedStack

	yield* Effect.logInfo(
		`Provisioning database ${dbName(slug)} + bucket ${bucketName(slug)}…`,
	)
	yield* settle(createDatabase(slug))
	yield* settle(mc(`mc mb --ignore-existing local/${bucketName(slug)}`))

	yield* writeWorktreeEnv(main, slug)
	// Make the just-written values visible to this process + every subprocess
	// (migrate/seed) it spawns, so they target this worktree's database, not main's.
	for (const [k, v] of Object.entries(envOverrides(slug))) process.env[k] = v

	yield* Effect.logInfo('Running migrations…')
	yield* settle(dbMigrate)
	yield* Effect.logInfo('Seeding…')
	yield* execIn(ROOT, 'pnpm', 'cli', 'seed', '--preset', 'minimal')

	const branch = yield* branchName
	yield* Console.log(
		[
			'',
			'✓ Worktree ready inside the shared stack',
			`  Database:  ${dbName(slug)}  (postgresql://batuda:batuda@localhost:5433/${dbName(slug)})`,
			`  Bucket:    ${bucketName(slug)}  (MinIO http://localhost:9001, batuda / batuda-secret)`,
			'  Mailpit:   http://localhost:8025  (shared across worktrees)',
			`  Run \`pnpm dev\` → portless serves https://${branch}.batuda.localhost`,
			'',
		].join('\n'),
	)
})

export const worktreeDown = Effect.gen(function* () {
	if (!(yield* isLinkedWorktree)) {
		return yield* Effect.fail(
			new Error('Not in a worktree — refusing to drop the shared database.'),
		)
	}
	const slug = yield* slugForCurrentWorktree
	yield* Effect.logInfo(
		`Dropping database ${dbName(slug)} + bucket ${bucketName(slug)}…`,
	)
	yield* dropDatabase(slug)
	// The bucket may already be gone (or never created) — don't fail teardown on it.
	yield* mc(`mc rb --force local/${bucketName(slug)}`).pipe(
		Effect.catch(() => Effect.void),
	)
	yield* Console.log(
		`✓ Removed ${dbName(slug)} and ${bucketName(slug)} (shared stack untouched).`,
	)
})

export const worktreePrune = Effect.gen(function* () {
	const dbNames = yield* listDatabases
	const bucketNames = yield* listBuckets
	const liveSlugs = yield* liveWorktreeSlugs
	const orphans = findOrphanSlugs(dbNames, bucketNames, liveSlugs)

	if (orphans.length === 0) {
		yield* Console.log('No orphaned worktree data — nothing to prune.')
		return
	}

	yield* Effect.logInfo(
		`Pruning ${orphans.length} orphaned worktree(s): ${orphans.join(', ')}…`,
	)
	for (const slug of orphans) {
		yield* dropDatabase(slug)
		yield* mc(`mc rb --force local/${bucketName(slug)}`).pipe(
			Effect.catch(() => Effect.void),
		)
	}
	yield* Console.log(
		`✓ Pruned ${orphans.length} orphaned worktree(s): ${orphans.join(', ')}.`,
	)
})

export const worktreeLs = Effect.gen(function* () {
	const porcelain = yield* execSilent('git', 'worktree', 'list', '--porcelain')
	const main = yield* mainCheckoutRoot()
	const dbs = new Set(yield* listDatabases)
	const buckets = new Set(yield* listBuckets)

	const rows = parseWorktrees(porcelain).map(e => {
		// The main checkout owns the unsuffixed `batuda` database/bucket; every
		// linked worktree owns its `batuda_<slug>` / `batuda-assets-<slug>` pair.
		const isMain = resolve(e.path) === resolve(main)
		const branch = e.branch ?? '(detached)'
		const slug = e.branch ? slugify(e.branch.replace(/^worktree-/, '')) : ''
		const db = isMain ? 'batuda' : dbName(slug)
		const bucket = isMain ? 'batuda-assets' : bucketName(slug)
		const provisioned = dbs.has(db) && buckets.has(bucket)
		const url = isMain
			? 'https://batuda.localhost'
			: e.branch
				? `https://${e.branch}.batuda.localhost`
				: '—'
		return { branch, db, url, provisioned }
	})

	const branchWidth = Math.max(
		...rows.map(r => r.branch.length),
		'BRANCH'.length,
	)
	const dbWidth = Math.max(...rows.map(r => r.db.length), 'DATABASE'.length)
	yield* Console.log('')
	yield* Console.log(
		`  ${'BRANCH'.padEnd(branchWidth)}  ${'DATABASE'.padEnd(dbWidth)}  URL`,
	)
	for (const r of rows) {
		// ✓ = its database + bucket both exist; · = not provisioned yet.
		const mark = r.provisioned ? '✓' : '·'
		yield* Console.log(
			`${mark} ${r.branch.padEnd(branchWidth)}  ${r.db.padEnd(dbWidth)}  ${r.url}`,
		)
	}
	yield* Console.log('')
})

export const worktreeDoctor = Effect.gen(function* () {
	const checks: Array<{ ok: boolean; name: string; detail: string }> = []

	const stackOk = yield* stackReachable
	checks.push({
		ok: stackOk,
		name: 'shared stack',
		detail: stackOk
			? 'Postgres reachable (batuda-db)'
			: 'down — run `pnpm cli services up`',
	})

	if (!(yield* isLinkedWorktree)) {
		checks.push({
			ok: true,
			name: 'worktree',
			detail: 'main checkout — uses the shared `batuda` database',
		})
	} else {
		const slug = yield* slugForCurrentWorktree
		const db = dbName(slug)
		const dbOk = stackOk ? yield* databaseExists(slug) : false
		checks.push({
			ok: dbOk,
			name: 'database',
			detail: dbOk ? db : `${db} missing — run \`pnpm cli worktree up\``,
		})

		const tables = dbOk ? yield* tableCount(db) : 0
		checks.push({
			ok: tables > 0,
			name: 'migrations',
			detail:
				tables > 0 ? `${tables} tables` : 'none — run `pnpm cli worktree up`',
		})

		const bucket = bucketName(slug)
		let bucketOk = false
		if (stackOk) bucketOk = new Set(yield* listBuckets).has(bucket)
		checks.push({
			ok: bucketOk,
			name: 'bucket',
			detail: bucketOk
				? bucket
				: `${bucket} missing — run \`pnpm cli worktree up\``,
		})

		const branch = yield* branchName
		checks.push({
			ok: true,
			name: 'url',
			detail: `https://${branch}.batuda.localhost (run \`pnpm dev\`)`,
		})
	}

	const w = Math.max(...checks.map(c => c.name.length))
	yield* Console.log('')
	for (const c of checks) {
		yield* Console.log(`  ${c.ok ? '✓' : '✗'} ${c.name.padEnd(w)}  ${c.detail}`)
	}
	yield* Console.log('')
})
