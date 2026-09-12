import { dlgNoId, dlgWithId } from './dlg-search'

/* The dialogs the company page's panels open through the `?dlg=` URL param.
 * The page's route folds them into one search schema while validating the
 * address, which the router keeps in the main bundle — so they live here, apart
 * from the panels themselves, and the panels are only downloaded by the pages
 * that render them. */

// Each name is prefixed because the company page carries one `?dlg=` for all
// of its dialogs: two kinds sharing a name would leave the second unreachable.
export const documentsDlgMembers = [
	dlgWithId('doc-view'),
	dlgWithId('doc-edit'),
	dlgNoId('doc-add'),
] as const

// Only the id travels in the URL — a proposal holds nested line items, which
// have no business in a query string.
export const proposalsDlgMembers = [
	dlgWithId('proposal-edit'),
	dlgNoId('proposal-new'),
] as const
