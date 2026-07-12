import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'

import { Console, Effect, Schedule } from 'effect'

import {
	fillMissingFromExample,
	mergeEnvOverrides,
	missingEnvEntries,
	tryFs,
} from '../lib/env-file'
import {
	exec,
	execArgs,
	execIn,
	execSilent,
	execSilentArgs,
	ROOT,
} from '../shell'
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

// portless binds 443 when it can, else a non-privileged fallback (e.g. 1355).
// A URL printed without that port gives ERR_CONNECTION_REFUSED, so append it.
// `~/.portless/proxy.port` is the canonical source (the same one /debug-apps reads).
const portSuffix = (): string => {
	try {
		const port = readFileSync(
			resolve(homedir(), '.portless/proxy.port'),
			'utf8',
		).trim()
		return port && port !== '443' ? `:${port}` : ''
	} catch {
		return ''
	}
}

const branchUrl = (branch: string) =>
	`https://${branchHost(branch)}${portSuffix()}`

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

// Whether the current checkout is a linked worktree (vs the main checkout),
// together with the main checkout's path — computed together so a caller that
// needs both (provisioning, teardown) doesn't shell out to git twice for it.
export const worktreeContext = Effect.gen(function* () {
	const gitDir = yield* execSilent(
		'git',
		'rev-parse',
		'--path-format=absolute',
		'--absolute-git-dir',
	)
	const main = yield* mainCheckoutRoot()
	// In the main checkout gitDir is `<main>/.git`; in a linked worktree it is
	// `<main>/.git/worktrees/<name>`, so it sits below the common `.git`.
	const isLinked = gitDir !== resolve(main, '.git')
	return { isLinked, main }
})

export const isLinkedWorktree = worktreeContext.pipe(
	Effect.map(c => c.isLinked),
)

const workingTreeClean = execSilent('git', 'status', '--porcelain').pipe(
	Effect.map(out => out.trim() === ''),
)

const branchExists = (branch: string) =>
	execSilent(
		'git',
		'show-ref',
		'--verify',
		'--quiet',
		`refs/heads/${branch}`,
	).pipe(
		Effect.map(() => true),
		Effect.orElseSucceed(() => false),
	)

const branchName = execSilent('git', 'rev-parse', '--abbrev-ref', 'HEAD')

const slugForCurrentWorktree = branchName.pipe(Effect.map(slugForBranch))

// Only the worktree's own database and bucket differ from main; the shared
// endpoints (Postgres host/port, MinIO, GreenMail) are inherited as-is.
const envOverridesForNames = (
	db: string,
	bucket: string,
): Record<string, string> => ({
	DATABASE_URL: `postgresql://batuda:batuda@localhost:5433/${db}`,
	STORAGE_BUCKET: bucket,
})

const envOverrides = (slug: string): Record<string, string> =>
	envOverridesForNames(dbName(slug), bucketName(slug))

// The files `writeWorktreeEnv` overrides, and which of the two keys each one
// actually receives — `setup` keys its own worktree-aware handling (which
// files to repair instead of template-copy, and which values to report for
// each) off this same list, so the two can't disagree about what's
// worktree-managed.
export const WORKTREE_ENV_FILES: ReadonlyArray<{
	path: string
	keys: readonly string[]
}> = [
	{ path: '.env', keys: ['DATABASE_URL', 'STORAGE_BUCKET'] },
	{ path: 'apps/cli/.env', keys: ['DATABASE_URL'] },
]

