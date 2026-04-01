import { existsSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { Effect } from 'effect'

const ROOT = resolve(import.meta.dirname, '../../../..')

const ENV_FILES = [
	{ example: '.env.example', target: '.env' },
	{ example: 'apps/cli/.env.example', target: 'apps/cli/.env' },
]

export const setup = Effect.gen(function* () {
	const results: string[] = []

	// 1. Copy .env files
	for (const { example, target } of ENV_FILES) {
		const src = resolve(ROOT, example)
		const dst = resolve(ROOT, target)

		if (existsSync(dst)) {
			results.push(`skip ${target} (already exists)`)
		} else if (!existsSync(src)) {
			results.push(`skip ${target} (no ${example} found)`)
		} else {
			yield* Effect.promise(() => copyFile(src, dst))
			results.push(`created ${target}`)
		}
	}

	return results
})
