import styled from 'styled-components'

import { workshopButtonStyles } from '#/components/layout/workshop-button'

/* Workshop control panel — riveted metal plate mounted on pegboard */
const Panel = styled.div.withConfig({ displayName: 'ControlPanel' })`
	background:
		var(--texture-brushed-metal),
		linear-gradient(145deg, var(--color-metal) 0%, var(--color-metal) 40%, var(--color-metal-dark) 100%);
	border: 2px solid var(--color-outline);
	padding: var(--space-2xl);
	position: relative;

	/* Corner rivets */
	&::before,
	&::after {
		content: '';
		position: absolute;
		width: 10px;
		height: 10px;
		border-radius: var(--shape-full);
		background: radial-gradient(circle at 35% 35%, var(--color-metal-light), var(--color-metal-deep));
		border: 1px solid rgba(0, 0, 0, 0.15);
		box-shadow: var(--elevation-workshop-sm);
	}

	&::before {
		top: var(--space-sm);
		left: var(--space-sm);
	}

	&::after {
		bottom: var(--space-sm);
		right: var(--space-sm);
	}
`

const Heading = styled.h2`
	font-size: var(--typescale-headline-small-size);
	line-height: var(--typescale-headline-small-line);
	color: var(--color-on-surface);
	margin-bottom: var(--space-xs);
`

const Body = styled.p`
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	color: var(--color-on-surface-variant);
	margin-bottom: var(--space-xl);
`

const Actions = styled.div`
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-sm);
`

const PrimaryButton = styled.a`
	${workshopButtonStyles}
	padding: var(--space-sm) var(--space-xl);
`

const SecondaryButton = styled.a`
	display: inline-flex;
	align-items: center;
	padding: var(--space-sm) var(--space-xl);
	background: transparent;
	color: var(--color-on-surface);
	border: 2px dashed var(--color-outline);
	border-radius: 0;
	font-size: var(--typescale-label-large-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	text-decoration: none;
	transition:
		border-color 0.15s,
		color 0.15s;
	cursor: pointer;

	&:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 3px;
	}
`

export function ControlPanel({
	heading,
	body,
	primaryLabel,
	primaryHref,
	secondaryLabel,
	secondaryHref,
}: {
	heading: string
	body: string
	primaryLabel: string
	primaryHref: string
	secondaryLabel?: string
	secondaryHref?: string
}) {
	return (
		<Panel>
			<Heading>{heading}</Heading>
			<Body>{body}</Body>
			<Actions>
				<PrimaryButton href={primaryHref}>{primaryLabel}</PrimaryButton>
				{secondaryLabel && secondaryHref && (
					<SecondaryButton href={secondaryHref}>
						{secondaryLabel}
					</SecondaryButton>
				)}
			</Actions>
		</Panel>
	)
}
