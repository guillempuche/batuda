import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Config, ConfigProvider, Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveConfigEnv } from './config-provider.js'

// resolveConfigEnv is the pure, fs-only step that runs at boot before Effect's
// ConfigProvider: given a directory and the NODE_ENV string it reads
// `config.<NODE_ENV>.json` and hands back the baked non-secret config map. It
// deliberately uses plain Node fs (not Config) so it can run before the
// provider exists. The one rule with teeth: in production a missing file must
// throw — prod must never quietly boot on env-only config — while dev with no
// file just reads the process env. Every value in the file is a JSON string so
// the numeric/boolean entries survive for Config.int / Config.boolean to parse.

const PRODUCTION = 'production'
const DEVELOPMENT = 'development'

// A baked non-secret config map. Every value is a JSON string, including the
// numeric `"600"` and the boolean `"false"`, matching the all-strings file.
const CONFIG_FIXTURE = {
	RESEARCH_PROVIDER_SEARCH: 'firecrawl',
	ALLOWED_ORIGINS: 'https://app.batuda.co',
	BETTER_AUTH_RATE_LIMIT: '600',
	BETTER_AUTH_INSECURE_COOKIES: 'false',
}

describe('resolveConfigEnv', () => {
	let dir: string

	beforeEach(() => {
		// GIVEN an isolated temp directory standing in for the image's /app WORKDIR
		//   (the test never touches the real /app the runtime loader reads)
		dir = mkdtempSync(join(tmpdir(), 'batuda-config-provider-'))
	})

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true })
	})

	const writeConfig = (nodeEnv: string, contents: string): void => {
		writeFileSync(join(dir, `config.${nodeEnv}.json`), contents)
	}

	describe('when NODE_ENV is not production and no config file exists', () => {
		it('should return undefined so dev falls back to env-only', () => {
			// GIVEN a development boot with no baked config file
			// WHEN the loader resolves the config env
			// THEN undefined — dev reads process.env / .env unchanged, file optional
			expect(resolveConfigEnv(dir, DEVELOPMENT)).toBeUndefined()
		})

		it('should return undefined when NODE_ENV is undefined', () => {
			// GIVEN no NODE_ENV at all (still not the exact `production` string) + no file
			// WHEN the loader resolves the config env
			// THEN undefined — only the literal `production` string demands a file
			expect(resolveConfigEnv(dir, undefined)).toBeUndefined()
		})
	})

	describe('when NODE_ENV is production and the config file is present', () => {
		beforeEach(() => {
			// GIVEN the baked production config file sitting in the WORKDIR
			writeConfig(PRODUCTION, JSON.stringify(CONFIG_FIXTURE))
		})

		it('should return the parsed config map with the baked key present', () => {
			// WHEN the loader resolves the config env
			const resolved = resolveConfigEnv(dir, PRODUCTION)
			// THEN the whole map parses and a known non-secret key is present
			expect(resolved).toEqual(CONFIG_FIXTURE)
			expect(resolved?.['RESEARCH_PROVIDER_SEARCH']).toBe('firecrawl')
		})

		it('should keep every value a string so Config.int/boolean can parse them', () => {
			// WHEN the loader resolves the config env
			const resolved = resolveConfigEnv(dir, PRODUCTION)
			// THEN no JSON coercion happened — the numeric and boolean entries stay
			//   strings ("600", "false"), so the downstream parsers receive text
			expect(resolved?.['BETTER_AUTH_RATE_LIMIT']).toBe('600')
			expect(resolved?.['BETTER_AUTH_INSECURE_COOKIES']).toBe('false')
			for (const value of Object.values(resolved ?? {}))
				expect(typeof value).toBe('string')
		})
	})

	describe('when the config file is present outside production', () => {
		it('should still parse and return it, keying the filename off NODE_ENV', () => {
			// GIVEN a development-named config file that happens to exist
			writeConfig(DEVELOPMENT, JSON.stringify(CONFIG_FIXTURE))
			// WHEN the loader resolves the config env
			// THEN it reads `config.<NODE_ENV>.json` and parses it regardless of tier —
			//   proving the path is built from nodeEnv, not hard-coded to production
			expect(resolveConfigEnv(dir, DEVELOPMENT)).toEqual(CONFIG_FIXTURE)
		})
	})

	describe('when NODE_ENV is production and the config file is absent', () => {
		it('should throw to fail loudly at boot instead of degrading to env-only', () => {
			// GIVEN a production boot with no baked config file
			// WHEN the loader resolves the config env
			// THEN it throws — prod must never silently boot on env-only config
			expect(() => resolveConfigEnv(dir, PRODUCTION)).toThrow()
		})
	})

	describe('when the config file exists but holds malformed JSON', () => {
		it('should throw an error naming the file, not a bare JSON parse error', () => {
			// GIVEN a baked file that exists but is not valid JSON (a build defect)
			writeConfig(PRODUCTION, '{ not valid json')
			// WHEN the loader resolves the config env
			// THEN it throws, and the message names the offending file for boot debugging
			expect(() => resolveConfigEnv(dir, PRODUCTION)).toThrow(
				/config\.production\.json/,
			)
		})
	})
})

