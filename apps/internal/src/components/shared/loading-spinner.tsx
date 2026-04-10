import styled, { keyframes } from 'styled-components'

/**
 * Lightweight CSS-only spinner. Rare on SSR-hydrated screens — used
 * mainly for post-mutation refreshes and parameterized atoms that
 * can't be seeded from route loaders.
 */
export function LoadingSpinner({
	size = 'md',
	label = 'Loading…',
}: {
	size?: 'sm' | 'md' | 'lg'
	label?: string
}) {
	return (
		<Wrapper role='status' aria-label={label}>
			<Circle $size={size} />
		</Wrapper>
	)
}

const spin = keyframes`
	to { transform: rotate(360deg); }
`

const Wrapper = styled.div.withConfig({ displayName: 'LoadingSpinnerWrapper' })`
	display: inline-flex;
	align-items: center;
	justify-content: center;
`

const sizeMap = { sm: '1rem', md: '1.5rem', lg: '2.25rem' } as const

const Circle = styled.span.withConfig({
	displayName: 'LoadingSpinnerCircle',
	shouldForwardProp: prop => prop !== '$size',
})<{ $size: 'sm' | 'md' | 'lg' }>`
	display: inline-block;
	width: ${p => sizeMap[p.$size]};
	height: ${p => sizeMap[p.$size]};
	border: 2px solid
		color-mix(in srgb, var(--color-primary) 24%, transparent);
	border-top-color: var(--color-primary);
	border-radius: var(--shape-full);
	animation: ${spin} 800ms linear infinite;
`
