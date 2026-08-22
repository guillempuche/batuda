import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
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
// Postgres caps identifiers at 63 bytes and `batuda_it__` takes 11, leaving 52 for a
// worktree-name-derived integration database. Mirrors scripts/integration-db.ts.
const MAX_IT_SUFFIX = 52

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

// The disposable integration-test database that belongs to a dev database:
// `batuda` -> `batuda_it`, `batuda_<slug>` -> `batuda_it__<slug>`. Kept in sync
// with scripts/integration-db.ts (the canonical rule the pre-push suite builds
// from; a pure string transform can't be shared across the CLI/scripts type-check
// boundary). The double underscore keeps it out of the dev-database namespace — a
// dev name never contains `__` because `dnsLabel` collapses runs of `-` before
// `dbName` maps `-` to `_` — so `down`/`prune` can drop and protect it without ever
// colliding with real dev data.
const integrationDbFromDevDb = (db: string): string =>
	db === 'batuda' ? 'batuda_it' : db.replace(/^batuda_/, 'batuda_it__')

// The other integration-test database a worktree can own. Before `up` writes an
// `.env` there is no dev database to derive from, so the pre-push suite names the
// database after the worktree's own directory instead — and a directory is only
// conventionally named for its branch, so that name and the `.env`-derived one
// above are usually different. A worktree that ran the suite before it was
// provisioned therefore has one of each: `down` drops both, and `prune` counts both
// as owned so it never reaps the database a live worktree is still testing against.
// Mirrors integrationDbFromWorktreeName in scripts/integration-db.ts.
const integrationDbFromWorktreeName = (name: string): string => {
	const suffix = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, MAX_IT_SUFFIX)
	return suffix ? `batuda_it__${suffix}` : 'batuda_it'
}

// A linked worktree's `.git` is a file reading `gitdir: <main>/.git/worktrees/<name>`.
// That registered name is what the suite keys off, and it is not always the directory
// basename — git appends a suffix when two worktrees would collide — so it is read
// here rather than guessed. Returns null for the main checkout, whose `.git` is a
// directory and whose integration database is the shared `batuda_it`.
const worktreeIntegrationDb = (worktreePath: string): string | null => {
	const dotGit = resolve(worktreePath, '.git')
	if (!existsSync(dotGit) || !statSync(dotGit).isFile()) return null
	const name = readFileSync(dotGit, 'utf-8').match(
		/\/worktrees\/([^/\s]+)\/?\s*$/,
	)?.[1]
	if (!name) return null
	const db = integrationDbFromWorktreeName(name)
	// A name with nothing alphanumeric in it sanitizes away to the bare
	// `batuda_it`, which is the MAIN checkout's integration-test database. Teardown
	// drops what this returns, so hand back nothing rather than a name that would
	// destroy another checkout's data.
	return db === 'batuda_it' ? null : db
}

// Last path segment of a `.env` DATABASE_URL — the database name, any `?sslmode=…`
// query stripped. The one place worktree.ts parses that URL; `identityFromEnv` and
// `dbFromEnv` share it (and scripts/integration-db.ts mirrors it) so the name the
// pre-push suite CREATEs and the one teardown DROPs can't drift.
const dbFromEnvBody = (body: string): string | undefined => {
	const url = body.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim()
	return url?.match(/\/([^/?]+)(?:\?|$)/)?.[1]
}

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
	const db = dbFromEnvBody(body)
	const bucket = body.match(/^STORAGE_BUCKET=(.+)$/m)?.[1]?.trim()
	return db && bucket ? { db, bucket } : null
}

// Just the dev database from a checkout's `.env`, without requiring STORAGE_BUCKET
// — so `prune` can keep this checkout's integration-test database owned (and safe
// from reaping) even when the `.env` is missing its bucket key.
const dbFromEnv = (envPath: string): string | null => {
	if (!existsSync(envPath)) return null
	return dbFromEnvBody(readFileSync(envPath, 'utf-8')) ?? null
}

// Guard for destructive ops: only a suffixed `batuda_<slug>` / `batuda-assets-<slug>`
// pair belongs to a worktree. The main checkout's bare `batuda` / `batuda-assets`
// must never be dropped, so anything without the suffix is refused — and `batuda_it`
// (the main checkout's integration-test database) is excluded too, so a stray `.env`
// naming it can't make teardown drop it.
const isWorktreeOwned = (db: string, bucket: string) =>
	db.startsWith('batuda_') &&
	db !== 'batuda_it' &&
	bucket.startsWith('batuda-assets-')

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

