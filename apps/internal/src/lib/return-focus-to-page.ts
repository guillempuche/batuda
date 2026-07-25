const SETTLE_STEP_MS = 50
const SETTLE_LIMIT_MS = 600

/**
 * Put keyboard focus back on the page after a dialog closes.
 *
 * A dialog hands focus back to whatever opened it, but one opened straight from
 * the address bar had no opener, so focus is left on nothing: the next Tab
 * starts again from the top of the app and a screen reader loses its place.
 * Landing on the main region keeps the reader roughly where they were. A closing
 * dialog holds focus until its fade-out finishes, so this watches for a short
 * while rather than checking once, and never fires when the dialog hands focus
 * back itself.
 */
export function returnFocusToPage(): void {
	if (typeof document === 'undefined') return

	let waited = 0
	const check = () => {
		if (document.activeElement === document.body) {
			const main = document.querySelector('main')
			if (main !== null) {
				if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1')
				main.focus({ preventScroll: true })
			}
			return
		}
		waited += SETTLE_STEP_MS
		if (waited < SETTLE_LIMIT_MS) setTimeout(check, SETTLE_STEP_MS)
	}
	setTimeout(check, SETTLE_STEP_MS)
}
