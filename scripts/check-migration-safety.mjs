#!/usr/bin/env node
// Enforces the expand-contract migration discipline (docs/runbooks.md). The prod
// deploy is a ROLLING update: the old instance keeps serving while the new one
// boots, so each migration must stay backward-compatible with the still-running
// version. Dropping or renaming a column the live version still reads breaks its
// requests mid-rollout.
//
// This scans migration files ADDED in the PR (vs the base ref) for
// non-backward-compatible DDL and fails unless the file opts in with an explicit
// marker comment documenting why it's deliberate:
//
//   // expand-contract: <why the old shape is safe to drop in this same deploy>
//
// Usage: node scripts/check-migration-safety.mjs [baseRef]   (default: origin/main)

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const MIGRATIONS_DIR = 'apps/server/src/db/migrations/'
const baseRef = process.argv[2] ?? 'origin/main'

// DDL that is not safe under a rolling deploy (the old instance breaks).
const DESTRUCTIVE = [
	['DROP COLUMN', /\bDROP\s+COLUMN\b/i],
	['DROP TABLE', /\bDROP\s+TABLE\b/i],
	['TRUNCATE', /\bTRUNCATE\b/i],
	['RENAME COLUMN', /\bRENAME\s+COLUMN\b/i],
	['RENAME TO', /\bRENAME\s+TO\b/i],
	['DROP CONSTRAINT', /\bDROP\s+CONSTRAINT\b/i],
	// A required column with no default rejects the old instance's inserts, which don't fill it in.
	[
		'DROP NOT NULL→NOT NULL add',
		/ADD\s+COLUMN\b[^;]*\bNOT\s+NULL\b(?![^;]*DEFAULT)/i,
	],
]
const MARKER = /expand-contract:/i

// Two-dot diff: compares the base and HEAD trees directly, so it needs no
// merge-base history — works under CI's shallow checkout.
const added = execSync(
	`git diff --name-only --diff-filter=A ${baseRef}..HEAD -- ${MIGRATIONS_DIR}`,
	{ encoding: 'utf8' },
)
	.trim()
	.split('\n')
	.filter(Boolean)

if (added.length === 0) {
	console.log('✓ migration safety: no new migrations in this change')
	process.exit(0)
}

let failed = false
for (const file of added) {
	const sql = readFileSync(file, 'utf8')
	const hits = DESTRUCTIVE.filter(([, re]) => re.test(sql)).map(
		([name]) => name,
	)
	if (hits.length === 0) {
		console.log(`✓ ${file} — backward-compatible`)
		continue
	}
	if (MARKER.test(sql)) {
		console.log(
			`✓ ${file} — non-backward-compatible but marked expand-contract (deliberate): ${hits.join(', ')}`,
		)
		continue
	}
	failed = true
	console.error(
		`✗ ${file} — non-backward-compatible DDL with no \`expand-contract:\` marker: ${hits.join(', ')}`,
	)
}

if (failed) {
	console.error(
		'\nThese changes break the still-running instance during the rolling deploy.\n' +
			'Split them into expand (add the new shape now) + contract (drop the old shape\n' +
			'in a LATER release) — see docs/runbooks.md. If the old shape is genuinely unused\n' +
			'(pre-prod, or the last reader shipped a release ago), opt in with a marker:\n' +
			'    // expand-contract: <why the old shape is safe to drop now>\n',
	)
	process.exit(1)
}
console.log('\n✓ migration safety check passed')
