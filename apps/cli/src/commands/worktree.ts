import { createHash } from 'node:crypto'
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

// portless routes each worktree by the branch's LAST path segment — `ui/foo` and a
// plain `foo` both serve `foo.batuda.localhost` — lowercased to a DNS label, with a
// short hash appended past 63 chars. We mirror that derivation exactly so the host
// we print is the host portless serves, and we key this worktree's database +
// bucket off the SAME label so the URL and the data behind it can't drift apart.
const MAX_DNS_LABEL = 63
// A bucket name caps at 63 chars and ours carries a `batuda-assets-` (14) prefix, so
// the shared slug is bounded to 49 — also safe for the `batuda_` database prefix.
const MAX_SLUG = 49

const dnsLabel = (raw: string, max: number): string => {
	const sane = raw
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, '-')
		.replace(/-{2,}/g, '-')
		.replace(/^-+|-+$/g, '')
	if (sane.length <= max) return sane
	// Too long: keep a unique tail by appending a short hash. Trim by 7 to leave
	// room for the 6-char hash plus the hyphen that joins it.
	const hash = createHash('sha256').update(sane).digest('hex').slice(0, 6)
	return `${sane.slice(0, max - 7).replace(/-+$/, '')}-${hash}`
}

const branchLabel = (branch: string) => branch.split('/').pop() ?? branch

// The subdomain portless actually serves for this branch (capped at 63 as it does).
const branchHost = (branch: string) =>
	`${dnsLabel(branchLabel(branch), MAX_DNS_LABEL)}.batuda.localhost`

// Names this worktree's database + bucket — the same label as the host, capped
// tighter so both identifiers stay valid.
const slugForBranch = (branch: string) =>
	dnsLabel(branchLabel(branch), MAX_SLUG)

// Postgres identifiers can't contain hyphens unquoted, so the database name uses
// underscores; S3 bucket names can't contain underscores, so the bucket keeps
// hyphens. Both derive from the one slug so they stay paired per worktree.
const dbName = (slug: string) => `batuda_${slug.replace(/-/g, '_')}`
const bucketName = (slug: string) => `batuda-assets-${slug}`

// A worktree's real database + bucket, read from the `.env` it generated at
// provision time. That file is the stable record of what `up` actually created;
// the live branch is not, because `gh pr merge --delete-branch` checks `main`
// out into the worktree after a merge — re-deriving a slug from the branch then
// targets the wrong data (or the main checkout's). `down`/`doctor`/`ls`/`prune`
// therefore key off the `.env`; only the portless URL still follows the branch
// (portless does route by the live branch).
const identityFromEnv = (
	envPath: string,
): { db: string; bucket: string } | null => {
	if (!existsSync(envPath)) return null
	const body = readFileSync(envPath, 'utf-8')
	const url = body.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim()
	const bucket = body.match(/^STORAGE_BUCKET=(.+)$/m)?.[1]?.trim()
	// Last path segment of the DB URL, with any `?sslmode=…` query stripped.
	const db = url?.match(/\/([^/?]+)(?:\?|$)/)?.[1]
	return db && bucket ? { db, bucket } : null
}

// Guard for destructive ops: only a suffixed `batuda_<slug>` / `batuda-assets-<slug>`
// pair belongs to a worktree. The main checkout's bare `batuda` / `batuda-assets`
// must never be dropped, so anything without the suffix is refused.
const isWorktreeOwned = (db: string, bucket: string) =>
	db.startsWith('batuda_') && bucket.startsWith('batuda-assets-')

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

const slugForCurrentWorktree = branchName.pipe(Effect.map(slugForBranch))

// Only the worktree's own database and bucket differ from main; the shared
// endpoints (Postgres host/port, MinIO, GreenMail) are inherited as-is.
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
// goes through the shared db container's `postgres` maintenance database. These
// take the resolved database NAME (not a slug): `up` derives it from the branch
// slug, while `down`/`prune` read it from the worktree's `.env`.
const databaseExists = (db: string) =>
	execSilent(
		`docker exec ${DB_CONTAINER} psql -U ${PG_USER} -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${db}'"`,
	).pipe(Effect.map(out => out.trim() === '1'))

const createDatabase = (db: string) =>
	Effect.gen(function* () {
		if (yield* databaseExists(db)) return
		yield* dockerFail(
			exec(
				`docker exec ${DB_CONTAINER} psql -U ${PG_USER} -d postgres -c "CREATE DATABASE ${db}"`,
			),
		)
	})