// The web + API URLs this checkout is actually reached on. The main checkout is
// served on the bare batuda.localhost / api.batuda.localhost; a linked worktree
// is on its own <label>.batuda.localhost / <label>.api.batuda.localhost, since
// portless routes both off the branch's last path segment. `seed` prints these
// as access hints, so deriving them here — the one place that already knows the
// worktree's host — stops the hints from naming main's URLs inside a worktree.
export const accessUrls = Effect.gen(function* () {
	const { isLinked } = yield* worktreeContext
	const branch = yield* branchName
	const suffix = portSuffix()
	const prefix = isLinked
		? `${dnsLabel(branchLabel(branch), MAX_DNS_LABEL)}.`
		: ''
	return {
		web: `https://${prefix}batuda.localhost${suffix}`,
		api: `https://${prefix}api.batuda.localhost${suffix}`,
	}
})

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
	self.pipe(
		Effect.retry(
			Schedule.spaced('2 seconds').pipe(Schedule.upTo({ times: 5 })),
		),
	)

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
			const envPath = resolve(entry.path, '.env')
			const id = identityFromEnv(envPath)
			if (id) {
				dbs.add(id.db)
				buckets.add(id.bucket)
			}
			// Own this checkout's integration-test database (`batuda_it` for main,
			// `batuda_it__<slug>` for a worktree) so `prune` never reaps a live one.
			// Keyed off the dev database alone — a `.env` missing STORAGE_BUCKET makes
			// `identityFromEnv` null, but the integration sibling must stay owned.
			const devDb = dbFromEnv(envPath)
			if (devDb?.startsWith('batuda')) dbs.add(integrationDbFromDevDb(devDb))
			// And the one it uses before it is provisioned, which is named after the
			// worktree rather than the dev database. Without this a live worktree that
			// ran the suite before `up` — or that never runs `up` at all — has its
			// integration database reported as orphaned and reaped out from under it.
			const beforeUp = worktreeIntegrationDb(entry.path)
			if (beforeUp) dbs.add(beforeUp)
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
	Effect.retry(Schedule.spaced('1 second').pipe(Schedule.upTo({ times: 2 }))),
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

	// `batuda_it` is reserved for the main checkout's integration-test database, so
	// a branch whose slug is exactly `it` would share that name — and the pre-push
	// suite's `db reset` would wipe this worktree's dev data. Refuse it (the only
	// reserved branch name, like `main`).
	if (dbName(slug) === 'batuda_it') {
		return yield* Effect.fail(
			new Error(
				'Branch slug `it` is reserved — its database would collide with the integration-test database `batuda_it`. Rename the branch.',
			),
		)
	}

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

/**
 * Drop this worktree's database and bucket, and say what was found here.
 *
 * Finding nothing to drop is an answer rather than a failure, because the two
 * callers want opposite things from it — `down` reports it, since asking to
 * drop data that is not there leaves the command with nothing it was asked for;
 * `done` notes it and keeps tidying, since a worktree that never needed a
 * database is still a worktree to finish.
 *
 * Two things still fail outright: a checkout that is not a worktree at all, and
 * one whose `.env` points at the shared data. Neither is an answer for a caller
 * to weigh up.
 */
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
	// The integration-test database named after this worktree rather than its dev
	// database — what the pre-push suite uses before `up` has written an `.env`.
	// Dropped on both paths below, because a worktree can hold one whether or not
	// it was ever provisioned, and nothing else will ever come back for it.
	const beforeUpDb = worktreeIntegrationDb(ROOT)
	if (!identity) {
		// Never provisioned, but the suite may still have run here and left its
		// database behind. Drop that rather than refusing and leaking it. Checked
		// for existence first so the line below reports what actually happened
		// instead of naming a database that was never there.
		//
		// Docker being off is not a reason to refuse either — a worktree that
		// provisioned nothing needs no shared stack to be finished. The cost is not
		// knowing whether a stray test database is sitting there, and `worktree
		// prune` comes back for one anyway.
		const databases = yield* listDatabases.pipe(
			Effect.orElseSucceed((): ReadonlyArray<string> => []),
		)
		const leftover =
			beforeUpDb && databases.includes(beforeUpDb) ? beforeUpDb : null
		if (leftover) {
			yield* stopWorktreeDevServers(ROOT)
			yield* dropDatabase(leftover)
			yield* Console.log(
				`✓ Removed ${leftover} (never provisioned — no dev database or bucket to drop).`,
			)
			return 'removed' as const
		}
		return 'nothing-provisioned' as const
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
	// Drop this worktree's integration-test databases too — the pre-push suite creates
	// them lazily (never recorded in `.env`); `IF EXISTS` no-ops if it never ran here.
	// Both names, because a worktree that ran the suite before it was provisioned owns
	// one keyed off its own directory as well as one keyed off its dev database.
	yield* dropDatabase(integrationDbFromDevDb(db))
	if (beforeUpDb && beforeUpDb !== integrationDbFromDevDb(db)) {
		yield* dropDatabase(beforeUpDb)
	}
	// The bucket may already be gone (or never created) — don't fail teardown on it.
	yield* mc(`mc rb --force local/${bucket}`).pipe(
		Effect.catch(() => Effect.void),
	)
	yield* Console.log(`✓ Removed ${db} and ${bucket} (shared stack untouched).`)
	return 'removed' as const
})

