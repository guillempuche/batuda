import styled from 'styled-components'

/* Metal binder clip at the top of the clipboard — mobile only */
const ClipBar = styled.header.attrs({ 'data-component': 'ClipboardHeader' })`
	position: sticky;
	top: 0;
	z-index: 10;
	height: 3rem;
	display: flex;
	align-items: center;
	justify-content: center;
	background:
		repeating-linear-gradient(
			0deg,
			rgba(255, 255, 255, 0.04) 0,
			rgba(255, 255, 255, 0.04) 1px,
			transparent 1px,
			transparent 2px
		),
		linear-gradient(
			180deg,
			#d4d4d4 0%,
			#e8e8e8 15%,
			#c0c0c0 50%,
			#a8a8a8 85%,
			#909090 100%
		);
	border-bottom: 1px solid rgba(0, 0, 0, 0.15);
	box-shadow: 0 2px 4px rgba(0, 0, 0, 0.12);

	/* Binder clip mechanism protruding above */
	&::before {
		content: '';
		position: absolute;
		top: -6px;
		left: 50%;
		transform: translateX(-50%);
		width: 64px;
		height: 10px;
		background: linear-gradient(180deg, #989898, #b8b8b8);
		border-radius: 4px 4px 0 0;
		border: 1px solid rgba(0, 0, 0, 0.2);
		border-bottom: none;
	}

	/* Screw dots on left and right */
	&::after {
		content: '';
		position: absolute;
		top: 50%;
		left: var(--page-gutter);
		transform: translateY(-50%);
		width: 6px;
		height: 6px;
		border-radius: var(--shape-full);
		background: radial-gradient(circle at 35% 35%, #ccc, #888);
		box-shadow:
			calc(100vw - var(--page-gutter) - var(--page-gutter) - 6px) 0 0 0
			#aaa;
	}

	@media (min-width: 1024px) {
		display: none;
	}
`

/* Engraved brand name on the metal clip */
const BrandEngraving = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-label-large-size);
	font-weight: 700;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: #777;
	text-shadow:
		var(--text-shadow-engrave),
		var(--text-shadow-emboss);
`

export function ClipboardHeader() {
	return (
		<ClipBar>
			<BrandEngraving>Engranatge</BrandEngraving>
		</ClipBar>
	)
}
