import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { config as dotenvConfig } from 'dotenv'

const ROOT = resolve(import.meta.dirname, '../../../..')

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
 * Parse `--env local|cloud` from argv (default `local`), strip the flag so
 * Effect CLI never sees it, and load `.env` files via dotenv in precedence
 * order (later files override earlier ones):
 *
 *   1. `<repo>/.env`                      (baseline)
 *   2. `<repo>/apps/cli/.env`             (per-app overrides)
 *   3. `<repo>/.env.cloud`                (cloud only)
 *   4. `<repo>/apps/cli/.env.cloud`       (cloud only)
 *
 * Must run before `NodeRuntime.runMain` / any Effect Config resolution so
 * process.env is populated before the layer stack is built.
 */
export const loadEnv = (): EnvTarget => {
	const argv = process.argv
	const target = stripEnvFlag(argv)
	stripPnpmSeparator(argv)

	const files = [
		resolve(ROOT, '.env'),
		resolve(ROOT, 'apps/cli/.env'),
		...(target === 'cloud'
			? [resolve(ROOT, '.env.cloud'), resolve(ROOT, 'apps/cli/.env.cloud')]
			: []),
	]
	for (const file of files) {
		if (existsSync(file)) {
			dotenvConfig({ path: file, override: true, quiet: true })
		}
	}

	resolvedTarget = target
	return target
}

export const getTarget = (): EnvTarget => resolvedTarget

export const isCloud = (): boolean => resolvedTarget === 'cloud'