/**
 * What `worktree down` says when it finds nothing to drop.
 *
 * Said rather than failed over, because the state it was asked for — no
 * database and no bucket for this worktree — is the state it found. Teardown
 * here is idempotent the same way the rest of it is: databases go with `DROP
 * DATABASE IF EXISTS`, and the hook that tears a worktree down on removal
 * always exits happy. A second `down`, or one on a worktree that never had
 * anything, is worth a word and not an error.
 */
export const NOTHING_TO_DROP =
	'Nothing to drop — this worktree has no database or bucket of its own. Either `pnpm cli worktree up` never ran here, or it has already been torn down.'

/**
 * Whether everything this branch changed is already on main.
 *
 * Asked in three ways, because a merge leaves three different traces and each
 * one hides the others:
 *  - main can simply reach the branch, which is an ordinary merge or a
 *    fast-forward, and the only shape where the commits themselves survive;
 *  - every commit is on main under a new name, which is what replaying them one
 *    by one leaves — a rebase merge;
 *  - the whole branch is on main as a single commit, which is what squashing
 *    leaves.
 *
 * `git branch -d` answers only the first, so it refuses both of the others even
 * though the work is safe, and this repo merges by all three. It is also asked
 * a question nobody wants here: it accepts a branch merged into its own remote
 * copy, which says the work was pushed, not that it reached main.
 *
 * Any git failure while answering reads as "not already there", so a doubt
 * keeps the branch rather than deleting it.
 */
/**
 * The number of a merged pull request in what `gh pr list --json number` printed,
 * or null when it named none.
 *
 * Its own function so the shape can be read against real output without a network
 * or a signed-in `gh`: everything that decides whether a branch may be deleted
 * should be readable somewhere.
 */
export const mergedPullRequestIn = (printed: string): number | null => {
	try {
		const listed: unknown = JSON.parse(printed)
		if (!Array.isArray(listed)) return null
		const first: unknown = listed[0]
		if (first === null || typeof first !== 'object') return null
		const number = (first as { number?: unknown }).number
		return typeof number === 'number' ? number : null
	} catch {
		// Not JSON at all, which is what a `gh` that failed prints.
		return null
	}
}

/**
 * The `owner/name` GitHub knows a checkout as, read off the address its remote
 * was cloned from. Null when the address names no GitHub repository.
 *
 * Both the addresses git clones from are read — the `https://` one and the `git@`
 * one — and the `.git` some carry and some do not comes off either way.
 */
export const repositoryNameIn = (remoteAddress: string): string | null =>
	/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(
		remoteAddress.trim(),
	)?.[1] ?? null

/**
 * The pull request GitHub has already merged for this branch, or null.
 *
 * Asked before anything below, because it is the only exact answer to hand.
 * Everything below compares diffs, and a diff stops matching the moment main
 * gains a commit touching the same files: the rebase that merges the branch folds
 * that other commit into those files, so main genuinely carries the work while no
 * patch and no file on main is identical to the branch's. That is the ordinary
 * case on a repository anybody else is pushing to, and it left the refusal firing
 * on branches merged an hour earlier — which teaches the reader to reach for
 * --force, the one flag that deletes without looking.
 *
 * Anything that goes wrong — no `gh`, not signed in, nothing to reach — comes
 * back null, and the readings below answer instead. This is one more way to say
 * yes, never a new way to refuse.
 */
