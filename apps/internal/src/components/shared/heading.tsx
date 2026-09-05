import type { ComponentPropsWithoutRef } from 'react'

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

/**
 * A heading whose level the caller picks, so a reusable block can sit at the
 * right depth in whatever page includes it — the order of headings is how
 * someone using a screen reader moves around a page, and a card that always
 * announced itself as an `<h2>` would break that ordering wherever it landed.
 *
 *   <Title level={3}>No companies yet</Title>
 *
 * The level is a prop rather than the element being swapped at the point of
 * use, because the styles are worked out while the app is built: what tag a
 * component renders has to be known by then, and only the small set below is
 * allowed, so `level={7}` is a mistake the compiler catches.
 */
export function Heading({
	level,
	...props
}: { level: HeadingLevel } & ComponentPropsWithoutRef<'h2'>) {
	const Tag = `h${level}` as const
	return <Tag {...props} />
}
