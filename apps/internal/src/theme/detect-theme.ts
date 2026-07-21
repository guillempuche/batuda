import { isThemePreference, type ThemePreference } from './index'

const STORAGE_KEY = 'batuda.theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

export function readStoredTheme(): ThemePreference | null {
	if (typeof window === 'undefined') return null
	try {
		const stored = window.localStorage.getItem(STORAGE_KEY)
		return isThemePreference(stored) ? stored : null
	} catch {
		return null
	}
}

export function writeStoredTheme(preference: ThemePreference): void {
	if (typeof window === 'undefined') return
	try {
		window.localStorage.setItem(STORAGE_KEY, preference)
	} catch {
		/* localStorage may be unavailable (private mode, quota) — fail silently. */
	}
}

/* Whether the operating system is currently asking for a dark appearance.
 * False on the server, which cannot know — that gap is why a page whose
 * preference is "system" needs the pre-paint script in the root route. */
export function prefersDarkNow(): boolean {
	if (typeof window === 'undefined' || !window.matchMedia) return false
	return window.matchMedia(DARK_QUERY).matches
}

/* Call `onChange` whenever the operating system flips between light and dark,
 * so a page following the system keeps up without a reload. Returns an
 * unsubscribe function. */
export function watchSystemTheme(
	onChange: (prefersDark: boolean) => void,
): () => void {
	if (typeof window === 'undefined' || !window.matchMedia) return () => {}
	const query = window.matchMedia(DARK_QUERY)
	const listener = (event: MediaQueryListEvent) => onChange(event.matches)
	query.addEventListener('change', listener)
	return () => query.removeEventListener('change', listener)
}