const mergedPullRequestFor = (root: string, branch: string) =>
	Effect.gen(function* () {
		// Named outright rather than left to `gh` to work out from a directory: the
		// teardown runs from wherever it was called, which is not always inside this
		// checkout.
		const remote = yield* execSilentArgs('git', [
			'-C',
			root,
			'remote',
			'get-url',
			'origin',
		])
		const repo = repositoryNameIn(remote)
		if (repo === null) return null
		return mergedPullRequestIn(
			yield* execSilentArgs('gh', [
				'pr',
				'list',
				'--repo',
				repo,
				'--head',
				branch,
				'--state',
				'merged',
				'--limit',
				'1',
				'--json',
				'number',
			]),
		)
	}).pipe(Effect.orElseSucceed((): number | null => null))

const branchWorkIsOnMain = (root: string, branch: string) =>
	Effect.gen(function* () {
		const git = (...args: ReadonlyArray<string>) =>
			execSilentArgs('git', ['-C', root, ...args])
		if ((yield* mergedPullRequestFor(root, branch)) !== null) return true
		const mainReachesIt = yield* git(
			'merge-base',
			'--is-ancestor',
			branch,
			'main',
		).pipe(
			Effect.map(() => true),
			Effect.orElseSucceed(() => false),
		)
		if (mainReachesIt) return true
		// `git cherry` marks a patch main already carries with "-", and one it is
		// missing with "+". Empty output means no commits to judge, which the
		// reachability question above has already settled.
		const oneByOne = yield* git('cherry', 'main', branch)
		if (
			oneByOne !== '' &&
			oneByOne.split('\n').every(line => line.startsWith('-'))
		) {
			return true
		}
		// The whole branch rolled up into one commit sitting where it forked, which
		// is the shape a squash merge leaves.
		const forkedAt = yield* git('merge-base', 'main', branch)
		const content = yield* git('rev-parse', `${branch}^{tree}`)
		// A loose commit that is never referenced, so it costs one object git
		// collects on its own; nothing points at it once this answer is read.
		const rolledUp = yield* git(
			'commit-tree',
			content,
			'-p',
			forkedAt,
			'-m',
			'rolled up to compare against main',
		)
		return (yield* git('cherry', 'main', rolledUp)).startsWith('-')
	}).pipe(Effect.orElseSucceed(() => false))

// Which working tree has main checked out, or null when none has. Git keeps a
// branch in one of them at a time, and that is what decides whether main's ref
// can be moved from here at all.
const worktreeHoldingMain = (root: string) =>
	execSilentArgs('git', ['-C', root, 'worktree', 'list', '--porcelain']).pipe(
		Effect.map(out => {
			let at: string | null = null
			for (const line of out.split('\n')) {
				if (line.startsWith('worktree ')) at = line.slice('worktree '.length)
				else if (line.trim() === 'branch refs/heads/main') return at
			}
			return null
		}),
		Effect.orElseSucceed((): string | null => null),
	)

// The remote main follows, so a clone that calls it something other than
// `origin` is still read from the place its own configuration names.
const remoteForMain = (root: string) =>
	execSilentArgs('git', [
		'-C',
		root,
		'config',
		'--get',
		'branch.main.remote',
	]).pipe(
		Effect.map(name => (name.trim() === '' ? 'origin' : name.trim())),
		Effect.orElseSucceed(() => 'origin'),
	)

// The failure in its own words, so git's account of what it could not do
// survives into the message wrapped around it. Checked rather than assumed,
// since what arrives here need not be an Error.
const reasonOf = (failure: unknown): string =>
	failure instanceof Error ? failure.message : String(failure)

/**
 * Bring main up to date without moving anybody's checkout.
 *
 * The main checkout is somewhere a person may be standing with work of their
 * own, and finishing a worktree is no reason to disturb it. Checking main out
 * there does one of two unhelpful things: git carries uncommitted edits across
 * when the two branches agree on the file, so the work quietly follows onto
 * main; or the branches differ, git refuses, and this run stops over something
 * that has nothing to do with the worktree being finished.
 *
 * So the remote is read the same way whatever the checkout is doing, and only
 * the last step differs: where main is the branch in hand it is moved forward
 * in place, and where it is not, its ref is moved on its own and no working
 * tree is touched at all.
 *
 * Every way of stopping says which one it was. Refusing to merge a main that
 * has wandered off from the remote is the whole point — a plain pull would
 * write a merge commit, silently, in the middle of a cleanup nobody asked to
 * change main — but being told that when the real trouble is a remote that
 * cannot be reached, or a main another worktree is holding, sends somebody
 * looking for a divergence that is not there.
 */
