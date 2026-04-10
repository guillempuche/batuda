import { Trans } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import styled from 'styled-components'

import { PriorityDot } from './priority-dot'
import { RelativeDate } from './relative-date'
import { StatusBadge } from './status-badge'

/**
 * Compact summary card for a single company. Clicking anywhere on the
 * card navigates to `/companies/$slug`; hover/tap reveals two inline
 * actions ("+ Interacció", "+ Tasca") that open dialogs without losing
 * the user's current scroll position.
 *
 * The inline action buttons are rendered through the `actions` render-
 * prop so the list container controls which actions appear — that keeps
 * this card agnostic of dialog wiring.
 */
export type CompanyCardData = {
	slug: string
	name: string
	status: string
	industry?: string | null
	location?: string | null
	region?: string | null
	priority?: number | null
	lastContactedAt?: Date | string | null
}

export function CompanyCard({
	company,
	actions,
}: {
	company: CompanyCardData
	actions?: ReactNode
}) {
	const subtitle = [company.location, company.industry]
		.filter((part): part is string => Boolean(part))
		.join(' · ')

	return (
		<Card>
			<CardLinkOverlay>
				<Link
					to='/companies/$slug'
					params={{ slug: company.slug }}
					aria-label={company.name}
				/>
			</CardLinkOverlay>
			<Header>
				<Identity>
					<Name>{company.name}</Name>
					{subtitle && <Subtitle>{subtitle}</Subtitle>}
				</Identity>
				<PriorityDot priority={company.priority ?? null} />
			</Header>
			<Footer>
				<StatusBadge status={company.status} />
				<LastContact>
					<span>
						<Trans>Last contact:</Trans>
					</span>
					<RelativeDate
						value={company.lastContactedAt ?? null}
						fallback='never'
					/>
				</LastContact>
			</Footer>
			{actions && <Actions>{actions}</Actions>}
		</Card>
	)
}

/**
 * Pre-built inline action button used by lists that want to render
 * "+ Interacció" / "+ Tasca" pills on the card. Wrap in a click handler
 * that calls `event.stopPropagation()` + `event.preventDefault()` so
 * the card link doesn't intercept the action.
 */
export function CompanyCardAction({
	label,
	onClick,
}: {
	label: string
	onClick: () => void
}) {
	return (
		<ActionButton
			type='button'
			onClick={event => {
				event.preventDefault()
				event.stopPropagation()
				onClick()
			}}
		>
			<Plus size={14} />
			<span>{label}</span>
		</ActionButton>
	)
}

const Card = styled.article.withConfig({ displayName: 'CompanyCard' })`
	position: relative;
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	background: var(--color-surface-container-low);
	border: 1px solid var(--color-outline-variant);
	border-radius: var(--shape-md);
	padding: var(--space-md);
	transition:
		background 120ms ease,
		border-color 120ms ease,
		transform 120ms ease;

	&:hover,
	&:focus-within {
		background: var(--color-surface-container);
		border-color: var(--color-outline);
	}
`

/* Full-card link — absolutely positioned so it covers the card without
 * stealing text-selection or preventing the action buttons from being
 * clickable (they use stopPropagation to override the overlay).
 *
 * We style a wrapper div and target the nested <a> via descendant
 * selector because `styled(Link)` loses TanStack Router's typed `params`
 * inference (the generic `to` → params mapping falls back to AnyRouter).
 */
const CardLinkOverlay = styled.div.withConfig({
	displayName: 'CompanyCardLinkOverlay',
})`
	position: absolute;
	inset: 0;
	z-index: 0;

	a {
		display: block;
		position: absolute;
		inset: 0;
		border-radius: var(--shape-md);
		text-indent: -9999px;
		overflow: hidden;
	}

	a:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
`

const Header = styled.div.withConfig({ displayName: 'CompanyCardHeader' })`
	position: relative;
	z-index: 1;
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: var(--space-sm);
	pointer-events: none;
`

const Identity = styled.div.withConfig({ displayName: 'CompanyCardIdentity' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	min-width: 0;
`

const Name = styled.h3.withConfig({ displayName: 'CompanyCardName' })`
	font-family: var(--font-display);
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
	font-weight: var(--typescale-title-medium-weight);
	letter-spacing: var(--typescale-title-medium-tracking);
	color: var(--color-on-surface);
	margin: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const Subtitle = styled.p.withConfig({ displayName: 'CompanyCardSubtitle' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	letter-spacing: var(--typescale-body-small-tracking);
	color: var(--color-on-surface-variant);
	margin: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const Footer = styled.div.withConfig({ displayName: 'CompanyCardFooter' })`
	position: relative;
	z-index: 1;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	pointer-events: none;
`

const LastContact = styled.span.withConfig({
	displayName: 'CompanyCardLastContact',
})`
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);

	span {
		opacity: 0.7;
	}
`

const Actions = styled.div.withConfig({ displayName: 'CompanyCardActions' })`
	position: relative;
	z-index: 2;
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-2xs);
	pointer-events: auto;
`

const ActionButton = styled.button.withConfig({
	displayName: 'CompanyCardActionButton',
})`
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
	padding: var(--space-3xs) var(--space-xs);
	background: var(--color-surface);
	color: var(--color-on-surface-variant);
	border: 1px solid var(--color-outline-variant);
	border-radius: var(--shape-full);
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--typescale-label-small-weight);
	letter-spacing: var(--typescale-label-small-tracking);
	cursor: pointer;
	transition:
		background 120ms ease,
		color 120ms ease,
		border-color 120ms ease;

	&:hover {
		background: var(--color-primary);
		color: var(--color-on-primary);
		border-color: var(--color-primary);
	}

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
`
