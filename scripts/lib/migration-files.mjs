// What counts as a migration, read the way the server's migrator reads it
// (Effect's `Migrator.fromFileSystem`). The migrator decides what to run from
// file names alone: the number at the front of each, run only when it is above
// the highest number the database has already applied. It never looks at a
// file's content again after that. Both the PR check and the deploy gate build
// on these helpers so they can't disagree with the migrator, or with each other.

import { execFileSync } from 'node:child_process'

export const MIGRATIONS_DIR = 'apps/server/src/db/migrations/'

// The pattern `fromFileSystem` applies in
// docs/repos/effect/packages/effect/src/sql/Migrator.ts, minus its optional
// leading path: the migrator lists one folder, not its subfolders, so only
// bare names can match.
const MIGRATION_FILE = /^(\d+)_([^.]+)\.(js|ts|mjs|mts)$/

// The opt-in for changing a migration that has already shipped.
export const EDIT_MARKER = /edited-after-release:/i

// A whole one-line import, e.g. `import { SqlClient } from 'effect/sql'`. The
// lines of an import split across several lines don't match, so an edit to one
// counts as a real change.
const IMPORT_LINE = /^import(\s+type)?\s+([^;]*\s+from\s+)?(['"])[^'"]+\3;?\s*$/

// Splits the entries of the migrations folder into what the migrator would load
// and what it would silently skip. `id` is the number the migrator uses, so
// `074_x.ts` and `0074_x.ts` are both 74.
export const parseMigrationFiles = names => {
	const migrations = []
	const unknown = []
	for (const name of names) {
		const match = MIGRATION_FILE.exec(name)
		if (match) migrations.push({ id: Number(match[1]), file: name })
		else unknown.push(name)
	}
	return { migrations, unknown }
}

// The migrations a database at `before` would run once it reaches `after`, and
// anything in `after` that stops a safe answer. `before` and `after` are folder
// listings, as file names.
export const pendingMigrations = (before, after) => {
	const old = parseMigrationFiles(before).migrations
	const { migrations, unknown } = parseMigrationFiles(after)
	const oldIds = new Set(old.map(m => m.id))
	// Starts at 0 like the migrator's own count, which never runs a migration 0.
	const highestBefore = Math.max(0, ...oldIds)
	const problems = unknown.map(file => ({ kind: 'unknown', file }))

	const byId = new Map()
	for (const m of migrations) {
		const twin = byId.get(m.id)
		if (twin) problems.push({ kind: 'duplicate', file: m.file, other: twin })
		else byId.set(m.id, m.file)
		if (!oldIds.has(m.id) && m.id <= highestBefore) {
			problems.push({ kind: 'below', file: m.file, highest: highestBefore })
		}
	}

	const pending = migrations
		.filter(m => m.id > highestBefore)
		.sort((a, b) => a.id - b.id)
		.map(m => m.file)
	return { pending, problems }
}

// Whether two versions of a migration differ in anything but one-line imports.
// A dependency upgrade that moves an import path touches every migration
// without changing what any of them does.
export const differsBeyondImports = (before, after) => {
	const body = text =>
		text
			.split('\n')
			.filter(line => !IMPORT_LINE.test(line))
			.join('\n')
	return body(before) !== body(after)
}

// The shipped migrations a change edits without a reason, given folder
// listings (`{ name, blob }`) at the release, at the base the change applies
// to, and at the change itself, plus `read(blob)` for a file's text.
//
// Only migrations this change touches count, so an edit already on the base is
// not blamed on whoever opens the next PR. A marker counts only when its line
// is new in this change: one left from an earlier edit doesn't cover the next.
export const shippedMigrationEdits = ({ shipped, base, head, read }) => {
	const withIds = entries =>
		entries.flatMap(entry => {
			const [migration] = parseMigrationFiles([entry.name]).migrations
			return migration ? [{ ...entry, id: migration.id }] : []
		})
	const atBase = withIds(base)
	const atHead = withIds(head)
	// The same file if it's still there, otherwise whichever now holds the
	// number (a rename). A new file reusing the number is the numbering check's
	// to report, not an edit.
	const find = (entries, { id, name }) =>
		entries.find(e => e.name === name) ?? entries.find(e => e.id === id)
	const markers = text =>
		text.split('\n').filter(line => EDIT_MARKER.test(line))

	const problems = []
	const marked = []
	for (const released of withIds(shipped)) {
		const inChange = find(atHead, released)
		const onBase = find(atBase, released)
		// Same blob as the base: this change didn't touch the file.
		if (inChange?.blob === onBase?.blob) continue
		if (!inChange) {
			problems.push({ kind: 'deleted', file: released.name })
			continue
		}
		// Back to exactly what shipped, e.g. undoing an earlier edit.
		if (inChange.blob === released.blob) continue
		const text = read(inChange.blob)
		if (!differsBeyondImports(read(released.blob), text)) continue

		const markersOnBase = new Set(onBase ? markers(read(onBase.blob)) : [])
		if (markers(text).some(line => !markersOnBase.has(line))) {
			marked.push(inChange.name)
			continue
		}
		problems.push({ kind: 'edited', file: inChange.name })
	}
	return { problems, marked }
}

const git = args => execFileSync('git', args, { encoding: 'utf8' })

// The migrations folder at `ref`, as `{ name, blob }` per entry. `-z` keeps
// unusual file names as they are instead of quoting them.
export const listMigrationsAt = ref =>
	git(['ls-tree', '-z', '--full-tree', ref, '--', MIGRATIONS_DIR])
		.split('\0')
		.filter(Boolean)
		.map(entry => {
			// Each entry reads `<mode> <type> <blob>\t<path>`.
			const [meta, path] = entry.split('\t')
			return {
				name: path.slice(MIGRATIONS_DIR.length),
				blob: meta.split(' ')[2],
			}
		})

export const readBlob = blob => git(['cat-file', 'blob', blob])