const catchMainUp = (root: string) =>
	Effect.gen(function* () {
		const wanderedOff = Effect.fail(
			new Error(
				'main could not be brought up to date by fast-forward, so nothing has been removed. Local main has most likely wandered off from the remote — compare them with `git log --oneline origin/main..main` and sort that out first.',
			),
		)
		const branchInHand = yield* execSilentArgs('git', [
			'-C',
			root,
			'rev-parse',
			'--abbrev-ref',
			'HEAD',
		]).pipe(Effect.orElseSucceed(() => ''))

		// Asked before anything is fetched, because a branch another working tree
		// holds cannot be moved however the fetch goes.
		if (branchInHand !== 'main') {
			const heldAt = yield* worktreeHoldingMain(root)
			if (heldAt !== null) {
				return yield* Effect.fail(
					new Error(
						`main is checked out at ${heldAt}, and git keeps a branch in one working tree at a time, so it cannot be moved from here. Nothing has been removed. Finish that worktree, or move it off main, and run this again.`,
					),
				)
			}
		}

		const remote = yield* remoteForMain(root)
		// The ordinary fetch, which brings every remote-tracking branch up to date
		// and drops the ones whose branches are gone. Naming a single branch here
		// instead would narrow what pruning covers to that branch, and the stale
		// ones would quietly pile up.
		yield* execArgs('git', ['-C', root, 'fetch', remote, '--prune']).pipe(
			Effect.catch(() =>
				Effect.fail(
					new Error(
						`${remote} could not be reached to bring main up to date, so nothing has been removed.`,
					),
				),
			),
		)
		yield* (
			branchInHand === 'main'
				? execArgs('git', [
						'-C',
						root,
						'merge',
						'--ff-only',
						`refs/remotes/${remote}/main`,
					])
				: // Moved from the copy just fetched, so there is no second trip to the
					// remote, and it stops rather than forcing when it cannot.
					execArgs('git', [
						'-C',
						root,
						'fetch',
						'.',
						`refs/remotes/${remote}/main:main`,
					])
		).pipe(Effect.catch(() => wanderedOff))
	})

/**
 * Refuse unless main carries a copy of this branch's work.
 *
 * Asked before anything is dropped or deleted, so a branch that has to be kept
 * costs the caller nothing: the worktree, its database and its directory are
 * all still there to go back to. Deleting a branch is the one step here nobody
 * can undo, and `branchWorkIsOnMain` is what decides whether main already has
 * what would be lost.
 */
const refuseUnlessWorkIsOnMain = (
	root: string,
	branch: string,
	force: boolean,
) =>
	Effect.gen(function* () {
		if (force || (yield* branchWorkIsOnMain(root, branch))) return
		return yield* Effect.fail(
			new Error(
				`Branch ${branch} holds work main carries no copy of, and GitHub has no merged pull request for it. Nothing has been removed. Look at it with \`git log main..${branch}\`, or at its pull request; then run again with --force if you are happy to lose it.`,
			),
		)
	})

/**
 * Delete the branch. Nothing is weighed up here — `refuseUnlessWorkIsOnMain`
 * has already decided, early enough that a refusal costs nothing.
 */
const deleteBranch = (root: string, branch: string) =>
	Effect.gen(function* () {
		yield* execArgs('git', ['-C', root, 'branch', '-D', branch])
		yield* Console.log(`✓ Deleted local branch ${branch}`)
	})

// The ignored things that come back on their own: build output, and the `.env`
// `worktree up` writes again. Losing those with the directory costs nobody
// anything, so they are the ones not worth naming. Matched anywhere in a path,
// since build output sits at every level of the tree.
const GENERATED_DIRS: ReadonlyArray<string> = [
	'node_modules/',
	'dist/',
	'.turbo/',
	'.wrangler/',
	'.vite/',
	'coverage/',
]

