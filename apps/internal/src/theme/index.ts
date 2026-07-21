/* The themes Batuda serves, plus the "follow the system" option. Values live
 * in `packages/ui/src/tokens.css`; the direction behind them is documented in
 * `docs/brand-visual.md` §Dark Workshop. */
export const themeCodes = ['light', 'dark', 'dark-hc'] as const
export type ThemeCode = (typeof themeCodes)[number]

/* What the user picked. "system" is a preference, never a theme: it means
 * follow whatever the operating system currently asks for. */
export const themePreferences = ['system', ...themeCodes] as const
export type ThemePreference = (typeof themePreferences)[number]

/* Used when there is no stored preference at all. Following the system is
 * the least surprising first impression. */
export const defaultThemePreference: ThemePreference = 'system'

/* What the page falls back to before the system preference is known — the
 * bare `:root` block, which is the light theme. */
export const defaultTheme: ThemeCode = 'light'

export function isThemeCode(value: unknown): value is ThemeCode {
	return (
		typeof value === 'string' &&
		(themeCodes as readonly string[]).includes(value)
	)
}

export function isThemePreference(value: unknown): value is ThemePreference {
	return (
		typeof value === 'string' &&
		(themePreferences as readonly string[]).includes(value)
	)
}

/* Turn a preference into the theme actually painted. Only "system" needs the
 * caller to say what the operating system asked for. */
export function resolveTheme(
	preference: ThemePreference,
	prefersDark: boolean,
): ThemeCode {
	if (preference === 'system') return prefersDark ? 'dark' : 'light'
	return preference
}
