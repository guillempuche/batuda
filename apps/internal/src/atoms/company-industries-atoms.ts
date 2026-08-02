import { Atom } from 'effect/unstable/reactivity'

import { BatudaApiAtom } from '#/lib/batuda-api-atom'

/**
 * The organisation's own list of trades.
 *
 * One atom for the whole app: the company page offers it while typing, the
 * companies list filters by it, and the settings page curates it. Filtering it
 * from the companies already on screen — what the list used to do — only ever
 * offered the trades on the page being looked at, so a trade further down the
 * list could not be filtered for at all.
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