// The env file provisioning writes, which `worktree up` makes again. Matched
// whole: a `.env.cloud` or `.env.local` sitting beside it was written by hand
// and nothing brings it back, so it still gets named.
const isProvisionedEnv = (path: string): boolean =>
	path === '.env' || path.endsWith('/.env')

const handPlacedFiles = (worktreePath: string) =>
	execSilentArgs('git', [
		'-C',
		worktreePath,
		'status',
		'--porcelain',
		'--ignored',
	]).pipe(
		Effect.map(out =>
			out
				.split('\n')
				.filter(line => line.startsWith('!! '))
				.map(line => line.slice(3))
				.filter(
					path =>
						!isProvisionedEnv(path) &&
						!GENERATED_DIRS.some(known => path.includes(known)),
				),
		),
		Effect.orElseSucceed((): ReadonlyArray<string> => []),
	)

/**
 * Put back what `--stash` set aside, whether the rest of the run succeeded or
 * not. Anything that stops the run part-way otherwise leaves the changes in the
 * stash with nothing said, and a clean working tree reads as work that vanished.
 *
 * `entry` is the commit this run's stash was saved as, and it is applied by that
 * name rather than by taking whatever sits on top. The stash is shared by every
 * worktree of the repository, so with several sessions running at once the top
 * entry is often somebody else's — taking it would drop one branch's unfinished
 * work into another's tree and leave the owner's own entry behind.
 *
 * `stashedIn` is the directory the changes came from, which the linked-worktree
 * path deletes on its way through. Putting them back then would land one
 * branch's edits in the main checkout, so where the directory is gone they are
 * named and left where they are.
 */
const restoreStashed = (args: {
	readonly stashedIn: string
	readonly entry: string
}) =>
	Effect.gen(function* () {
		const { stashedIn, entry } = args
		if (!existsSync(stashedIn)) {
			yield* Console.log(
				`Uncommitted changes are still stashed — the worktree they came from is gone. Put them where you want them with \`git stash apply ${entry}\`.`,
			)
			return
		}
		const applied = yield* execArgs('git', [
			'-C',
			stashedIn,
			'stash',
			'apply',
			entry,
		]).pipe(
			Effect.map(() => true),
			Effect.orElseSucceed(() => false),
		)
		if (!applied) {
			// Half-applied: git writes what it can and leaves the rest as conflicts,
			// so saying the changes are merely "still saved" would describe a working
			// tree the caller does not have. The entry is deliberately left in place.
			return yield* Effect.fail(
				new Error(
					`The stashed changes would not go back on cleanly — this working tree now holds the conflicts. They are still saved as ${entry}: sort the conflicts out, or reset and re-apply with \`git stash apply ${entry}\`.`,
				),
			)
		}
		// Dropping takes a place in the list (`stash@{n}`), never a commit, so this
		// run's entry is looked up by the commit it was saved as: another session's
		// entry may have arrived on top since, and dropping the top one would throw
		// away their work.
		const stashList = yield* execSilentArgs('git', [
			'-C',
			stashedIn,
			'stash',
			'list',
			'--format=%H %gd',
		])
		const position = stashList
			.split('\n')
			.find(line => line.startsWith(entry))
			?.split(' ')[1]
		if (position !== undefined) {
			yield* execArgs('git', ['-C', stashedIn, 'stash', 'drop', position])
		}
		yield* Console.log('✓ Popped stash')
	})

