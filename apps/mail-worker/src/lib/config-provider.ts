import { existsSync, readFileSync } from 'node:fs'

import { ConfigProvider, Layer } from 'effect'

// Non-secret config is baked into the image as a committed JSON file and read
// here at boot. The unikernel boot command line has a hard size limit that the
// full variable set would overflow, so only secrets travel on it and everything
// else loads from the file. Plain Node fs is used on purpose (not Effect
// Config) so building the config provider can't depend on the provider it is
// about to install.
export function resolveConfigEnv(
	dir: string,
	nodeEnv: string | undefined,
): Record<string, string> | undefined {
	const filePath = `${dir}/config.${nodeEnv}.json`
	if (!existsSync(filePath)) {
		// Production must ship its baked config; a missing file means a broken
		// image, so fail at boot instead of silently running on env defaults.
		if (nodeEnv === 'production') {
			throw new Error(`Missing required config file: ${filePath}`)
		}
		// Outside production the file is absent by design — read env (.env) only.
		return undefined
	}
	try {
		return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, string>
	} catch (cause) {
		// A baked-but-corrupt file is a build defect — fail loudly and name the file.
		throw new Error(`Invalid JSON in ${filePath}`, { cause })
	}
}

// `/app` is the image working directory where the Dockerfile copies the file.
const fileEnv = resolveConfigEnv('/app', process.env['NODE_ENV'])

// Layer the file values under the live environment provider, so real
// environment variables still win and secrets keep coming from the command
// line. No file (dev) means an empty, no-op layer.
export const ConfigFileLive =
	fileEnv === undefined
		? Layer.empty
		: // `fromUnknown`, not `fromEnv`: the file is a flat config object keyed by
			// the exact variable names, looked up literally. `fromEnv` would split
			// each `UPPER_SNAKE` key on `_` into an env-var trie and mis-resolve them.
			ConfigProvider.layerAdd(ConfigProvider.fromUnknown(fileEnv))
