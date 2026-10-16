#!/usr/bin/env node
// Prints the migrations a production database at <prev-ref> would run once the
// server at <head-ref> deploys, one file name per line, or nothing when there
// are none. The deploy workflow gates its production migrate step on this.
//
// It reads only the list of file names, the same way the migrator does, so an
// edit inside a migration that already ran (an import path moved by a
// dependency upgrade, say) runs nothing and doesn't gate. The PR check
// (check-migration-safety.mjs) is what stops a released migration being edited.
//
// It exits 1, which blocks the deploy, rather than guess when <head-ref> has:
// a file the migrator would silently skip, two migrations with one number, or a
// new migration numbered at or below <prev-ref>'s highest, which prod would
// never run.
//
// Usage: node scripts/pending-migrations.mjs <prev-ref> [head-ref]   (head defaults to HEAD)

import {
	listMigrationsAt,
	MIGRATIONS_DIR,
	pendingMigrations,
} from './lib/migration-files.mjs'

const [prevRef, headRef = 'HEAD'] = process.argv.slice(2)
if (!prevRef) {
	console.error(
		'usage: node scripts/pending-migrations.mjs <prev-ref> [head-ref]',
	)
	process.exit(2)
}

const names = ref => listMigrationsAt(ref).map(entry => entry.name)
const { pending, problems } = pendingMigrations(names(prevRef), names(headRef))

const explain = {
	unknown: p =>
		`${p.file} — the migrator skips files not named <number>_<name>.(ts|js|mts|mjs)`,
	duplicate: p =>
		`${p.file} — same number as ${p.other}; the migrator refuses to run either`,
	below: p =>
		`${p.file} — new, but numbered at or below ${p.highest}, the highest at ${prevRef}; prod would never run it`,
}
if (problems.length > 0) {
	for (const p of problems)
		console.error(`✗ ${MIGRATIONS_DIR}${explain[p.kind](p)}`)
	process.exit(1)
}

for (const file of pending) console.log(`${MIGRATIONS_DIR}${file}`)