export const worktreeDone = (options: { force: boolean; stash: boolean }) =>
	Effect.gen(function* () {
		const { force, stash } = options
		// Where the stash came from and what it was saved as, both read while this
		// run is still standing in the worktree — the linked-worktree path moves to
		// the main checkout and deletes that directory, so by the end there is
		// nobody left to ask, and the shared stash may have gained another session's
		// entry on top.
		let stashed: { readonly stashedIn: string; readonly entry: string } | null =
			null
		const clean = yield* workingTreeClean

		if (!clean) {
			if (stash) {
				const takenFrom = resolve(
					yield* execSilent('git', 'rev-parse', '--show-toplevel'),
				)
				yield* exec('git', 'stash', 'push', '-u', '-m', 'batuda-worktree-done')
				// Read only once the push went through, so a stash that was never made
				// leaves nothing to put back.
				stashed = {
					stashedIn: takenFrom,
					entry: yield* execSilent('git', 'rev-parse', 'refs/stash'),
				}
				yield* Console.log('✓ Stashed uncommitted changes')
			} else if (!force) {
				return yield* Effect.fail(
					new Error(
						'Working tree is not clean. Stash with --stash, commit manually, or pass --force to discard.',
					),
				)
			}
		}

		const finish = Effect.gen(function* () {
			const { isLinked: linked, main: mainRoot } = yield* worktreeContext

			if (linked) {
				const branch = yield* branchName
				const worktreePath = resolve(
					yield* execSilent('git', 'rev-parse', '--show-toplevel'),
				)
				yield* Console.log(
					`Finishing linked worktree ${worktreePath} (branch ${branch})...`,
				)

				// A worktree left sitting on main names no branch of its own to finish,
				// which is what a merge that deletes the branch leaves behind. Its data
				// and directory still go, and main itself is brought up to date further
				// down, once this worktree has let go of it.
				const ownBranch = branch === 'main' ? null : branch
				if (ownBranch === null) {
					yield* Console.log(
						'This worktree is on main, so there is no branch of its own to delete.',
					)
				} else {
					// Done before anything is judged or removed: what counts as
					// "already on main" depends on it, and a pull that cannot happen —
					// no network, a main that has wandered off — is a reason to stop
					// while there is still a worktree to come back to.
					yield* catchMainUp(mainRoot)
					if (yield* branchExists(ownBranch)) {
						yield* refuseUnlessWorkIsOnMain(mainRoot, ownBranch, force)
					}
				}

				const handPlaced = yield* handPlacedFiles(worktreePath)
				if (handPlaced.length > 0) {
					yield* Console.log(
						`These go when the directory does: ${handPlaced.slice(0, 5).join(', ')}${handPlaced.length > 5 ? `, and ${handPlaced.length - 5} more` : ''}.`,
					)
				}

				// A worktree that never had a database is still a worktree to finish —
				// a change to the command-line tool alone needs no stack — so nothing to
				// drop is a note, not the end of the run.
				const dropped = (yield* worktreeDown) === 'removed'
				if (!dropped) {
					yield* Console.log(
						'No database or bucket provisioned here — nothing to drop.',
					)
				}

				const finishRemoving = Effect.gen(function* () {
					// Move to the main checkout before deleting the worktree directory,
					// otherwise subsequent git commands would run from a deleted cwd.
					process.chdir(mainRoot)
					yield* execArgs('git', [
						'-C',
						mainRoot,
						'worktree',
						'remove',
						...(force ? ['--force'] : []),
						worktreePath,
					])
					yield* Console.log('✓ Removed linked worktree directory')

					if (ownBranch === null) {
						// Bringing main up to date had to wait: git keeps a branch in one
						// working tree at a time, so nothing could move it while this
						// worktree still held it.
						yield* catchMainUp(mainRoot)
					} else if (yield* branchExists(ownBranch)) {
						yield* deleteBranch(mainRoot, ownBranch)
					}
				})

				// The data is gone by now and nothing brings it back, so a step that
				// fails from here has to say so: git names what it could not do, and
				// cannot know that a database went first.
				yield* dropped
					? finishRemoving.pipe(
							Effect.catch(failure =>
								Effect.fail(
									new Error(
										`${reasonOf(failure)}\n\nThis worktree's data was dropped before that, and is not coming back: \`pnpm cli worktree up\` makes a fresh database and bucket if you carry on here.${ownBranch === null ? '' : ` The branch ${ownBranch} is untouched.`}`,
									),
								),
							),
						)
					: finishRemoving
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
				// The main checkout is the working tree being kept, so there is no
				// directory to take uncommitted changes away with: git carries them onto
				// main when both branches agree on the file. The work is safe, but it
				// now sits on a branch it was not written for, which nothing else says.
				if (!(yield* workingTreeClean)) {
					yield* Console.log(
						`Uncommitted changes came across to main with you — they were written on ${branch}. Set them aside with \`git stash\` if main is not where they belong.`,
					)
				}
				yield* catchMainUp(mainRoot)

				if (yield* branchExists(branch)) {
					yield* refuseUnlessWorkIsOnMain(mainRoot, branch, force)
					yield* deleteBranch(mainRoot, branch)
				}
			}

			yield* Console.log('✓ Done')
		})

		yield* stashed === null
			? finish
			: finish.pipe(Effect.onExit(() => restoreStashed(stashed)))
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