// Read the main checkout's .env files (the source of every shared value),
// apply the worktree overrides, and write the worktree's copies. Every source
// is checked for existence before any target is written, so a missing file
// can't leave the worktree with one target rewritten and the other untouched.
const writeWorktreeEnv = (
	mainRoot: string,
	overrides: Record<string, string>,
) =>
	Effect.gen(function* () {
		const targets = WORKTREE_ENV_FILES.map(f => ({
			path: f.path,
			from: resolve(mainRoot, f.path),
			to: resolve(ROOT, f.path),
			keys: f.keys,
		}))

		const missing = targets.filter(t => !existsSync(t.from))
		if (missing.length > 0) {
			return yield* Effect.fail(
				new Error(
					`No ${missing.map(t => t.from).join(', ')} in the main checkout — run \`pnpm cli setup\` there first.`,
				),
			)
		}

		// The committed template, the source of default values for any required key
		// the main checkout's `.env` never synced.
		const examplePath = resolve(ROOT, '.env.example')
		const exampleBody = existsSync(examplePath)
			? readFileSync(examplePath, 'utf-8')
			: undefined
		const filled: string[] = []

		for (const t of targets) {
			const base = readFileSync(t.from, 'utf-8')
			// Only the root `.env` is gap-filled against the template — `apps/cli/.env`
			// is a deliberately small subset, not a copy of the whole template.
			const source =
				t.path === '.env' && exampleBody !== undefined
					? fillMissingFromExample(base, exampleBody)
					: { body: base, filled: [] as string[] }
			filled.push(...source.filled)
			const subset = Object.fromEntries(
				t.keys.flatMap(k => {
					const v = overrides[k]
					return v === undefined ? [] : [[k, v] as const]
				}),
			)
			yield* tryFs(`write ${t.to}`, () =>
				writeFile(t.to, mergeEnvOverrides(source.body, subset)),
			)
		}
		return filled
	})

// Key names the committed .env.example declares but the local .env lacks. A
// worktree inherits its .env from the main checkout, so a key added to the
// template but not to that .env is missing here too — and the server reads it
// at boot and dies with a cryptic ConfigError. Surfacing the names turns that
// into a fixable hint.
const missingWorktreeEnvKeys = (): string[] => {
	const examplePath = resolve(ROOT, '.env.example')
	const envPath = resolve(ROOT, '.env')
	if (!existsSync(examplePath) || !existsSync(envPath)) return []
	return missingEnvEntries(
		readFileSync(examplePath, 'utf-8'),
		readFileSync(envPath, 'utf-8'),
	).map(e => e.key)
}

