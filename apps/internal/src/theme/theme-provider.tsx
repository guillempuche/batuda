import {
	createContext,
	type ReactNode,
	use,
	useCallback,
	useEffect,
	useState,
} from 'react'

import { writeThemeCookie } from './cookie'
import {
	prefersDarkNow,
	readStoredTheme,
	watchSystemTheme,
	writeStoredTheme,
} from './detect-theme'
import { resolveTheme, type ThemeCode, type ThemePreference } from './index'

type ThemeContextValue = {
	/* What the user picked, which may be "system". */
	preference: ThemePreference
	/* What is actually painted right now — never "system". */
	theme: ThemeCode
	setPreference: (next: ThemePreference) => void
}

/* Points the browser's own chrome at whatever the page is actually painted in.
 * The value is read back from the stylesheet rather than repeated here, so it
 * cannot drift from the theme it is meant to match. */
function syncBrowserChromeTint(): void {
	const meta = document.querySelector('meta[name="theme-color"]')
	if (!meta) return
	const surface = getComputedStyle(document.documentElement)
		.getPropertyValue('--color-surface')
		.trim()
	if (surface) meta.setAttribute('content', surface)
}

/* No default value: a component reading this outside the provider would
 * otherwise be told the theme is light and handed a setter that does nothing,
 * so it would look fine on a dark page and silently ignore every change. */
const ThemeContext = createContext<ThemeContextValue | null>(null)

function useThemeContext(): ThemeContextValue {
	const value = use(ThemeContext)
	if (!value) {
		throw new Error('Theme hooks need a <ThemeProvider> above them.')
	}
	return value
}

/* Owns the active theme for the whole app. `initialPreference` comes from the
 * root route context (server-parsed cookie), so SSR and the first client render
 * agree.
 *
 * Two things happen on mount that the server could not do: reconcile against
 * localStorage in case the cookie was cleared, and — when following the system
 * — read what the system actually wants, which no request header carries. */
export function ThemeProvider({
	initialPreference,
	initialTheme,
	children,
}: {
	initialPreference: ThemePreference
	initialTheme: ThemeCode
	children: ReactNode
}) {
	const [preference, setPreferenceState] =
		useState<ThemePreference>(initialPreference)
	const [theme, setTheme] = useState<ThemeCode>(initialTheme)

	const apply = useCallback((next: ThemePreference, prefersDark: boolean) => {
		const resolved = resolveTheme(next, prefersDark)
		setPreferenceState(next)
		setTheme(resolved)
		if (typeof document !== 'undefined') {
			document.documentElement.setAttribute('data-theme', resolved)
			syncBrowserChromeTint()
		}
	}, [])

	const setPreference = useCallback(
		(next: ThemePreference) => {
			apply(next, prefersDarkNow())
			writeStoredTheme(next)
			writeThemeCookie(next)
		},
		[apply],
	)

	/* Reconcile against localStorage, which the server could not read. When the
	 * two disagree the cookie is rewritten too — applying the stored value
	 * without it would leave the server painting the other theme on every
	 * later load, flashing forever. */
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only reconcile against localStorage
	useEffect(() => {
		const stored = readStoredTheme()
		if (stored && stored !== preference) {
			setPreference(stored)
			return
		}
		apply(preference, prefersDarkNow())
	}, [])

	/* Only a system-following page cares when the operating system flips. */
	useEffect(() => {
		if (preference !== 'system') return
		return watchSystemTheme(prefersDark => apply('system', prefersDark))
	}, [preference, apply])

	return (
		<ThemeContext value={{ preference, theme, setPreference }}>
			{children}
		</ThemeContext>
	)
}

export function useTheme(): ThemeCode {
	return useThemeContext().theme
}

export function useThemePreference(): ThemePreference {
	return useThemeContext().preference
}

export function useSetThemePreference(): (next: ThemePreference) => void {
	return useThemeContext().setPreference
}
