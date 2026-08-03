import { useAtomValue } from '@effect/atom-react'
import { AsyncResult } from 'effect/unstable/reactivity'
import { useMemo } from 'react'

import {
	type CompanyIndustry,
	companyIndustriesAtom,
} from '#/atoms/company-industries-atoms'

/**
 * The organisation's trades, ready to show.
 *
 * A company row carries its trade's web-address form, which is what makes a
 * filter and a shared link work with no join — but it is not what anybody wrote
 * or wants to read. `labelFor` turns it back into the name.
 *
 * A trade the list does not have is spelled out rather than shown as it is
 * stored. That happens twice: while the list is still on its way, and just
 * after somebody renames a trade, when rows already on screen still carry the
 * old form. Neither is worth a hyphenated word on the screen.
 */
export function useCompanyIndustries(): {
	readonly industries: ReadonlyArray<CompanyIndustry>
	readonly labels: ReadonlyArray<string>
	readonly labelFor: (slug: string | null | undefined) => string | null
} {
	const result = useAtomValue(companyIndustriesAtom)

	return useMemo(() => {
		const industries: ReadonlyArray<CompanyIndustry> = AsyncResult.isSuccess(
			result,
		)
			? result.value
			: []
		const bySlug = new Map(industries.map(i => [i.slug, i.label]))
		return {
			industries,
			labels: industries.map(i => i.label),
			labelFor: (slug: string | null | undefined) =>
				slug === null || slug === undefined || slug === ''
					? null
					: (bySlug.get(slug) ?? spellOut(slug)),
		}
	}, [result])
}

const spellOut = (slug: string): string => {
	const words = slug.replaceAll('-', ' ')
	return words.charAt(0).toUpperCase() + words.slice(1)
}
