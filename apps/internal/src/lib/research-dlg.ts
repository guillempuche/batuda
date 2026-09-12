import { dlgNoId } from './dlg-search'

// Whether the "Find companies" dialog is open lives in the `?dlg=discovery`
// URL param — like the other dialogs in the app — so it is deep-linkable and
// the back button closes it. The research routes validate this schema; a value
// outside it decodes to nothing and the dialog stays closed. It sits here rather
// than with the screens because the routes read it while validating the address,
// which the router keeps in the main bundle.
export const researchDlgSchema = dlgNoId('discovery')
