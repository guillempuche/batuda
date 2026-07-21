import { expect, type Page } from '@playwright/test'

/**
 * Waits until React has taken over an element, then returns.
 *
 * Pages are rendered on the server, so a control is visible — and fillable —
 * well before the code behind it exists. Anything that only happens in the
 * browser (a button that calls a handler rather than submitting a form) does
 * nothing at all until then. In dev the gap is seconds rather than
 * milliseconds, because the browser bundle is built the first time a route is
 * asked for.
 *
 * Waiting for the control to be visible is therefore not enough: the test
 * types, clicks, and moves on while the page is still inert, and the failure
 * looks like the feature is broken rather than like a race.
 */
export async function waitForInteractive(
	page: Page,
	testId: string,
): Promise<void> {
	await expect(async () => {
		const attached = await page.evaluate(id => {
			const element = document.querySelector(`[data-testid="${id}"]`)
			// React hangs its own bookkeeping off the DOM node under a prefixed
			// key, and its presence is the one honest signal that handlers exist.
			// This does reach into a framework detail, which a test would normally
			// avoid — but nothing observable distinguishes a rendered button from
			// a live one, and the alternatives are worse: a fixed sleep is a guess
			// that rots, and clicking on a retry loop would send a second email
			// every time the first click did land.
			return element
				? Object.keys(element).some(key => key.startsWith('__react'))
				: false
		}, testId)
		expect(attached, `${testId} should be interactive`).toBe(true)
	}).toPass({ timeout: 30_000 })
}