const dockerFail = <A, E, R>(self: Effect.Effect<A, E, R>) =>
	self.pipe(
		Effect.mapError(
			() => new Error('Docker command failed. Is Docker/OrbStack running?'),
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
//
// Falls back to `false` on any docker/connection error — same reasoning as
// `stackReachable`/`bucketExists` below: a transient failure here must not
// crash a caller that's only trying to decide whether a worktree is
// provisioned yet. `createDatabase`'s own `CREATE DATABASE` call still fails
// (and so still gets retried by its caller's `settle`) if the container
// genuinely isn't ready, so this fallback doesn't mask that case.
const databaseExists = (db: string) =>
	execSilent(
		`docker exec ${DB_CONTAINER} psql -U ${PG_USER} -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${db}'"`,
	).pipe(
		Effect.map(out => out.trim() === '1'),
		Effect.orElseSucceed(() => false),
	)

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

// Unlike `databaseExists`, MinIO is a separate service from the Postgres
// `stackReachable` probes — falls back to `false` on any docker/mc error so a
// bucket check can never itself crash a caller that's only trying to decide
// whether this worktree is provisioned yet.
const bucketExists = (bucket: string) =>
	listBuckets.pipe(
		Effect.map(names => names.includes(bucket)),
		Effect.orElseSucceed(() => false),
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
	Effect.orElseSucceed(() => false),
)

export type WorktreeEnvSync = {
	synced: boolean
	db: string
	bucket: string
	/** Set only when provisioned but the repair write itself failed. */
	error?: string
}

// A couple of short retries while the stack answers "not ready" instead of
// erroring outright — long enough to ride out a stack someone else (another
// worktree's session-start hook, a concurrent `services up`) started moments
// ago, short enough that `setup` still stays fast when the stack is genuinely
// down. `worktreeDoctor` calls the un-retried `stackReachable` directly since
// it should fail fast, not wait, when reporting the stack as down.
//
// `Effect.repeat({while, times, schedule})` looks like the purpose-built tool
// for "retry while this boolean is false," but its result is the *schedule's*
// output (an attempt count), not the wrapped effect's last value — confirmed
// empirically, not just from the docs. Converting the falsy result to a
// failure first (so plain `Effect.retry` retries it) keeps the original
// boolean as the actual success value.
const stackReachableSettled = stackReachable.pipe(
	Effect.flatMap(ok =>
		ok ? Effect.succeed(true) : Effect.fail(new Error('not ready')),
	),
	Effect.retry(Schedule.spaced('1 second').pipe(Schedule.take(2))),
	Effect.orElseSucceed(() => false),
)

// For `setup`, called only from inside a linked worktree: if this worktree's
// database + bucket already exist and are migrated, (re)write its `.env` +
// `apps/cli/.env` from the main checkout's real `.env` (at `main`) — the same
// thing `up` does, minus provisioning. Reports `synced: false` (and writes
// nothing) when the resources aren't ready yet, so `setup` can point the
// caller at `worktree up` instead of producing a `.env` that names data
// nothing created.
//
// Identity comes from the worktree's own `.env` when it already names a real,
// existing database/bucket — re-deriving from the current branch would target
// the wrong data once a merge swaps the branch to `main` before teardown runs
// (the same reasoning `identityFromEnv`'s other callers already follow). Only
// when `.env` can't name an identity at all (missing, or a blank
// `DATABASE_URL` — the exact corruption this command exists to repair) does
// it fall back to the branch-derived name.
export const syncWorktreeEnvIfProvisioned = (main: string) =>
	Effect.gen(function* () {
		const recorded = identityFromEnv(resolve(ROOT, '.env'))
		const fallbackSlug = yield* slugForCurrentWorktree
		const db = recorded?.db ?? dbName(fallbackSlug)
		const bucket = recorded?.bucket ?? bucketName(fallbackSlug)

		// Postgres and MinIO are independent services, so check both at once
		// once the stack itself answers — no point paying for either
		// individually if the stack isn't even up.
		const stackOk = yield* stackReachableSettled
		const [dbExists, bucketOk] = stackOk
			? yield* Effect.all([databaseExists(db), bucketExists(bucket)], {
					concurrency: 'unbounded',
				})
			: [false, false]
		const migrated = dbExists && (yield* tableCount(db)) > 0
		const provisioned = stackOk && dbExists && bucketOk && migrated

		if (!provisioned) {
			const result: WorktreeEnvSync = { synced: false, db, bucket }
			return result
		}

		const overrides = envOverridesForNames(db, bucket)
		const write: WorktreeEnvSync = yield* writeWorktreeEnv(
			main,
			overrides,
		).pipe(
			Effect.map(() => ({ synced: true as const, db, bucket })),
			Effect.catch(error =>
				Effect.succeed({
					synced: false as const,
					db,
					bucket,
					error: error.message,
				}),
			),
		)
		// Make the just-written values visible to this process + every
		// subprocess it spawns, so a follow-up command in the same process (the
		// TUI) targets this worktree's database, not a stale one from startup.
		if (write.synced) {
			for (const [k, v] of Object.entries(overrides)) process.env[k] = v
		}
		return write
	})

// How many public tables a database has — 0 means it exists but isn't migrated.
const tableCount = (db: string) =>
	execSilent(
		`docker exec ${DB_CONTAINER} psql -U ${PG_USER} -d ${db} -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"`,
	).pipe(
		Effect.map(out => Number(out.trim()) || 0),
		Effect.orElseSucceed(() => 0),
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
	const { isLinked, main } = yield* worktreeContext
	if (!isLinked) {
		return yield* Effect.fail(
			new Error(
				'Not in a worktree. Use `pnpm cli services up` for the main checkout’s shared stack.',
			),
		)
	}
	const slug = yield* slugForCurrentWorktree

	yield* Effect.logInfo('Ensuring the shared stack is up…')
	yield* ensureSharedStack

	yield* Effect.logInfo(
		`Provisioning database ${dbName(slug)} + bucket ${bucketName(slug)}…`,
	)
	yield* settle(createDatabase(dbName(slug)))
	yield* settle(mc(`mc mb --ignore-existing local/${bucketName(slug)}`))

	const overrides = envOverrides(slug)
	const filledEnv = yield* writeWorktreeEnv(main, overrides)
	// Make the just-written values visible to this process + every subprocess
	// (migrate/seed) it spawns, so they target this worktree's database, not main's.
	for (const [k, v] of Object.entries(overrides)) process.env[k] = v

	// A required key the inherited .env never carried was just filled from the
	// template's default so this worktree boots instead of dying at boot with a
	// bare "Expected string, got undefined". Name them so a non-default value can
	// be set deliberately when the default doesn't fit.
	if (filledEnv.length > 0) {
		yield* Effect.logInfo(
			`Filled ${filledEnv.length} key(s) missing from the inherited .env with .env.example defaults: ${filledEnv.join(', ')}. Set a value in the main checkout's .env if a default doesn't fit.`,
		)
	}

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
			`  Run \`pnpm dev\` → portless serves ${branchUrl(branch)}`,
			'',
		].join('\n'),
	)
})

