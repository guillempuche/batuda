#!/usr/bin/env node
// Guards the size limit Cloudflare enforces on the batuda.co worker.
//
// The whole server-side app is uploaded as one script, and the hosting plan
// rejects it past a fixed compressed size. That rejection lands at DEPLOY time,
// on a release tag, once the tag is already pushed. Checking here moves the
// discovery to the pull request that adds the weight.
//
// The size comes from `wrangler deploy --dry-run`: the same number the real
// deploy reports, so it cannot drift from what Cloudflare decides, and it needs
// no credentials and uploads nothing.
//
// Usage: node scripts/check-bundle-size.mjs [--budget <KiB>]   (default: 2700)
//   Measures the built output — run `pnpm build` first.
//   Exits 1 when over budget, 2 when the size cannot be measured.

import { execFileSync } from 'node:child_process'

// Cloudflare's own limit is 3072 KiB compressed. The budget sits below it so a
// pull request fails with room to spare, not at the exact point where the
// deploy would already be broken.
const CLOUDFLARE_LIMIT_KIB = 3072
const DEFAULT_BUDGET_KIB = 2700
const WORKER_DIR = 'apps/internal'

const budgetFlagIndex = process.argv.indexOf('--budget')
const budgetKib =
	budgetFlagIndex === -1
		? DEFAULT_BUDGET_KIB
		: Number(process.argv[budgetFlagIndex + 1])

if (!Number.isFinite(budgetKib) || budgetKib <= 0) {
	console.error(`Invalid --budget: ${process.argv[budgetFlagIndex + 1]}`)
	process.exit(2)
}

let output = ''
try {
	output = execFileSync('pnpm', ['exec', 'wrangler', 'deploy', '--dry-run'], {
		cwd: WORKER_DIR,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	})
} catch (error) {
	console.error('::error::Could not measure the worker bundle.')
	console.error(error.stdout ?? '')
	console.error(error.stderr ?? '')
	process.exit(2)
}

// wrangler prints e.g. `Total Upload: 10863.02 KiB / gzip: 2385.95 KiB`.
const compressedSizeMatch = output.match(/gzip:\s*([\d.]+)\s*KiB/i)
if (!compressedSizeMatch) {
	console.error(
		'::error::Could not read a compressed size from wrangler output. ' +
			'Its output format may have changed — update scripts/check-bundle-size.mjs.',
	)
	console.error(output)
	process.exit(2)
}

const actualKib = Number(compressedSizeMatch[1])
const headroomKib = (CLOUDFLARE_LIMIT_KIB - actualKib).toFixed(1)
const summary = `${actualKib} KiB compressed (budget ${budgetKib} KiB, Cloudflare rejects above ${CLOUDFLARE_LIMIT_KIB} KiB, headroom ${headroomKib} KiB)`

if (actualKib > budgetKib) {
	console.error(`::error::Worker bundle over budget — ${summary}`)
	console.error(
		'\nSomething heavy reached the server bundle. Most often this is a ' +
			'browser-only component imported directly by a route: an editor, a map, ' +
			'a calendar. Those belong in a `.client.tsx` file behind `lazy()` so ' +
			'they download only for the people who use them — see ' +
			'apps/internal/src/components/emails/email-editor.tsx.\n\n' +
			'To see what is taking the space:\n' +
			'  pnpm --filter @batuda/internal build\n',
	)
	process.exit(1)
}

console.log(`Worker bundle within budget — ${summary}`)
