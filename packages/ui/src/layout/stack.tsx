import { styled } from 'next-yak'

import { SPACE, type SpaceToken } from './tokens'

/**
 * Vertical stack — a flex column with consistent gap between children.
 * The most common layout primitive; replace ad-hoc `flex-direction: column`
 * + `gap` blocks with `<Stack $gap="md">`.
 *
 *   <Stack $gap="md">
 *     <Card />
 *     <Card />
 *   </Stack>
 *
 * Reference: every-layout.dev/layouts/stack
 */
export const Stack = styled.div<{ $gap?: SpaceToken }>`
	display: flex;
	flex-direction: column;
	gap: ${p => SPACE[p.$gap ?? 'md']};
`