// ConfigFileLive layers the parsed file UNDER the live environment provider via
// ConfigProvider.layerAdd, which composes orElse(env, file): the environment
// wins and the file fills the gaps. These cases pin that composition and the
// `fromUnknown` constructor — a Config read resolves a baked non-secret key from
// the file by literal key, the environment still overrides, and the all-strings
// file survives the typed parsers.
describe('config provider composition (fromUnknown under env)', () => {
	// A baked non-secret config object, keyed by the exact flat UPPER_SNAKE names
	// the app reads — looked up literally by `fromUnknown` (no `_`-splitting).
	const file = ConfigProvider.fromUnknown({
		RESEARCH_PROVIDER_SEARCH: 'firecrawl',
		API_KEY_RATE_LIMIT_MAX: '600',
		BETTER_AUTH_INSECURE_COOKIES: 'false',
		ALLOWED_ORIGINS: 'https://file.example',
	})
	// The environment carries a key that also exists in the file, to prove
	// precedence (NODE_ENV stays on the boot command line in production).
	const env = ConfigProvider.fromEnv({
		env: { ALLOWED_ORIGINS: 'https://env.example' },
	})
	// orElse(env, file) is exactly what layerAdd installs by default.
	const composed = ConfigProvider.orElse(env, file)

	describe('when a non-secret key lives only in the file', () => {
		it('should resolve it from the file by literal key lookup', () => {
			// GIVEN a key present only in the baked file
			// WHEN a Config reads it through the composed provider
			// THEN fromUnknown returns the file value, proving the key is not split on `_`
			expect(
				Effect.runSync(
					Config.string('RESEARCH_PROVIDER_SEARCH').parse(composed),
				),
			).toBe('firecrawl')
		})

		it('should coerce the string values into their typed Config form', () => {
			// GIVEN the file stores everything as strings ("600", "false")
			// WHEN Config.int / Config.boolean read them
			// THEN the typed parsers coerce the strings — so the all-strings file is correct
			expect(
				Effect.runSync(Config.int('API_KEY_RATE_LIMIT_MAX').parse(file)),
			).toBe(600)
			expect(
				Effect.runSync(
					Config.boolean('BETTER_AUTH_INSECURE_COOKIES').parse(file),
				),
			).toBe(false)
		})
	})

	describe('when the same key is set in both the environment and the file', () => {
		it('should let the environment win so a cmdline value always overrides the file', () => {
			// GIVEN ALLOWED_ORIGINS present in both env and file
			// WHEN read through orElse(env, file)
			// THEN the environment value wins — the file is only a fallback
			expect(
				Effect.runSync(Config.string('ALLOWED_ORIGINS').parse(composed)),
			).toBe('https://env.example')
		})
	})
})
