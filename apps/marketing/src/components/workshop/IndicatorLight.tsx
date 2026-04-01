import styled from 'styled-components'

const colors = {
	green: 'var(--color-secondary)',
	amber: '#C4851C',
	red: 'var(--color-error)',
} as const

const Dot = styled.span<{ $color: string }>`
	display: inline-block;
	width: 8px;
	height: 8px;
	border-radius: var(--shape-full);
	background: ${p => p.$color};
	box-shadow: 0 0 6px ${p => p.$color}4d;
`

export function IndicatorLight({
	color = 'green',
}: {
	color?: keyof typeof colors
}) {
	return <Dot $color={colors[color]} />
}
