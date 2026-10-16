import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
	differsBeyondImports,
	parseMigrationFiles,
	pendingMigrations,
	shippedMigrationEdits,
} from './migration-files.mjs'

describe('parseMigrationFiles', () => {
	describe('when a name has a number, a name and a script extension', () => {
		it('should read the number the way the migrator does', () => {
			// GIVEN names with three and four digits and every loadable extension
			const names = ['0001_init.ts', '074_short.js', '0075_a.mts', '9_b.mjs']

			// WHEN parsed
			const { migrations, unknown } = parseMigrationFiles(names)

			// THEN each becomes a migration, numbered without its leading zeros
			assert.deepEqual(
				migrations.map(m => m.id),
				[1, 74, 75, 9],
			)
			assert.deepEqual(unknown, [])
		})
	})

	describe('when the migrator would skip a name', () => {
		it('should list it as unknown', () => {
			// GIVEN a .sql file, a dot in the name, no number, a declaration file and a folder
			const names = [
				'0076_x.sql',
				'0077_a.b.ts',
				'helpers.ts',
				'0078_x.d.ts',
				'fixtures',
			]

			// WHEN parsed
			const { migrations, unknown } = parseMigrationFiles(names)

			// THEN none is a migration
			assert.deepEqual(migrations, [])
			assert.deepEqual(unknown, names)
		})
	})

	describe('when a name is not ASCII', () => {
		it('should still read it as a migration', () => {
			// GIVEN an accented migration name
			// WHEN parsed
			const { migrations } = parseMigrationFiles(['0074_café.ts'])

			// THEN it is migration 74
			assert.deepEqual(migrations, [{ id: 74, file: '0074_café.ts' }])
		})
	})
})

describe('pendingMigrations', () => {
	const released = ['0001_a.ts', '0002_b.ts', '0003_c.ts']

	describe('when nothing new is added', () => {
		it('should report nothing to run', () => {
			// GIVEN the same files before and after
			// WHEN compared
			const result = pendingMigrations(released, released)

			// THEN there is nothing to run and nothing wrong
			assert.deepEqual(result, { pending: [], problems: [] })
		})
	})

	describe('when migrations are added above the highest', () => {
		it('should list them in number order', () => {
			// GIVEN two new migrations, listed out of order
			const after = [...released, '0005_e.ts', '0004_d.ts']

			// WHEN compared
			const { pending, problems } = pendingMigrations(released, after)

			// THEN both run, lowest first
			assert.deepEqual(pending, ['0004_d.ts', '0005_e.ts'])
			assert.deepEqual(problems, [])
		})

		it('should count a three-digit number by its value', () => {
			// GIVEN a new migration with fewer digits than the others
			// WHEN compared
			const { pending } = pendingMigrations(released, [...released, '074_x.ts'])

			// THEN it runs, since 74 is above 3
			assert.deepEqual(pending, ['074_x.ts'])
		})
	})

	describe('when a shipped migration is renamed or deleted', () => {
		it('should report nothing to run', () => {
			// GIVEN 0002 renamed and 0003 deleted
			const after = ['0001_a.ts', '0002_renamed.ts']

			// WHEN compared
			const result = pendingMigrations(released, after)

			// THEN the migrator would run nothing, so neither gates
			assert.deepEqual(result, { pending: [], problems: [] })
		})
	})

	describe('when a new migration is numbered at or below the highest', () => {
		it('should report it, since prod would never run it', () => {
			// GIVEN a release with a gap at 2, and a new migration filling it
			const before = ['0001_a.ts', '0003_c.ts']
			const after = [...before, '0002_late.ts']

			// WHEN compared
			const { pending, problems } = pendingMigrations(before, after)

			// THEN it does not run, and is reported against the old highest
			assert.deepEqual(pending, [])
			assert.deepEqual(problems, [
				{ kind: 'below', file: '0002_late.ts', highest: 3 },
			])
		})
	})

	describe('when two migrations share a number', () => {
		it('should report the second one', () => {
			// GIVEN 0004 and 004, which the migrator both reads as 4
			const after = [...released, '0004_d.ts', '004_d2.ts']

			// WHEN compared
			const { problems } = pendingMigrations(released, after)

			// THEN the clash is reported
			assert.deepEqual(problems, [
				{ kind: 'duplicate', file: '004_d2.ts', other: '0004_d.ts' },
			])
		})
	})

	describe('when the folder holds a file the migrator would skip', () => {
		it('should report it', () => {
			// GIVEN a .sql file next to the migrations
			// WHEN compared
			const { problems } = pendingMigrations(released, [
				...released,
				'0004_d.sql',
			])

			// THEN it is reported instead of silently ignored
			assert.deepEqual(problems, [{ kind: 'unknown', file: '0004_d.sql' }])
		})
	})

	describe('when there was no migration before', () => {
		it('should run everything numbered above 0', () => {
			// GIVEN an empty folder before
			// WHEN compared
			const { pending } = pendingMigrations([], released)

			// THEN all of them run
			assert.deepEqual(pending, released)
		})

		it('should report a migration numbered 0, which the migrator never runs', () => {
			// GIVEN an empty folder before and a 0000 file after
			// WHEN compared
			const { pending, problems } = pendingMigrations([], ['0000_zero.ts'])

			// THEN it does not run and is reported
			assert.deepEqual(pending, [])
			assert.deepEqual(problems, [
				{ kind: 'below', file: '0000_zero.ts', highest: 0 },
			])
		})
	})
})

