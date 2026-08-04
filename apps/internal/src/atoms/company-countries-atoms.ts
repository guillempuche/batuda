import { Atom } from 'effect/unstable/reactivity'

import { BatudaApiAtom } from '#/lib/batuda-api-atom'

/**
 * Every country this organisation trades with, as stored — two-letter codes.
 *
 * The companies list used to build its country filter from whichever companies
 * were on screen, which meant a country further down the list could not be
 * filtered for at all. Same reasoning as the trades list beside it.
 *
 * Kept alive because it changes about as often as the org gains a first company
 * somewhere new, and the list page asks for it on every visit.
 */
export const companyCountriesAtom = Atom.keepAlive(
	BatudaApiAtom.query('companies', 'countries', {}),
)
