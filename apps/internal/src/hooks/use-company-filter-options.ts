import { useAtomValue } from '@effect/atom-react'
import type { I18n } from '@lingui/core'
import { useLingui } from '@lingui/react'
import { AsyncResult } from 'effect/unstable/reactivity'
import { useEffect, useMemo, useRef } from 'react'

import type { CompaniesSearch } from '#/atoms/companies-atoms'
import { companyFacetsAtom } from '#/atoms/company-facets-atoms'
import { verdictLabel } from '#/lib/company-fit-verdict'
import { countryName } from '#/lib/country-name'
import { useCompanyIndustries } from './use-company-industries'

type FilterOption = {
	readonly value: string
	readonly label: string
	readonly count: number
}

type FilterOptions = {
	readonly countries: ReadonlyArray<FilterOption>
	readonly industries: ReadonlyArray<FilterOption>
	// Picked several at a time, so there is no single chosen value to spell the
	// menu's way — the entries carry what was counted and whatever is already
	// ticked, and the control matches them by value.
	readonly tags: ReadonlyArray<FilterOption>
	readonly fitVerdicts: ReadonlyArray<FilterOption>
	// The entry the filter in force corresponds to, spelled the menu's way. A
	// filter can be written more than one way — a trade by its stored form or
	// its name, a country code in either casing — and a selector can only point
	// at a value its own list holds.
	readonly industryValue: string | undefined
}

const NOTHING_YET = {
	countries: [] as ReadonlyArray<FilterOption>,
	industries: [] as ReadonlyArray<FilterOption>,
	tags: [] as ReadonlyArray<FilterOption>,
	fitVerdicts: [] as ReadonlyArray<FilterOption>,
}

/**
 * The same two halves as `menuFor`, for a filter that holds several values at
 * once: whatever would find something, plus whatever is already ticked.
 *
 * The order is the server's — commonest first — because a list of tags has no
 * natural order the reader already knows, unlike a country or a trade name.
 */
const multiMenuFor = (
	counted: ReadonlyArray<FilterOption>,
	chosen: ReadonlyArray<string> | undefined,
	// How to name a value the counts do not mention. Without it such a row falls
	// back to the stored value, and the one moment a reader most needs to
	// recognise the filter in force is the moment it reads `strong_fit`.
	labelOf: (value: string) => string = value => value,
): ReadonlyArray<FilterOption> => {
	const picked = new Set(chosen ?? [])
	const offered = counted.filter(
		option => option.count > 0 || picked.has(option.value),
	)
	// A value in force that the count no longer mentions still belongs on the
	// list, or there is no way to untick it.
	const missing = [...picked].filter(
		value => !offered.some(option => option.value === value),
	)
	return [
		...offered,
		...missing.map(value => ({ value, label: labelOf(value), count: 0 })),
	]
}

/**
 * What one menu should offer: whatever would find something, plus whatever is
 * already chosen.
 *
 * Both halves are load-bearing. Without the first, a menu offers narrowings
 * that can only empty the list. Without the second, a value with nothing left
 * behind it is dropped while it is still in force, leaving the button naming a
 * filter the menu denies and no way back but clearing every filter.
 *
 * `same` decides when an entry already covers the chosen value. A filter can
 * name a trade by its stored form or by its name, and both reach the same
 * trade, so comparing the two as text would offer it twice.
 */
const menuFor = (
	counted: ReadonlyArray<FilterOption>,
	chosen: string | undefined,
	labelOf: (value: string) => string,
	same: (option: FilterOption, chosen: string) => boolean,
	locale: string,
): {
	readonly entries: ReadonlyArray<FilterOption>
	readonly chosenValue: string | undefined
} => {
	const offered = counted.filter(
		o => o.count > 0 || (chosen !== undefined && same(o, chosen)),
	)
	const chosenEntry =
		chosen === undefined ? undefined : offered.find(o => same(o, chosen))
	const withChosen =
		chosen === undefined || chosenEntry !== undefined
			? offered
			: [...offered, { value: chosen, label: labelOf(chosen), count: 0 }]
	return {
		entries: withChosen
			.slice()
			.sort((a, b) => a.label.localeCompare(b.label, locale)),
		chosenValue:
			chosen === undefined ? undefined : (chosenEntry?.value ?? chosen),
	}
}

/**
 * The countries and trades to offer beside a filtered list of companies.
 *
 * Countries arrive as stored codes and are named in the reader's language here,
 * so both menus end up sorted by the name actually on screen.
 */