// Stop any dev servers running inside this worktree before its data and
// directory go away — otherwise a server keeps running against a deleted
// checkout and holds its port. Delegates to the shared script (also called by
// the WorktreeRemove hook); the script is self-guarding and always exits 0, so
// this can never block teardown. `process.pid` is passed so the script won't
// signal the CLI running the teardown, whose own cwd is inside the worktree.
const stopWorktreeDevServers = (worktreePath: string) =>
	exec(
		`bash "${resolve(ROOT, 'scripts/worktree-stop-procs.sh')}" "${worktreePath}" ${process.pid}`,
	).pipe(Effect.catch(() => Effect.void))

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
	// Only now that teardown is actually going ahead — stop the worktree's dev
	// servers before its data + directory go away, not on a path that refuses.
	yield* stopWorktreeDevServers(ROOT)
	yield* Effect.logInfo(`Dropping database ${db} + bucket ${bucket}…`)
	yield* dropDatabase(db)
	// The bucket may already be gone (or never created) — don't fail teardown on it.
	yield* mc(`mc rb --force local/${bucket}`).pipe(
		Effect.catch(() => Effect.void),
	)
	yield* Console.log(`✓ Removed ${db} and ${bucket} (shared stack untouched).`)
})

export const worktreeDone = (options: { force: boolean; stash: boolean }) =>
	Effect.gen(function* () {
		const { force, stash } = options
		let didStash = false
		const clean = yield* workingTreeClean

		if (!clean) {
			if (stash) {
				yield* exec('git', 'stash', 'push', '-u', '-m', 'batuda-worktree-done')
				didStash = true
				yield* Console.log('✓ Stashed uncommitted changes')
			} else if (!force) {
				return yield* Effect.fail(
					new Error(
						'Working tree is not clean. Stash with --stash, commit manually, or pass --force to discard.',
					),
				)
			}
		}

		const { isLinked: linked, main: mainRoot } = yield* worktreeContext

		if (linked) {
			const branch = yield* branchName
			const worktreePath = resolve(
				yield* execSilent('git', 'rev-parse', '--show-toplevel'),
			)
			yield* Console.log(
				`Finishing linked worktree ${worktreePath} (branch ${branch})...`,
			)

			yield* worktreeDown

			// Move to the main checkout before deleting the worktree directory,
			// otherwise subsequent git commands would run from a deleted cwd.
			process.chdir(mainRoot)
			const removeArgs = force
				? ['worktree', 'remove', '--force', worktreePath]
				: ['worktree', 'remove', worktreePath]
			yield* execIn(mainRoot, 'git', ...removeArgs)
			yield* Console.log('✓ Removed linked worktree directory')

			yield* execIn(mainRoot, 'git', 'checkout', 'main')
			yield* execIn(mainRoot, 'git', 'pull', '--prune')

			if (yield* branchExists(branch)) {
				const deleteArgs = force
					? ['branch', '-D', branch]
					: ['branch', '-d', branch]
				yield* execIn(mainRoot, 'git', ...deleteArgs)
				yield* Console.log(`✓ Deleted local branch ${branch}`)
			}
		} else {
			const branch = yield* branchName
			if (branch === 'main') {
				return yield* Effect.fail(
					new Error(
						'Already on the main branch. Run this from a feature branch or linked worktree.',
					),
				)
			}
			yield* Console.log(`Finishing feature branch ${branch}...`)
			yield* exec('git', 'checkout', 'main')
			yield* exec('git', 'pull', '--prune')

			if (yield* branchExists(branch)) {
				const deleteArgs = force
					? ['branch', '-D', branch]
					: ['branch', '-d', branch]
				yield* exec('git', ...deleteArgs)
				yield* Console.log(`✓ Deleted local branch ${branch}`)
			}
		}

		yield* Console.log('✓ Done')

		if (didStash) {
			yield* exec('git', 'stash', 'pop')
			yield* Console.log('✓ Popped stash')
		}
	})

