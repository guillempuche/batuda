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
// It also checks how the new migrations are NUMBERED, which matters more than it
// looks. A migration's number is the only thing deciding whether it ever runs:
// the migrator records the highest number applied and, next time, runs only what
// is above it. Two failures follow from that, and a long-lived branch hits both.
//
// A number already taken on the base ref is the loud one — the migrator refuses
// to start, naming duplicate ids, so nothing corrupts but nothing migrates either
// until somebody renumbers.
//
// A number at or below the base ref's highest is the quiet one, and the reason
// this check exists. Two branches numbering from the same starting point is
// normal; whichever merges second is then numbered below something already on
// the base, and any database that applied that branch first will never run the
// other's migration. No error, no retry, no way back — it is simply skipped
// forever, and the mismatch surfaces later as a missing column.
//
// One rule catches both: a new migration must be numbered above everything on
// the base ref. Rebase, renumber, and the branch is safe again.
//
// Finally, a migration that has already shipped stays as it shipped. Prod has
// run it, and the migrator never runs a number twice, so an edit never reaches
// prod. It does reach every database built from scratch (CI, a worktree, a
// rebuild), which then quietly ends up with a different schema than prod. An
// edit that only changes one-line imports (a dependency upgrade moving a path)
// passes; anything else needs a marker line, new in this change, in the file:
//
//   // edited-after-release: <why a fresh database still ends up like prod>
//
// "Shipped" means present at the newest server-v* tag, and only migrations this
// change touches count. Deleting a shipped migration has nowhere to put the
// marker, so it always fails.
//
// Usage: node scripts/check-migration-safety.mjs [baseRef] [releaseRef]
//   baseRef defaults to origin/main; releaseRef to the newest local server-v* tag.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import {
	listMigrationsAt,
	MIGRATIONS_DIR,
	parseMigrationFiles,
	readBlob,
	shippedMigrationEdits,
} from './lib/migration-files.mjs'

const baseRef = process.argv[2] ?? 'origin/main'
// `||`, not `??`: CI passes an empty argument when it found no release tag.
const releaseRef =
	process.argv[3] ||
	execFileSync('git', ['tag', '-l', 'server-v*', '--sort=-v:refname'], {
		encoding: 'utf8',
	}).split('\n')[0]

// DDL that is not safe under a rolling deploy (the old instance breaks).
const DESTRUCTIVE = [
	['DROP COLUMN', /\bDROP\s+COLUMN\b/i],
	['DROP TABLE', /\bDROP\s+TABLE\b/i],
	['TRUNCATE', /\bTRUNCATE\b/i],
	['RENAME COLUMN', /\bRENAME\s+COLUMN\b/i],
	['RENAME TO', /\bRENAME\s+TO\b/i],
	['DROP CONSTRAINT', /\bDROP\s+CONSTRAINT\b/i],
	// A required column with no default rejects the old instance's inserts, which don't fill it in.
	// A `NOT NULL` that reads as `IS NOT NULL` is a query predicate (a partial index's WHERE, a
	// CHECK) that happens to share the file with an ADD COLUMN — it never makes a column
	// required, so the lookbehind skips it and only a real required-column add trips this.
	[
		'DROP NOT NULL→NOT NULL add',
		/ADD\s+COLUMN\b[^;]*(?<!\bIS\s)\bNOT\s+NULL\b(?![^;]*DEFAULT)/i,
	],
]
const MARKER = /expand-contract:/i

// Two-dot diff: compares the base and HEAD trees directly, so it needs no
// merge-base history — works under CI's shallow checkout.
// `-z` keeps a file name with accents or spaces as it is instead of quoting it.
const added = execFileSync(
	'git',
	[
		'diff',
		'-z',
		'--name-only',
		'--diff-filter=A',
		`${baseRef}..HEAD`,
		'--',
		MIGRATIONS_DIR,
	],
	{ encoding: 'utf8' },
)
	.split('\0')
	.filter(Boolean)

// ── Shipped migrations ───────────────────────────────────────────────────────
if (releaseRef) {
	const { problems, marked } = shippedMigrationEdits({
		shipped: listMigrationsAt(releaseRef),
		base: listMigrationsAt(baseRef),
		head: listMigrationsAt('HEAD'),
		read: readBlob,
	})
	for (const file of marked) {
		console.log(
			`✓ ${MIGRATIONS_DIR}${file} — edited after ${releaseRef}, with a new edited-after-release reason`,
		)
	}
	for (const { kind, file } of problems) {
		console.error(
			kind === 'deleted'
				? `✗ ${MIGRATIONS_DIR}${file} — shipped in ${releaseRef}, deleted here. Prod keeps what it ran; a fresh database would not get it.`
				: `✗ ${MIGRATIONS_DIR}${file} — shipped in ${releaseRef} and edited here beyond its imports, with no new \`edited-after-release:\` line`,
		)
	}
	if (problems.length > 0) {
		console.error(
			'\nProd already ran these and will never run them again, so the edit only\n' +
				'changes what a database built from scratch gets. Put the change in a new\n' +
				'migration instead, or, if a fresh database still ends up like prod, say why\n' +
				'in a new line (one left from an earlier edit does not count):\n' +
				'    // edited-after-release: <why>\n',
		)
		process.exit(1)
	}
	console.log(
		`✓ migration safety: no unexplained edit to a migration shipped in ${releaseRef}`,
	)
} else {
	console.log(
		'✓ migration safety: no server-v* tag here, skipping the shipped-migrations check',
	)
}

if (added.length === 0) {
	console.log('✓ migration safety: no new migrations in this change')
	process.exit(0)
}

let failed = false

// ── Numbering ────────────────────────────────────────────────────────────────
// The number off the front of the filename: `0047_company_tax_id.ts` → 47.
const idOf = file => {
	const match = /(?:^|\/)(\d+)_/.exec(file)
	return match ? Number(match[1]) : null
}

const baseIds = new Set(
	listMigrationsAt(baseRef)
		.map(entry => idOf(entry.name))
		.filter(id => id !== null),
)
const highestOnBase = baseIds.size === 0 ? -1 : Math.max(...baseIds)
const seen = new Map()

for (const file of added) {
	const id = idOf(file)
	if (parseMigrationFiles([file.slice(MIGRATIONS_DIR.length)]).unknown.length) {
		failed = true
		console.error(
			`✗ ${file} — the migrator would never load this; name it <number>_<what_it_does>.ts, with no other dot`,
		)
	} else if (baseIds.has(id)) {
		failed = true
		console.error(
			`✗ ${file} — number ${id} is already taken on ${baseRef}. Rebase and renumber above ${highestOnBase}.`,
		)
	} else if (seen.has(id)) {
		failed = true
		console.error(
			`✗ ${file} — number ${id} is used twice here (also ${seen.get(id)}).`,
		)
	} else if (id <= highestOnBase) {
		failed = true
		seen.set(id, file)
		console.error(
			`✗ ${file} — number ${id} sits below ${highestOnBase}, the highest on ${baseRef}. ` +
				`A database that already ran this branch would skip everything in between, permanently. ` +
				`Rebase and renumber above ${highestOnBase}.`,
		)
	} else {
		seen.set(id, file)
		console.log(`✓ ${file} — numbered ${id}, above ${highestOnBase}`)
	}
}

if (failed) {
	console.error(
		'\nA migration runs only if its number is above the highest the database has\n' +
			'already applied. Numbering at or below that means it is skipped — silently,\n' +
			'once, and for good. Rebase onto the base ref and renumber.\n',
	)
	process.exit(1)
}

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