export function useCompanyFilterOptions(
	search: CompaniesSearch,
): FilterOptions {
	const result = useAtomValue(companyFacetsAtom(search))
	const { i18n } = useLingui()
	const locale = i18n.locale
	// The organisation's own trade names, for the one entry the counts cannot
	// supply: a trade nobody is on. Spelling its stored form back out would drop
	// the accents and the capitals somebody typed.
	const { labelFor } = useCompanyIndustries()
	// The menus hold on to the entries they were last given while the next count
	// is on its way. Emptying them mid-flight is not merely cosmetic: a dropdown
	// whose list stops holding the value it is set to reads that as nobody having
	// chosen it and clears it, which would undo a filter the instant it was
	// picked, since picking one is what starts the next count.
	const lastShown = useRef<typeof NOTHING_YET>(NOTHING_YET)

	const shown = useMemo(() => {
		if (!AsyncResult.isSuccess(result)) return undefined
		const facets = result.value
		const countries = multiMenuFor(
			facets.country
				.map(c => ({
					value: c.value,
					label: countryName(c.value, locale) ?? c.value,
					count: c.count,
				}))
				.sort((a, b) => a.label.localeCompare(b.label, locale)),
			search.country,
			code => countryName(code, locale) ?? code,
		)
		const industries = menuFor(
			facets.industry.map(i => ({
				value: i.slug,
				label: i.label,
				count: i.count,
			})),
			search.industry,
			slug => labelFor(slug) ?? slug,
			// A trade answers to its stored form or to its name, and the filter
			// resolves either — so an entry whose own name is what was asked for
			// is that trade, not a second one.
			(option, chosen) =>
				option.value === chosen ||
				option.label.toLowerCase() === chosen.toLowerCase(),
			locale,
		)
		return {
			countries,
			industries: industries.entries,
			tags: multiMenuFor(
				facets.tags.map(t => ({
					value: t.value,
					label: t.value,
					count: t.count,
				})),
				search.tags,
			),
			fitVerdicts: multiMenuFor(
				facets.fitVerdict.map(v => ({
					value: v.value,
					label: verdictLabel(i18n, v.value),
					count: v.count,
				})),
				search.fitVerdict,
				value => verdictLabel(i18n, value),
			),
			industryValue: industries.chosenValue,
		}
	}, [
		result,
		locale,
		i18n,
		search.country,
		search.industry,
		search.tags,
		search.fitVerdict,
		labelFor,
	])

	// Kept after the render is committed, never during it: a render React throws
	// away must not leave these menus behind for filters nobody ever saw.
	useEffect(() => {
		if (shown !== undefined)
			lastShown.current = {
				countries: shown.countries,
				industries: shown.industries,
				tags: shown.tags,
				fitVerdicts: shown.fitVerdicts,
			}
	}, [shown])

	if (shown !== undefined) return shown
	// Nothing has arrived yet, or the count failed. Either way the filters in
	// force still belong on screen, so they can be read and lifted.
	return keepChosen(lastShown.current, search, labelFor, locale, i18n)
}

/**
 * The last menus that arrived, with any filter they do not mention added back.
 *
 * A failed count would otherwise leave a filter on the list with no entry
 * naming it, which is both unreadable and impossible to undo from the menu.
 */
const keepChosen = (
	shown: {
		readonly countries: ReadonlyArray<FilterOption>
		readonly industries: ReadonlyArray<FilterOption>
		readonly tags: ReadonlyArray<FilterOption>
		readonly fitVerdicts: ReadonlyArray<FilterOption>
	},
	search: CompaniesSearch,
	labelFor: (slug: string) => string | null,
	locale: string,
	i18n: I18n,
): FilterOptions => {
	const countries = multiMenuFor(
		shown.countries,
		search.country,
		code => countryName(code, locale) ?? code,
	)
	const industries = menuFor(
		shown.industries,
		search.industry,
		slug => labelFor(slug) ?? slug,
		(option, chosen) =>
			option.value === chosen ||
			option.label.toLowerCase() === chosen.toLowerCase(),
		locale,
	)
	return {
		countries,
		industries: industries.entries,
		tags: multiMenuFor(shown.tags, search.tags),
		fitVerdicts: multiMenuFor(shown.fitVerdicts, search.fitVerdict, value =>
			verdictLabel(i18n, value),
		),
		industryValue: industries.chosenValue,
	}
}
