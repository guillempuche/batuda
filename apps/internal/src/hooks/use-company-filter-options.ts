import { useAtomValue } from '@effect/atom-react'
import { useLingui } from '@lingui/react'
import { AsyncResult } from 'effect/unstable/reactivity'
import { useEffect, useMemo, useRef } from 'react'

import type { CompaniesSearch } from '#/atoms/companies-atoms'
import { companyFacetsAtom } from '#/atoms/company-facets-atoms'
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
	// The entry the filter in force corresponds to, spelled the menu's way. A
	// filter can be written more than one way — a trade by its stored form or
	// its name, a country code in either casing — and a selector can only point
	// at a value its own list holds.
	readonly countryValue: string | undefined
	readonly industryValue: string | undefined
}

const NOTHING_YET = {
	countries: [] as ReadonlyArray<FilterOption>,
	industries: [] as ReadonlyArray<FilterOption>,
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

/** Two ways of writing one country: the stored code, in any casing. */
const sameCountry = (option: FilterOption, chosen: string): boolean =>
	option.value.toUpperCase() === chosen.toUpperCase()

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
		const countries = menuFor(
			facets.country.map(c => ({
				value: c.value,
				label: countryName(c.value, locale) ?? c.value,
				count: c.count,
			})),
			search.country,
			code => countryName(code, locale) ?? code,
			sameCountry,
			locale,
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
			countries: countries.entries,
			industries: industries.entries,
			countryValue: countries.chosenValue,
			industryValue: industries.chosenValue,
		}
	}, [result, locale, search.country, search.industry, labelFor])

	// Kept after the render is committed, never during it: a render React throws
	// away must not leave these menus behind for filters nobody ever saw.
	useEffect(() => {
		if (shown !== undefined)
			lastShown.current = {
				countries: shown.countries,
				industries: shown.industries,
			}
	}, [shown])

	if (shown !== undefined) return shown
	// Nothing has arrived yet, or the count failed. Either way the filters in
	// force still belong on screen, so they can be read and lifted.
	return keepChosen(lastShown.current, search, labelFor, locale)
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
	},
	search: CompaniesSearch,
	labelFor: (slug: string) => string | null,
	locale: string,
): FilterOptions => {
	const countries = menuFor(
		shown.countries,
		search.country,
		code => countryName(code, locale) ?? code,
		sameCountry,
		locale,
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
		countries: countries.entries,
		industries: industries.entries,
		countryValue: countries.chosenValue,
		industryValue: industries.chosenValue,
	}
}