describe('differsBeyondImports', () => {
	const before = [
		"import { Effect } from 'effect'",
		"import { SqlClient } from 'effect/unstable/sql'",
		'',
		'export default Effect.gen(function* () {',
		'\tyield* sql`CREATE TABLE a (id int)`',
		'})',
	].join('\n')

	describe('when only a one-line import changes', () => {
		it('should say they do not differ', () => {
			// GIVEN the import path moved, as in a dependency upgrade
			const after = before.replace('effect/unstable/sql', 'effect/sql')

			// WHEN compared
			// THEN only imports changed
			assert.equal(differsBeyondImports(before, after), false)
		})

		it('should accept every one-line import form', () => {
			// GIVEN type, namespace, side-effect and semicolon imports added
			const after = [
				"import type { Foo } from 'foo'",
				'import * as Bar from "bar";',
				"import 'side-effect'",
				before,
			].join('\n')

			// WHEN compared
			// THEN only imports changed
			assert.equal(differsBeyondImports(before, after), false)
		})
	})

	describe('when anything else changes', () => {
		const cases = {
			'the SQL': before.replace('CREATE TABLE a', 'CREATE TABLE b'),
			'a comment': `// note\n${before}`,
			'a blank line': `${before}\n`,
			'a multi-line import': before.replace(
				"import { SqlClient } from 'effect/unstable/sql'",
				"import {\n\tSqlClient,\n} from 'effect/sql'",
			),
			'an import with code after it': before.replace(
				"from 'effect/unstable/sql'",
				"from 'effect/sql'; sql`DROP TABLE a`",
			),
			'an import with a comment after it': before.replace(
				"from 'effect/unstable/sql'",
				"from 'effect/sql' // DROP",
			),
		}
		for (const [what, after] of Object.entries(cases)) {
			it(`should say they differ when ${what} changes`, () => {
				// GIVEN a change beyond a one-line import
				// WHEN compared
				// THEN they differ
				assert.equal(differsBeyondImports(before, after), true)
			})
		}
	})

	describe('when a large block of SQL is added', () => {
		it('should say they differ', () => {
			// GIVEN thousands of new lines appended
			const after = `${before}\n${'-- x\n'.repeat(5000)}`

			// WHEN compared
			// THEN they differ
			assert.equal(differsBeyondImports(before, after), true)
		})
	})
})

