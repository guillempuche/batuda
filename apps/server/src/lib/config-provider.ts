import { existsSync, readFileSync } from 'node:fs'

import { ConfigProvider, Layer } from 'effect'

/**
 * Reads the baked, non-secret config file for a deployment tier into a plain
 * key→value map, or `undefined` when there is no file to read. Plain Node `fs`
 * (not Effect `Config`) on purpose: this runs while the config provider itself
 * is still being built, so reading through `Config` here would be a loop.
 *
 * Production must ship its file — a missing `config.production.json` throws so
 * the server fails loudly at boot rather than quietly starting on whatever
 * happens to be in the environment. Outside production the file is optional and
 * local dev reads `.env`, so an absent file just means "use the environment"
 * and returns `undefined`. Values come back verbatim (all JSON strings, e.g.
 * `"600"`, `"false"`) with no coercion, so `Config.int` / `Config.boolean`
 * parse them downstream.
 */
export function resolveConfigEnv(
	dir: string,
	nodeEnv: string | undefined,
): Record<string, string> | undefined {
	const path = `${dir}/config.${nodeEnv}.json`
	if (existsSync(path)) {
		try {
			return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>
		} catch (cause) {
			// A baked-but-corrupt file is a build defect — fail loudly and name the
			// file, rather than surfacing a bare JSON SyntaxError at boot.
			throw new Error(`Invalid JSON in ${path}`, { cause })
		}
	}
	if (nodeEnv === 'production')
		throw new Error(
			`Missing ${path}: production must ship its baked config file ` +
				'(config is read from the file, not environment variables).',
		)
	return undefined
}

const fileEnv = resolveConfigEnv('/app', process.env['NODE_ENV'])

/**
 * Adds the baked file (when present) as a fallback beneath the ambient
 * environment provider, so every `Config.*` reader picks up file-backed values
 * with no call-site changes. The environment is consulted first and wins, but
 * the file holds only non-secret keys — disjoint from the secrets on the boot
 * command line — so that precedence never actually decides a value. Absent file
 * → `Layer.empty`, which the environment provider sees straight through.
 *
 * `/app` is the image WORKDIR (see apps/server/Dockerfile) and is absolute on
 * purpose: the deployed process can start with its working directory at `/`,
 * not `/app`. `NODE_ENV` stays on the command line, so it's read from the
 * environment directly here.
 */
export const ConfigFileLive: Layer.Layer<never> =
	fileEnv === undefined
		? Layer.empty
		: // `fromUnknown`, not `fromEnv`: the file is a flat config object keyed by
			// the exact variable names, looked up literally. `fromEnv` would split
			// each `UPPER_SNAKE` key on `_` into an env-var trie and mis-resolve them.
			ConfigProvider.layerAdd(ConfigProvider.fromUnknown(fileEnv))
