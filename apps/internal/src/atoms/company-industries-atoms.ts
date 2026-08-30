import { Atom } from 'effect/unstable/reactivity'

import { BatudaApiAtom } from '#/lib/batuda-api-atom'

/**
 * The organisation's own list of trades.
 *
 * One atom for the whole app: the company page offers it while typing and the
 * settings page curates it. This is the organisation's whole list, used or not,
 * which is why the companies list does not filter from it — that menu offers
 * the trades somebody is on, counted against the filters already set.
 *
 * Kept alive because it changes rarely and is read on nearly every screen. One
 * atom for all of them means the settings page refreshing it after a rename
 * repaints the others too, without any of them asking.
 */
export type CompanyIndustry = {
	readonly id: string
	readonly label: string
	readonly slug: string
	readonly needsReview: boolean
	readonly companyCount: number
}

export const companyIndustriesAtom = Atom.keepAlive(
	BatudaApiAtom.query('companyIndustries', 'list', {}),
)
