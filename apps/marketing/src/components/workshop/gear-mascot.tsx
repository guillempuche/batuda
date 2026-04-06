import styled from 'styled-components'

const expressions = {
	default: '⚙️',
	building: '🔧',
	celebrating: '🎉',
	sleeping: '😴',
	thinking: '🤔',
} as const

const Circle = styled.span.attrs({ 'data-component': 'GearMascot' })<{
	$size: number
}>`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: ${p => p.$size}px;
	height: ${p => p.$size}px;
	border-radius: var(--shape-full);
	background: var(--color-surface-container-low);
	font-size: ${p => p.$size * 0.5}px;
	flex-shrink: 0;
`

export function GearMascot({
	expression = 'default',
	size = 64,
}: {
	expression?: keyof typeof expressions
	size?: number
}) {
	return (
		<Circle $size={size} role='img' aria-label='Engranatge mascot'>
			{expressions[expression]}
		</Circle>
	)
}
