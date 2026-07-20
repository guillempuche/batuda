import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { parse as dotenvParse } from 'dotenv'

const ROOT = resolve(import.meta.dirname, '../../../..')

// The non-secret settings the deployed server runs on, committed and baked
// into its image. Cloud mode drives that same deployment, so it reads the
// server's own file rather than keeping a second copy in step.
const CLOUD_CONFIG_FILE = resolve(ROOT, 'apps/server/config.production.json')

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
 * Read the deployed server's non-secret settings as a flat key→value map.
 *
 * A missing or unreadable file is fatal rather than a warning: without it the
 * CLI would keep the dev defaults from `.env` — a localhost API URL, the dev
 * bucket — while holding real production credentials, and point them at the
 * wrong place. Failing here is louder and safer than that.
 *
 * Values are returned exactly as written (every one a JSON string, e.g.
 * `"600"`, `"false"`) so the config readers downstream parse them themselves.
 */
const readCloudConfig = (): Record<string, string> => {
	if (!existsSync(CLOUD_CONFIG_FILE))
		throw new Error(
			`Missing ${CLOUD_CONFIG_FILE}: --env cloud reads the deployed server's non-secret config from this file.`,
		)

	let parsed: unknown
	try {
		parsed = JSON.parse(readFileSync(CLOUD_CONFIG_FILE, 'utf8'))
	} catch (cause) {
		throw new Error(`Invalid JSON in ${CLOUD_CONFIG_FILE}`, { cause })
	}

	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
		throw new Error(
			`Expected ${CLOUD_CONFIG_FILE} to hold a flat object of settings.`,
		)

	const settings: Record<string, string> = {}
	for (const [key, value] of Object.entries(parsed))
		if (typeof value === 'string') settings[key] = value
	return settings
}

/**
 * Parse `--env local|cloud` from argv (default `local`), strip the flag so
 * Effect CLI never sees it, and populate process.env in precedence order
 * (later wins):
 *
 *   1. `<repo>/.env`                             (local-dev baseline)
 *   2. `<repo>/apps/cli/.env`                    (per-app baseline)
 *   3. `apps/server/config.production.json`      (cloud only — non-secrets)
 *
 * Anything the caller already exported outranks all three. That is the whole
 * mechanism behind cloud secrets: there is no secret file to read, because
 * `infisical run --env=prod -- pnpm cli …` puts the credentials into the
 * environment before the CLI starts, and nothing here overwrites them. It also
 * covers the integration db-setup, which exports `DATABASE_URL` for a
 * throwaway test database and shells out to the CLI — the baseline dev URL
 * must not shadow it, or `db reset` would wipe the wrong database.
 *
 * A blank entry (`KEY=`) never overwrites a value another source provided, so
 * a stray empty line in `apps/cli/.env` cannot blank out a real value.
 *
 * Cloud settings load after the baselines because the baselines carry dev
 * defaults — `BETTER_AUTH_BASE_URL=https://api.batuda.localhost` and the like.
 * Inheriting those while holding production credentials is precisely the
 * mix-up this ordering prevents.
 *
 * Must run before `NodeRuntime.runMain` / any Effect Config resolution so
 * process.env is populated before the layer stack is built.
 */
export const loadEnv = (): EnvTarget => {
	const argv = process.argv
	const target = stripEnvFlag(argv)
	stripPnpmSeparator(argv)

	const baselineFiles = [resolve(ROOT, '.env'), resolve(ROOT, 'apps/cli/.env')]

	// Keys the caller exported before invoking the CLI — including everything
	// `infisical run` injects. No file may overwrite these.
	const callerProvided = new Set(
		Object.entries(process.env)
			.filter(([, value]) => value !== undefined && value !== '')
			.map(([key]) => key),
	)

	// Later sources win over earlier ones, but never over the caller, and a
	// blank value never wins over anything.
	const mergeIntoEnv = (settings: Record<string, string>): void => {
		for (const [key, value] of Object.entries(settings)) {
			if (value === '' || callerProvided.has(key)) continue
			process.env[key] = value
		}
	}

	for (const file of baselineFiles)
		if (existsSync(file)) mergeIntoEnv(dotenvParse(readFileSync(file)))

	if (target === 'cloud') mergeIntoEnv(readCloudConfig())

	resolvedTarget = target
	return target
}

export const getTarget = (): EnvTarget => resolvedTarget