// WITH (FORCE) (PG13+) terminates any open sessions so the drop can't hang.
const dropDatabase = (db: string) =>
	dockerFail(
		exec(
			`docker exec ${DB_CONTAINER} psql -U ${PG_USER} -d postgres -c "DROP DATABASE IF EXISTS ${db} WITH (FORCE)"`,
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

// Each live worktree's real database + bucket, read from its generated `.env`.
// Keyed off `.env`, not the branch, so a live worktree whose branch was swapped
// (gh checking `main` out into it after a merge) is still recognised as owning
// its data — otherwise prune would reap a live worktree's database.
const liveOwnedResources = execSilent(
	'git',
	'worktree',
	'list',
	'--porcelain',
).pipe(
	Effect.map(out => {
		const dbs = new Set<string>()
		const buckets = new Set<string>()
		for (const entry of parseWorktrees(out)) {
			const id = identityFromEnv(resolve(entry.path, '.env'))
			if (id) {
				dbs.add(id.db)
				buckets.add(id.bucket)
			}
		}
		return { dbs, buckets }
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

// Existing suffixed resources that no live worktree owns. The bare `batuda` /
// `batuda-assets` (the main checkout) don't carry the `_`/`-` suffix the prefix
// requires, so they can never be selected.
const findOrphans = (
	existing: readonly string[],
	owned: ReadonlySet<string>,
	prefix: string,
): string[] =>
	existing.filter(name => name.startsWith(prefix) && !owned.has(name))

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
	yield* settle(createDatabase(dbName(slug)))
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
			'  Mail catcher: http://localhost:8025  (GreenMail, shared across worktrees)',
			`  Run \`pnpm dev\` → portless serves https://${branchHost(branch)}`,
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
	// Read the data this worktree actually provisioned from its `.env`, never the
	// live branch — after a `gh pr merge --delete-branch` the branch is `main`,
	// so a branch-derived slug would miss the real database (or hit main's).
	const identity = identityFromEnv(resolve(ROOT, '.env'))
	if (!identity) {
		return yield* Effect.fail(
			new Error(
				'No provisioned .env here — nothing to drop. Run `pnpm cli worktree up` first, or it was already torn down.',
			),
		)
	}
	const { db, bucket } = identity
	if (!isWorktreeOwned(db, bucket)) {
		return yield* Effect.fail(
			new Error(
				`This worktree's .env points at ${db} / ${bucket}, which look like the main checkout's shared data — refusing to drop. The worktree overrides were never written.`,
			),
		)
	}
	yield* Effect.logInfo(`Dropping database ${db} + bucket ${bucket}…`)
	yield* dropDatabase(db)
	// The bucket may already be gone (or never created) — don't fail teardown on it.
	yield* mc(`mc rb --force local/${bucket}`).pipe(
		Effect.catch(() => Effect.void),
	)
	yield* Console.log(`✓ Removed ${db} and ${bucket} (shared stack untouched).`)
})

// Dry-run by default: list the orphans and stop. `--yes` is required to drop,
// so prune can never silently delete data — and because ownership is read from
// each live worktree's `.env`, a worktree whose branch was swapped is never
// mistaken for an orphan.
export const worktreePrune = (apply: boolean) =>
	Effect.gen(function* () {
		const owned = yield* liveOwnedResources
		const orphanDbs = findOrphans(yield* listDatabases, owned.dbs, 'batuda_')
		const orphanBuckets = findOrphans(
			yield* listBuckets,
			owned.buckets,
			'batuda-assets-',
		)

		if (orphanDbs.length === 0 && orphanBuckets.length === 0) {
			yield* Console.log('No orphaned worktree data — nothing to prune.')
			return
		}

		yield* Console.log('')
		yield* Console.log('Orphaned worktree data (no live worktree owns it):')
		for (const db of orphanDbs) yield* Console.log(`  database  ${db}`)
		for (const bucket of orphanBuckets)
			yield* Console.log(`  bucket    ${bucket}`)
		yield* Console.log('')

		if (!apply) {
			yield* Console.log(
				'Dry run — re-run with `--yes` to drop the above. (The main `batuda` / `batuda-assets` are never listed.)',
			)
			return
		}

		for (const db of orphanDbs) yield* dropDatabase(db)
		for (const bucket of orphanBuckets) {
			yield* mc(`mc rb --force local/${bucket}`).pipe(
				Effect.catch(() => Effect.void),
			)
		}
		yield* Console.log(
			`✓ Pruned ${orphanDbs.length} database(s) + ${orphanBuckets.length} bucket(s).`,
		)
	})

export const worktreeLs = Effect.gen(function* () {
	const porcelain = yield* execSilent('git', 'worktree', 'list', '--porcelain')
	const main = yield* mainCheckoutRoot()
	const dbs = new Set(yield* listDatabases)
	const buckets = new Set(yield* listBuckets)

	const rows = parseWorktrees(porcelain).map(e => {
		// The main checkout owns the unsuffixed `batuda` database/bucket; every
		// linked worktree owns whatever its `.env` records — read that rather than
		// re-derive from the branch, which drifts once gh checks out main.
		const isMain = resolve(e.path) === resolve(main)
		const branch = e.branch ?? '(detached)'
		const identity = isMain ? null : identityFromEnv(resolve(e.path, '.env'))
		const db = isMain ? 'batuda' : (identity?.db ?? '—')
		const bucket = isMain ? 'batuda-assets' : identity?.bucket
		const provisioned =
			bucket !== undefined && dbs.has(db) && buckets.has(bucket)
		const url = isMain
			? 'https://batuda.localhost'
			: e.branch
				? `https://${branchHost(e.branch)}`
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
		// Identity from the worktree's own `.env` — the branch is unreliable after
		// a merge swaps it to main.
		const identity = identityFromEnv(resolve(ROOT, '.env'))
		if (!identity) {
			checks.push({
				ok: false,
				name: 'database',
				detail: 'no .env — run `pnpm cli worktree up`',
			})
		} else {
			const { db, bucket } = identity
			const dbOk = stackOk ? yield* databaseExists(db) : false
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

			let bucketOk = false
			if (stackOk) bucketOk = new Set(yield* listBuckets).has(bucket)
			checks.push({
				ok: bucketOk,
				name: 'bucket',
				detail: bucketOk
					? bucket
					: `${bucket} missing — run \`pnpm cli worktree up\``,
			})
		}

		const branch = yield* branchName
		checks.push({
			ok: true,
			name: 'url',
			detail: `https://${branchHost(branch)} (run \`pnpm dev\`)`,
		})
	}

	const w = Math.max(...checks.map(c => c.name.length))
	yield* Console.log('')
	for (const c of checks) {
		yield* Console.log(`  ${c.ok ? '✓' : '✗'} ${c.name.padEnd(w)}  ${c.detail}`)
	}
	yield* Console.log('')
})
