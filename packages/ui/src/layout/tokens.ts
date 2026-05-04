/**
 * Space-token suffixes corresponding to `--space-*` custom properties
 * defined in `packages/ui/src/tokens.css`. Layout primitives accept a
 * suffix and prepend `var(--space-)` so consumers don't repeat the
 * prefix everywhere.
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
