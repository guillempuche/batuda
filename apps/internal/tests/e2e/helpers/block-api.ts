import type { Page } from '@playwright/test'

/**
 * Make one API endpoint fail for the rest of the page's life, so a screen's
 * behaviour when a request does not arrive can be read rather than guessed at.
 *
 * The path is anchored on `/v1/` deliberately. In dev the browser fetches the
 * app's own source files by path too, so a looser pattern like
 * `**\/company-facets*` also matches `company-facets-atoms.ts` and takes the
 * whole page down — which reads on screen as the very failure the test set out
 * to stage, only with nothing running to have caused it.
 *
 * `endpoint` is the last segment of the route, e.g. `company-facets`.
 */
export async function failApi(page: Page, endpoint: string): Promise<void> {
	await page.route(`**/v1/${endpoint}*`, route => route.abort())
}
