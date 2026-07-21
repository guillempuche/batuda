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
import {
	defaultThemePreference,
	resolveTheme,
	type ThemeCode,
	type ThemePreference,
} from './index'

type ThemeContextValue = {
	/* What the user picked, which may be "system". */
	preference: ThemePreference
	/* What is actually painted right now — never "system". */
	theme: ThemeCode
	setPreference: (next: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue>({
	preference: defaultThemePreference,
	theme: 'light',
	setPreference: () => {},
})

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

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only reconcile against localStorage
	useEffect(() => {
		const stored = readStoredTheme() ?? preference
		apply(stored, prefersDarkNow())
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
	return use(ThemeContext).theme
}

export function useThemePreference(): ThemePreference {
	return use(ThemeContext).preference
}

export function useSetThemePreference(): (next: ThemePreference) => void {
	return use(ThemeContext).setPreference
}
