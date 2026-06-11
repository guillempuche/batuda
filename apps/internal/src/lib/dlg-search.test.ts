import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { dlgNoId, dlgWithId } from '#/lib/dlg-search'
import { validateSearchWith } from '#/lib/search-schema'

// A representative route vocabulary: one dialog that opens on its own and two
// that target a row. This mirrors how routes/emails/inboxes.tsx declares its
// dialogs, so the decode behaviour asserted here is the real route contract.
const dlg = Schema.Union([
	dlgNoId('create'),
	dlgWithId('edit'),
	dlgWithId('footers'),
])

// `validateSearch` receives the already-parsed search object (TanStack turns
// the nested JSON back into JS before calling it), so we decode plain objects.
const decode = validateSearchWith({ dlg })
const decodeWithSibling = validateSearchWith({
	dlg,
	companyId: Schema.NonEmptyString,
})

describe('dialog search-param vocabulary [dlg-search.ts]', () => {
	describe('when the param is a recognised dialog with no target', () => {
		it('should decode to that dialog', () => {
			// GIVEN ?dlg={kind:'create'} (post-parse object)
			// WHEN validated by the route [search-schema.ts:15 validateSearchWith]
			// THEN the create dialog is recognised
			expect(decode({ dlg: { kind: 'create' } })).toEqual({
				dlg: { kind: 'create' },
			})
		})
	})

	describe('when the param targets a row with a non-empty id', () => {
		it('should decode kind and id together', () => {
			// GIVEN ?dlg={kind:'edit',id:'inbox-42'}
			// WHEN validated
			// THEN both fields round-trip [dlg-search.ts:18 dlgWithId]
			expect(decode({ dlg: { kind: 'edit', id: 'inbox-42' } })).toEqual({
				dlg: { kind: 'edit', id: 'inbox-42' },
			})
		})
	})

	describe('when the kind is outside the route vocabulary', () => {
		it('should drop dlg so the dialog stays closed', () => {
			// GIVEN a kind this route never declared (e.g. pasted from another page)
			// WHEN validated
			// THEN dlg is omitted — the scope gate keeps the dialog closed
			expect(decode({ dlg: { kind: 'bogus' } })).toEqual({})
			expect(decode({ dlg: { kind: 'bogus' } }).dlg).toBeUndefined()
		})
	})

	describe('when an entity dialog is missing its id', () => {
		it('should reject it and stay closed', () => {
			// GIVEN an edit/footers variant with no id, or an empty id
			// WHEN validated [dlg-search.ts:18 dlgWithId requires NonEmptyString]
			// THEN dlg is dropped rather than opening a dialog with no target
			expect(decode({ dlg: { kind: 'edit' } })).toEqual({})
			expect(decode({ dlg: { kind: 'edit', id: '' } })).toEqual({})
		})
	})

	describe('when dlg is malformed next to a valid sibling param', () => {
		it('should keep the sibling and drop only dlg', () => {
			// GIVEN ?dlg=<bad>&companyId=c1
			// WHEN validated [search-schema.ts:7 per-field tolerance]
			// THEN companyId survives even though dlg failed
			expect(
				decodeWithSibling({ dlg: { kind: 'bogus' }, companyId: 'c1' }),
			).toEqual({ companyId: 'c1' })
		})
	})

	describe('when there is no dlg param at all', () => {
		it('should produce no dialog', () => {
			// GIVEN a URL with no ?dlg=
			// WHEN validated
			// THEN the result carries no dialog
			expect(decode({})).toEqual({})
		})
	})

	describe('when following a deep link with a url-encoded dialog', () => {
		it('should round-trip the structured value', () => {
			// GIVEN a shared link ?dlg=<url-encoded JSON>
			const encoded =
				'%7B%22kind%22%3A%22edit%22%2C%22id%22%3A%22inbox-42%22%7D'
			// WHEN the browser decodes + parses it the way TanStack does
			const parsed: unknown = JSON.parse(decodeURIComponent(encoded))
			// THEN validateSearch recovers the typed dialog
			expect(decode({ dlg: parsed })).toEqual({
				dlg: { kind: 'edit', id: 'inbox-42' },
			})
		})
	})
})
