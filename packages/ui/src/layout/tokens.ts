/**
 * Space-token suffixes corresponding to `--space-*` custom properties
 * defined in `packages/ui/src/tokens.css`. Layout primitives accept a
 * suffix so consumers don't repeat the prefix everywhere.
 */
export type SpaceToken =
	| '3xs'
	| '2xs'
	| 'xs'
	| 'sm'
	| 'md'
	| 'lg'
	| 'xl'
	| '2xl'
	| '3xl'
	| '4xl'
	| '5xl'

/**
 * The whole `var()` reference for each suffix, so a primitive resolves
 * `$gap` to a complete value rather than pasting the suffix into the
 * middle of a custom-property name. Building the name — `var(--space-${p
 * => p.$gap})` — reads fine and is a trap: any build step that resolves
 * the interpolation to a variable of its own produces `var(--space-var(
 * --generated))`, which is not a property name and not valid CSS.
 */
export const SPACE: Record<SpaceToken, string> = {
	'3xs': 'var(--space-3xs)',
	'2xs': 'var(--space-2xs)',
	xs: 'var(--space-xs)',
	sm: 'var(--space-sm)',
	md: 'var(--space-md)',
	lg: 'var(--space-lg)',
	xl: 'var(--space-xl)',
	'2xl': 'var(--space-2xl)',
	'3xl': 'var(--space-3xl)',
	'4xl': 'var(--space-4xl)',
	'5xl': 'var(--space-5xl)',
}
