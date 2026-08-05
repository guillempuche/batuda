import { useAtomValue } from '@effect/atom-react'
import { useLingui } from '@lingui/react'
import { AsyncResult } from 'effect/unstable/reactivity'
import { useMemo } from 'react'

import { companyCountriesAtom } from '#/atoms/company-countries-atoms'
import { countryName } from '#/lib/country-name'

/**
 * The organisation's countries, ready to show — each as a stored code plus its
 * name in the reader's language, sorted by that name so the list reads in the
 * order a person would look for.
 */
export function useCompanyCountries(): {
	readonly countries: ReadonlyArray<{
		readonly code: string
		readonly label: string
	}>
	readonly labelFor: (code: string | null | undefined) => string | null
} {
	const result = useAtomValue(companyCountriesAtom)
	const { i18n } = useLingui()
	const locale = i18n.locale

	return useMemo(() => {
		const codes: ReadonlyArray<string> = AsyncResult.isSuccess(result)
			? result.value
			: []
		const countries = codes
			.map(code => ({ code, label: countryName(code, locale) ?? code }))
			.sort((a, b) => a.label.localeCompare(b.label, locale))
		return {
			countries,
			labelFor: (code: string | null | undefined) => countryName(code, locale),
		}
	}, [result, locale])
}