// Reap dev servers left behind by crashed sessions — those whose owning CLI is
// gone but whose port is still held. portless finds them from its own route
// registry, so the shared proxy (which is not a route) is never touched. Runs
// only on `--yes`; portless has no dry-run, and best-effort so it can't fail the
// prune.
const pruneOrphanDevServers = exec('pnpm exec portless prune').pipe(
	Effect.catch(() => Effect.void),
)

// Dry-run by default: list the orphans and stop. `--yes` is required to drop,
// so prune can never silently delete data — and because ownership is read from
// each live worktree's `.env`, a worktree whose branch was swapped is never
// mistaken for an orphan. Orphaned dev servers are reaped on `--yes` too.
export const worktreePrune = (apply: boolean) =>
	Effect.gen(function* () {
		// Three independent reads (git+fs, docker, mc) — no reason to pay for
		// them one after another.
		const { owned, databases, bucketList } = yield* Effect.all(
			{
				owned: liveOwnedResources,
				databases: listDatabases,
				bucketList: listBuckets,
			},
			{ concurrency: 'unbounded' },
		)
		const orphanDbs = findOrphans(databases, owned.dbs, 'batuda_')
		const orphanBuckets = findOrphans(
			bucketList,
			owned.buckets,
			'batuda-assets-',
		)
		const hasData = orphanDbs.length > 0 || orphanBuckets.length > 0

		if (hasData) {
			yield* Console.log('')
			yield* Console.log('Orphaned worktree data (no live worktree owns it):')
			for (const db of orphanDbs) yield* Console.log(`  database  ${db}`)
			for (const bucket of orphanBuckets)
				yield* Console.log(`  bucket    ${bucket}`)
			yield* Console.log('')
		} else {
			yield* Console.log('No orphaned worktree data.')
		}

		if (!apply) {
			// Orphaned dev servers can't be listed without stopping them (portless
			// has no dry-run), so name the action rather than the count.
			yield* Console.log(
				'Re-run with `--yes` to drop any listed data and stop dev servers orphaned by crashed sessions. (The main `batuda` / `batuda-assets` are never listed.)',
			)
			return
		}

		for (const db of orphanDbs) yield* dropDatabase(db)
		for (const bucket of orphanBuckets) {
			yield* mc(`mc rb --force local/${bucket}`).pipe(
				Effect.catch(() => Effect.void),
			)
		}
		// Reports its own result line for the dev-server side.
		yield* pruneOrphanDevServers
		yield* Console.log(
			`✓ Pruned ${orphanDbs.length} database(s) + ${orphanBuckets.length} bucket(s).`,
		)
	})

export const worktreeLs = Effect.gen(function* () {
	// Four independent reads (git metadata, docker, docker, mc) — no reason to
	// pay for them one after another.
	const { porcelain, main, databases, bucketList } = yield* Effect.all(
		{
			porcelain: execSilent('git', 'worktree', 'list', '--porcelain'),
			main: mainCheckoutRoot(),
			databases: listDatabases,
			bucketList: listBuckets,
		},
		{ concurrency: 'unbounded' },
	)
	const dbs = new Set(databases)
	const buckets = new Set(bucketList)

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
			? `https://batuda.localhost${portSuffix()}`
			: e.branch
				? branchUrl(e.branch)
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
			// Independent services, checked at once — the display order below
			// (database, migrations, bucket) is unaffected either way.
			const [dbOk, bucketOk] = stackOk
				? yield* Effect.all([databaseExists(db), bucketExists(bucket)], {
						concurrency: 'unbounded',
					})
				: [false, false]
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

			checks.push({
				ok: bucketOk,
				name: 'bucket',
				detail: bucketOk
					? bucket
					: `${bucket} missing — run \`pnpm cli worktree up\``,
			})

			// A .env missing keys that .env.example declares boots the server into a
			// cryptic ConfigError; name them here so the fix is obvious.
			const missingEnv = missingWorktreeEnvKeys()
			checks.push({
				ok: missingEnv.length === 0,
				name: 'env',
				detail:
					missingEnv.length === 0
						? 'has every key from .env.example'
						: `.env.example declares keys this .env lacks: ${missingEnv.join(', ')} — copy their values in or the server won't boot`,
			})
		}

		const branch = yield* branchName
		checks.push({
			ok: true,
			name: 'url',
			detail: `${branchUrl(branch)} (run \`pnpm dev\`)`,
		})
	}

	const w = Math.max(...checks.map(c => c.name.length))
	yield* Console.log('')
	for (const c of checks) {
		yield* Console.log(`  ${c.ok ? '✓' : '✗'} ${c.name.padEnd(w)}  ${c.detail}`)
	}
	yield* Console.log('')
})

