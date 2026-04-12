import { useLingui } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import { motion } from 'motion/react'
import styled from 'styled-components'

import { PriContextMenu } from '@engranatge/ui/pri'

import { agedPaperSurface } from '#/lib/workshop-mixins'
import { PriorityDot } from './priority-dot'
import { RelativeDate } from './relative-date'
import { StatusBadge } from './status-badge'
import { ScrewDot } from './workshop-decorations'

/**
 * Aged-paper file card for a single company. Micro-rotated to break the
 * grid rhythm, with a screw dot pinned to the top-left corner. Clicking
 * the card navigates to `/companies/$slug`; hover straightens the card
 * and lifts it slightly. The card shares a Motion `layoutId` with the
 * detail-page header so navigation animates as a shared element.
 *
 * Right-click opens a `PriContextMenu` with quick actions (log, add task,
 * copy slug, open in new tab) — handlers come from the `actions` prop so
 * the card stays agnostic of dialog/router wiring.
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

export type CompanyCardActions = {
	onLogInteraction?: () => void
	onAddTask?: () => void
	onMarkContacted?: () => void
}

export function CompanyCard({
	company,
	actions,
}: {
	company: CompanyCardData
	actions?: CompanyCardActions
}) {
	const { t } = useLingui()
	const subtitle = [company.location, company.industry]
		.filter((part): part is string => Boolean(part))
		.join(' · ')

	const copySlug = () => {
		void navigator.clipboard?.writeText(company.slug)
	}

	const openInNewTab = () => {
		window.open(`/companies/${company.slug}`, '_blank', 'noopener')
	}

	return (
		<PriContextMenu.Root>
			<PriContextMenu.Trigger
				render={
					<Card
						layoutId={`company-${company.slug}`}
						whileHover={{
							rotate: 0,
							y: -3,
							transition: { type: 'spring', stiffness: 400, damping: 28 },
						}}
					/>
				}
			>
				<CardLinkOverlay>
					<Link
						to='/companies/$slug'
						params={{ slug: company.slug }}
						aria-label={company.name}
					/>
				</CardLinkOverlay>
				<ScrewDot $position='top-left' aria-hidden />
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
						<LastContactLabel>{t`Last contact`}</LastContactLabel>
						<RelativeDate
							value={company.lastContactedAt ?? null}
							fallback='never'
						/>
					</LastContact>
				</Footer>
			</PriContextMenu.Trigger>
			<PriContextMenu.Portal>
				<PriContextMenu.Positioner>
					<PriContextMenu.Popup>
						{actions?.onLogInteraction && (
							<PriContextMenu.Item onClick={() => actions.onLogInteraction?.()}>
								{t`Log interaction`}
							</PriContextMenu.Item>
						)}
						{actions?.onAddTask && (
							<PriContextMenu.Item onClick={() => actions.onAddTask?.()}>
								{t`Add task`}
							</PriContextMenu.Item>
						)}
						{actions?.onMarkContacted && (
							<PriContextMenu.Item onClick={() => actions.onMarkContacted?.()}>
								{t`Mark contacted`}
							</PriContextMenu.Item>
						)}
						<PriContextMenu.Item onClick={openInNewTab}>
							{t`Open in new tab`}
						</PriContextMenu.Item>
						<PriContextMenu.Item onClick={copySlug}>
							{t`Copy slug`}
						</PriContextMenu.Item>
					</PriContextMenu.Popup>
				</PriContextMenu.Positioner>
			</PriContextMenu.Portal>
		</PriContextMenu.Root>
	)
}

const Card = styled(motion.article).withConfig({ displayName: 'CompanyCard' })`
	${agedPaperSurface}
	position: relative;
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
	padding: var(--space-md) var(--space-md) var(--space-sm);
	color: var(--color-on-surface);
	transform-origin: 50% 0;
	rotate: var(--card-rotate, 0deg);
	will-change: transform;

	&:focus-within {
		box-shadow:
			var(--shadow-paper-inset),
			var(--shadow-paper-card),
			var(--glow-active);
	}
`

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
		text-indent: -9999px;
		overflow: hidden;
	}

	a:focus-visible {
		outline: none;
	}
`

const Header = styled.div.withConfig({ displayName: 'CompanyCardHeader' })`
	position: relative;
	z-index: 1;
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: var(--space-sm);
	padding-left: var(--space-sm);
	pointer-events: none;
`

const Identity = styled.div.withConfig({ displayName: 'CompanyCardIdentity' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	min-width: 0;
`

const Name = styled.h3.withConfig({ displayName: 'CompanyCardName' })`
	margin: 0;
	font-family: var(--font-display);
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--color-on-surface);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const Subtitle = styled.p.withConfig({ displayName: 'CompanyCardSubtitle' })`
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	color: var(--color-on-surface-variant);
	font-style: italic;
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
	font-style: italic;
`

const LastContactLabel = styled.span.withConfig({
	displayName: 'CompanyCardLastContactLabel',
})`
	font-family: var(--font-display);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	font-style: normal;
	color: var(--color-on-surface);
	opacity: 0.7;
`
