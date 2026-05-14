import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { config as dotenvConfig } from 'dotenv'

const ROOT = resolve(import.meta.dirname, '../../../..')

// The CLI is single-repo; hardcoded so `gh variable list` doesn't depend on
// the caller's git remote being correct (worktrees, forks, dirty checkouts).
const GH_REPO = 'guillempuche/batuda'
const GH_ENV = 'production'

export type EnvTarget = 'local' | 'cloud'

let resolvedTarget: EnvTarget = 'local'

const stripEnvFlag = (argv: string[]): EnvTarget => {
	let target: EnvTarget = 'local'
	for (let i = argv.length - 1; i >= 2; i--) {
		const v = argv[i]
		if (v === '--env' && i + 1 < argv.length) {
			const next = argv[i + 1]
			if (next === 'local' || next === 'cloud') {
				target = next
				argv.splice(i, 2)
			}
		} else if (v && v.startsWith('--env=')) {
			const val = v.slice('--env='.length)
			if (val === 'local' || val === 'cloud') {
				target = val
				argv.splice(i, 1)
			}
		}
	}
	return target
}

const stripPnpmSeparator = (argv: string[]): void => {
	const dashIdx = argv.indexOf('--')
	if (dashIdx !== -1) argv.splice(dashIdx, 1)
}

/**
 * Fetch non-secret repo variables from the GitHub Actions `production` env
 * and merge them into process.env. Only fills keys not already set — values
 * loaded from `.env.cloud` (or the shell) win.
 *
 * Why: GitHub Secrets are write-only by design, so credentials must live in
 * `.env.cloud`; but Variables (BETTER_AUTH_BASE_URL, STORAGE_*, …) are
 * readable. Fetching them removes the duplicate-copy hazard between GH and
 * the local file. Non-fatal — if `gh` is missing, unauthed, or offline, the
 * function emits a hint and returns; downstream Config reads will surface
 * specific failures at the usage site.
 *
 * Leak-safety: no fetched name or value ever reaches stdout/stderr. Errors
 * print only the `gh` command's own diagnostic (which doesn't include
 * variable values), bounded to a short summary.
 */
const fetchGhVariables = (): void => {
	let stdout: string
	try {
		const buf = execFileSync(
			'gh',
			[
				'variable',
				'list',
				'--env',
				GH_ENV,
				'-R',
				GH_REPO,
				'--json',
				'name,value',
			],
			{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
		)
		stdout = buf.toString()
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code
		if (code === 'ENOENT') {
			process.stderr.write(
				'⚠  cloud env: `gh` CLI not found → install with `brew install gh` (or see https://cli.github.com), then run `gh auth login`. Falling back to .env.cloud only.\n',
			)
			return
		}
		const stderrBuf = (err as { stderr?: Buffer | string })?.stderr
		// gh's stderr is a short diagnostic ("HTTP 401: …", "no such repo",
		// "dial tcp: lookup …"); we still cap to a single 200-char line so a
		// verbose mode or future change can't accidentally dump anything
		// that looks like a value.
		const detail = (stderrBuf ? String(stderrBuf) : (err as Error).message)
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 200)
		process.stderr.write(
			`⚠  cloud env: \`gh variable list\` failed → ${detail}. Try \`gh auth status\` to verify; falling back to .env.cloud only.\n`,
		)
		return
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(stdout)
	} catch {
		// Don't echo the body — it would dump every variable value.
		process.stderr.write(
			'⚠  cloud env: could not parse `gh variable list` JSON. Falling back to .env.cloud only.\n',
		)
		return
	}

	if (!Array.isArray(parsed)) return
	let merged = 0
	for (const entry of parsed) {
		if (
			!entry ||
			typeof entry !== 'object' ||
			typeof (entry as { name?: unknown }).name !== 'string' ||
			typeof (entry as { value?: unknown }).value !== 'string'
		)
			continue
		const { name, value } = entry as { name: string; value: string }
		// Always override in cloud mode: gh is authoritative for non-secret
		// variables. The local `.env` baseline often carries dev defaults
		// (e.g. `BETTER_AUTH_BASE_URL=https://api.batuda.localhost`); without
		// this override the CLI would silently use the dev value against
		// prod credentials. `.env.cloud` still wins because it loads after
		// this function returns (see `loadEnv`).
		process.env[name] = value
		merged++
	}
	if (merged > 0) {
		// Count-only — never log names or values, even on success.
		process.stderr.write(
			`cloud env: merged ${merged} variable(s) from gh (env=${GH_ENV})\n`,
		)
	}
}

/**
 * Parse `--env local|cloud` from argv (default `local`), strip the flag so
 * Effect CLI never sees it, and load `.env` files via dotenv in precedence
 * order (later wins):
 *
 *   1. `<repo>/.env`                      (local-dev baseline)
 *   2. `<repo>/apps/cli/.env`             (per-app baseline)
 *   3. gh `variable list` (cloud only)    (authoritative cloud variables)
 *   4. `<repo>/.env.cloud`                (cloud only — secrets + overrides)
 *   5. `<repo>/apps/cli/.env.cloud`       (cloud only)
 *
 * Why gh fetch runs *between* the baselines and `.env.cloud`: the baseline
 * usually carries dev defaults like `BETTER_AUTH_BASE_URL=…localhost`, and
 * cloud mode must not inherit those. `.env.cloud` is reserved for secrets
 * (which gh can't expose) and rare local overrides — putting it last keeps
 * the user's explicit overrides authoritative.
 *
 * Must run before `NodeRuntime.runMain` / any Effect Config resolution so
 * process.env is populated before the layer stack is built.
 */
export const loadEnv = (): EnvTarget => {
	const argv = process.argv
	const target = stripEnvFlag(argv)
	stripPnpmSeparator(argv)

	const baselineFiles = [resolve(ROOT, '.env'), resolve(ROOT, 'apps/cli/.env')]
	const cloudOverrideFiles = [
		resolve(ROOT, '.env.cloud'),
		resolve(ROOT, 'apps/cli/.env.cloud'),
	]

	const loadFile = (file: string): void => {
		if (existsSync(file)) {
			dotenvConfig({ path: file, override: true, quiet: true })
		}
	}

	for (const file of baselineFiles) loadFile(file)
	if (target === 'cloud') {
		fetchGhVariables()
		for (const file of cloudOverrideFiles) loadFile(file)
	}

	resolvedTarget = target
	return target
}

export const getTarget = (): EnvTarget => resolvedTarget

export const isCloud = (): boolean => resolvedTarget === 'cloud'