// ── watch: one live browser window per worktree ──────────────
//
// `watch` opens THIS worktree's app in its own visible Chrome window, so a
// developer running several sessions at once can watch each one navigate the
// app side by side. The window is a per-worktree agent-browser session named
// after the branch, so it's identifiable at a glance and re-running `watch`
// reuses it instead of opening a second. A brand-new window is tiled into a free
// cell of a 2×2 grid so several fit on screen without stacking; a reused one is
// left where it was dragged. Teardown (`--stop`) closes only this worktree's
// window — never every session — so cleaning up one worktree can't kill
// another's live view.

// A readable, per-worktree window name (branch label, not an opaque hash) so
// the window is easy to spot; distinct per worktree, so parallel windows never
// collide.
const watchSessionName = (branch: string) => `ai-${slugForBranch(branch)}`

// The URL this checkout actually serves: a linked worktree is on its own
// <label>.batuda.localhost; the main checkout is on the bare batuda.localhost
// (portless routes it there, not to `main.batuda.localhost`).
const watchUrl = (isLinked: boolean, branch: string) =>
	isLinked ? branchUrl(branch) : `https://batuda.localhost${portSuffix()}`

// The browser windows currently alive, one name per line. `agent-browser session
// list` prints a header then `→ name` (focused) / `  name` (others); strip the
// markers. Best-effort — if agent-browser can't be reached, treat none as open.
const liveWatchSessions = execSilent('agent-browser session list').pipe(
	Effect.map(out =>
		out
			.split('\n')
			.map(line => line.replace(/^[→\s]+/, '').trim())
			.filter(name => name && name !== 'Active sessions:'),
	),
	Effect.orElseSucceed(() => [] as string[]),
)

// One cell of a 2×2 grid over the usable screen — the window bounds for `slot`.
// Past four windows the slots wrap and overlap (rare: more than four worktrees
// watched at once).
const gridCell = (screenW: number, screenH: number, slot: number) => {
	const cellW = Math.floor(screenW / 2)
	const cellH = Math.floor(screenH / 2)
	const cell = slot % 4
	return {
		left: (cell % 2) * cellW,
		top: Math.floor(cell / 2) * cellH,
		width: cellW,
		height: cellH,
	}
}

// Move a Chrome window to exact screen coordinates over the DevTools Protocol.
// agent-browser ignores Chrome's `--window-position` launch flags in headed mode,
// but `Browser.setWindowBounds` on the session's OWN debugger endpoint moves its
// window directly — so there's no ambiguity about which window belongs to which
// session. Resolves when the window has moved, rejects on any protocol error.
type CdpTarget = { type: string; targetId: string }
const cdpSetWindowBounds = (
	cdpUrl: string,
	bounds: { left: number; top: number; width: number; height: number },
): Promise<void> =>
	new Promise<void>((resolve, reject) => {
		const socket = new WebSocket(cdpUrl)
		const pending = new Map<
			number,
			{
				resolve: (value: Record<string, unknown>) => void
				reject: (error: Error) => void
			}
		>()
		let nextId = 0
		const finish = (error?: Error) => {
			clearTimeout(timer)
			socket.close()
			error ? reject(error) : resolve()
		}
		const timer = setTimeout(() => finish(new Error('CDP timed out')), 5000)
		const call = (method: string, params: Record<string, unknown> = {}) =>
			new Promise<Record<string, unknown>>((res, rej) => {
				const id = ++nextId
				pending.set(id, { resolve: res, reject: rej })
				socket.send(JSON.stringify({ id, method, params }))
			})
		socket.onmessage = event => {
			const message = JSON.parse(String(event.data)) as {
				id?: number
				result?: Record<string, unknown>
				error?: { message: string }
			}
			if (message.id === undefined) return
			const waiting = pending.get(message.id)
			if (!waiting) return
			pending.delete(message.id)
			if (message.error) waiting.reject(new Error(message.error.message))
			else waiting.resolve(message.result ?? {})
		}
		socket.onerror = () => finish(new Error('CDP socket error'))
		socket.onopen = () => {
			void (async () => {
				const targets = await call('Target.getTargets')
				const page = (targets['targetInfos'] as CdpTarget[] | undefined)?.find(
					target => target.type === 'page',
				)
				if (!page) throw new Error('no page target')
				const win = await call('Browser.getWindowForTarget', {
					targetId: page.targetId,
				})
				await call('Browser.setWindowBounds', {
					windowId: win['windowId'],
					bounds: { ...bounds, windowState: 'normal' },
				})
				finish()
			})().catch(finish)
		}
	})