describe('shippedMigrationEdits', () => {
	// Each blob id names a version of a file; `read` returns its text.
	const texts = {
		v1: "import { SqlClient } from 'effect/unstable/sql'\nsql`CREATE TABLE a`",
		v1Import: "import { SqlClient } from 'effect/sql'\nsql`CREATE TABLE a`",
		v2: "import { SqlClient } from 'effect/unstable/sql'\nsql`CREATE TABLE b`",
		v2Marked:
			'// edited-after-release: renamed before any reader\nsql`CREATE TABLE b`',
		v3SameMarker:
			'// edited-after-release: renamed before any reader\nsql`CREATE TABLE c`',
		v3NewMarker:
			'// edited-after-release: renamed before any reader\n// edited-after-release: c is unused\nsql`CREATE TABLE c`',
		other: 'sql`CREATE TABLE z`',
	}
	const read = blob => texts[blob]
	const shipped = [{ name: '0001_a.ts', blob: 'v1' }]
	const check = (base, head) =>
		shippedMigrationEdits({ shipped, base, head, read })

	describe('when this change edits a shipped migration beyond its imports', () => {
		it('should report it', () => {
			// GIVEN the base still holds the shipped version
			// WHEN the change rewrites its SQL
			const result = check(shipped, [{ name: '0001_a.ts', blob: 'v2' }])

			// THEN it is reported as edited
			assert.deepEqual(result, {
				problems: [{ kind: 'edited', file: '0001_a.ts' }],
				marked: [],
			})
		})
	})

	describe('when this change only moves an import', () => {
		it('should report nothing', () => {
			// GIVEN the shipped version on the base
			// WHEN only the import path changes
			const result = check(shipped, [{ name: '0001_a.ts', blob: 'v1Import' }])

			// THEN nothing is reported
			assert.deepEqual(result, { problems: [], marked: [] })
		})
	})

	describe('when this change adds a marker with its edit', () => {
		it('should accept it as marked', () => {
			// GIVEN the shipped version on the base
			// WHEN the change edits it and explains why
			const result = check(shipped, [{ name: '0001_a.ts', blob: 'v2Marked' }])

			// THEN it passes, listed as marked
			assert.deepEqual(result, { problems: [], marked: ['0001_a.ts'] })
		})
	})

	describe('when the marker was already there before this change', () => {
		it('should report a further edit that brings no new reason', () => {
			// GIVEN a marked edit already on the base
			const base = [{ name: '0001_a.ts', blob: 'v2Marked' }]

			// WHEN the change edits it again, keeping only the old marker
			const result = check(base, [{ name: '0001_a.ts', blob: 'v3SameMarker' }])

			// THEN the old marker does not cover the new edit
			assert.deepEqual(result.problems, [{ kind: 'edited', file: '0001_a.ts' }])
		})

		it('should accept a further edit that adds its own reason', () => {
			// GIVEN a marked edit already on the base
			const base = [{ name: '0001_a.ts', blob: 'v2Marked' }]

			// WHEN the change edits it again and adds a new marker line
			const result = check(base, [{ name: '0001_a.ts', blob: 'v3NewMarker' }])

			// THEN it passes
			assert.deepEqual(result, { problems: [], marked: ['0001_a.ts'] })
		})
	})

	describe('when the edit is already on the base and this change leaves the file alone', () => {
		it('should not blame this change', () => {
			// GIVEN an unmarked edit that reached the base some other way
			const base = [{ name: '0001_a.ts', blob: 'v2' }]

			// WHEN the change does not touch the file
			const result = check(base, base)

			// THEN nothing is reported
			assert.deepEqual(result, { problems: [], marked: [] })
		})
	})

	describe('when this change deletes a shipped migration', () => {
		it('should report it', () => {
			// GIVEN the shipped version on the base
			// WHEN the change removes the file
			const result = check(shipped, [])

			// THEN it is reported as deleted
			assert.deepEqual(result.problems, [
				{ kind: 'deleted', file: '0001_a.ts' },
			])
		})

		it('should not blame a change when the base already lost it', () => {
			// GIVEN the file is already gone from the base
			// WHEN the change doesn't bring it back
			const result = check([], [])

			// THEN nothing is reported
			assert.deepEqual(result, { problems: [], marked: [] })
		})
	})

	describe('when this change renames a shipped migration without editing it', () => {
		it('should report nothing', () => {
			// GIVEN the shipped version on the base
			// WHEN it is renamed under the same number, content unchanged
			const result = check(shipped, [{ name: '0001_renamed.ts', blob: 'v1' }])

			// THEN nothing is reported
			assert.deepEqual(result, { problems: [], marked: [] })
		})
	})

	describe('when a new file reuses a shipped number', () => {
		it('should leave it to the numbering check and not call it an edit', () => {
			// GIVEN the shipped version on the base
			// WHEN a new file with the same number is added next to it
			const head = [...shipped, { name: '001_dup.ts', blob: 'other' }]
			const result = check(shipped, head)

			// THEN the shipped file is untouched, so nothing is reported here
			assert.deepEqual(result, { problems: [], marked: [] })
		})
	})
})