// Tile a freshly-opened watch window into its grid cell. Reads the usable screen
// from the browser itself (cross-display, no OS permissions) and moves the window
// over CDP. Best-effort at every step: if the screen can't be read or the window
// can't be reached, it simply stays where Chrome put it and is arranged by hand.
const tileWindow = (session: string, slot: number) =>
	Effect.gen(function* () {
		const size = yield* execSilentArgs('agent-browser', [
			'--session',
			session,
			'eval',
			'screen.availWidth + "," + screen.availHeight',
		]).pipe(Effect.orElseSucceed(() => ''))
		const dims = size.replace(/"/g, '').split(',')
		const screenW = Number(dims[0])
		const screenH = Number(dims[1])
		if (!(screenW > 0 && screenH > 0)) return

		const cdpUrl = yield* execSilentArgs('agent-browser', [
			'--session',
			session,
			'get',
			'cdp-url',
		]).pipe(
			Effect.map(out => out.match(/ws:\/\/\S+/)?.[0] ?? ''),
			Effect.orElseSucceed(() => ''),
		)
		if (!cdpUrl) return

		yield* Effect.tryPromise(() =>
			cdpSetWindowBounds(cdpUrl, gridCell(screenW, screenH, slot)),
		).pipe(Effect.catch(() => Effect.void))
	})

export const worktreeWatch = (options: { stop: boolean }) =>
	Effect.gen(function* () {
		const { isLinked } = yield* worktreeContext
		const branch = yield* branchName
		const session = watchSessionName(branch)

		if (options.stop) {
			// Scoped to THIS worktree's window only — never `close --all`, which
			// would take down every other worktree's live window too. Closing a
			// window that was never opened is a no-op, not an error.
			yield* execArgs('agent-browser', ['--session', session, 'close']).pipe(
				Effect.catch(() => Effect.void),
			)
			yield* Console.log(
				`✓ Closed watch window ${session} (other worktrees untouched).`,
			)
			return
		}

		const target = watchUrl(isLinked, branch)
		// A window already up for this session is reused (and left where it was
		// dragged); a brand-new one is tiled below. Snapshot the open windows
		// before launching, so this window's grid slot is the count that preceded it.
		const openBefore = yield* liveWatchSessions
		const isNew = !openBefore.includes(session)

		// `open` launches a new headed window for this session, or re-points the
		// existing one — `--headed` is a no-op once the window is up, so the one
		// call both creates and reuses. Passed through `execArgs` (no shell) so the
		// derived name/URL can never be read as shell syntax.
		yield* execArgs('agent-browser', [
			'--session',
			session,
			'--headed',
			'open',
			`${target}/login`,
		])

		if (isNew) {
			// Only watch windows are named `ai-…`; other agent-browser sessions
			// don't count toward this window's grid slot.
			const slot = openBefore.filter(name => name.startsWith('ai-')).length
			yield* tileWindow(session, slot)
		}

		yield* Console.log(
			[
				'',
				`✓ Watching this worktree at ${target}`,
				`  Window:  ${session}  (a visible Chrome window — look for it on screen)`,
				'  Stop:    pnpm cli worktree watch --stop',
				'',
				'Run `pnpm dev` in this worktree if the window shows a connection error.',
				'',
			].join('\n'),
		)
	})
