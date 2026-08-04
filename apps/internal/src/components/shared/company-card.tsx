import { useLingui } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import { MoreHorizontal } from 'lucide-react'
import { motion } from 'motion/react'
import type { ComponentType, ReactNode } from 'react'
import styled from 'styled-components'

import { PriAvatar, PriContextMenu, PriMenu } from '@batuda/ui/pri'

import { useCompanyIndustries } from '#/hooks/use-company-industries'
import { aiChatUrl } from '#/lib/ai-handoff'
import { initialFor, useOrgMembers } from '#/lib/org-members'
import { agedPaperSurface } from '#/lib/workshop-mixins'
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
 * The corner shows who the lead belongs to. What a card carries is what the
 * filters above it sort by, so the two agree — priority moved to the filter bar
 * and the company's own header, where it can be read and changed rather than
 * guessed from a ten-pixel dot.
 *
 * The quick actions are on a visible button as well as the right-click menu:
 * right-click is no help on a phone and invisible everywhere else.
 */
export type CompanyCardData = {
	slug: string
	name: string
	status: string
	industry?: string | null
	location?: string | null
	country?: string | null
	priority?: number | null
	ownerId?: string | null
	lastContactedAt?: Date | string | null
}

export type CompanyCardActions = {
	onLogInteraction?: () => void
	onAddTask?: () => void
	onMarkContacted?: () => void
	onAssign?: () => void
}

export function CompanyCard({
	company,
	actions,
}: {
	company: CompanyCardData
	actions?: CompanyCardActions
}) {
	const { t } = useLingui()
	// The row carries the trade's web-address form; the name is what to read.
	const { labelFor } = useCompanyIndustries()
	const { byUserId } = useOrgMembers()
	const subtitle = [company.location, labelFor(company.industry)]
		.filter((part): part is string => Boolean(part))
		.join(' · ')

	const owner = byUserId(company.ownerId)

	const copySlug = () => {
		void navigator.clipboard?.writeText(company.slug)
	}

	const openInNewTab = () => {
		window.open(`/companies/${company.slug}`, '_blank', 'noopener')
	}

	// Written here rather than in the link builder so it is translated, and
	// phrased as something worth asking: whoever follows it has this
	// organisation's CRM connected, so the assistant can go and look.
	const prompt = t`Look up the company "${company.name}" in Batuda and tell me where the deal stands and what I should do next.`

	const openAssistant = (url: string) => {
		window.open(url, '_blank', 'noopener,noreferrer')
	}

	// The same actions hang off the visible button and off right-click, but the
	// two menus bring their own Item and Separator, so the list is built from
	// whichever pair it is going into rather than shared as one element.
	const items = (
		Item: ComponentType<{
			readonly onClick?: () => void
			readonly children?: ReactNode
		}>,
		Separator: ComponentType,
	) => (
		<>
			{actions?.onAssign && (
				<Item onClick={() => actions.onAssign?.()}>{t`Assign`}</Item>
			)}
			{actions?.onLogInteraction && (
				<Item onClick={() => actions.onLogInteraction?.()}>
					{t`Log interaction`}
				</Item>
			)}
			{actions?.onAddTask && (
				<Item onClick={() => actions.onAddTask?.()}>{t`Add task`}</Item>
			)}
			{actions?.onMarkContacted && (
				<Item onClick={() => actions.onMarkContacted?.()}>
					{t`Mark contacted`}
				</Item>
			)}
			<Separator />
			<Item onClick={() => openAssistant(aiChatUrl('claude', prompt))}>
				{t`Ask Claude about this company`}
			</Item>
			<Item onClick={() => openAssistant(aiChatUrl('chatgpt', prompt))}>
				{t`Ask ChatGPT about this company`}
			</Item>
			<Separator />
			<Item onClick={openInNewTab}>{t`Open in new tab`}</Item>
			<Item onClick={copySlug}>{t`Copy slug`}</Item>
		</>
	)

	return (
		<PriContextMenu.Root>
			<PriContextMenu.Trigger
				render={
					<Card
						layoutId={`company-${company.slug}`}
						data-testid={`company-card-${company.slug}`}
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
					<Corner>
						{owner ? (
							<PriAvatar.Root
								$size='1.5rem'
								title={t`Owned by ${owner.name}`}
								data-testid={`company-card-owner-${company.slug}`}
							>
								<PriAvatar.Fallback>
									{initialFor(owner.name)}
								</PriAvatar.Fallback>
							</PriAvatar.Root>
						) : (
							<Unassigned
								title={t`Nobody owns this lead`}
								data-testid={`company-card-unowned-${company.slug}`}
								aria-hidden
							/>
						)}
						<PriMenu.Root>
							<ActionsTrigger
								aria-label={t`Actions for ${company.name}`}
								data-testid={`company-card-actions-${company.slug}`}
							>
								<MoreHorizontal size={16} aria-hidden />
							</ActionsTrigger>
							<PriMenu.Portal>
								<PriMenu.Positioner sideOffset={4} align='end'>
									<PriMenu.Popup>
										{items(PriMenu.Item, PriMenu.Separator)}
									</PriMenu.Popup>
								</PriMenu.Positioner>
							</PriMenu.Portal>
						</PriMenu.Root>
					</Corner>
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
						{items(PriContextMenu.Item, PriContextMenu.Separator)}
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

const Corner = styled.div.withConfig({ displayName: 'CompanyCardCorner' })`
	display: flex;
	align-items: center;
	gap: var(--space-3xs);
	flex-shrink: 0;
	/* The card itself is a link, so only the controls take clicks back. */
	pointer-events: auto;
`

const Unassigned = styled.span.withConfig({
	displayName: 'CompanyCardUnassigned',
})`
	width: 1.5rem;
	height: 1.5rem;
	border-radius: 50%;
	border: 1px dashed var(--color-outline);
	opacity: 0.6;
`

const ActionsTrigger = styled(PriMenu.Trigger).withConfig({
	displayName: 'CompanyCardActionsTrigger',
})`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-inline-size: 2.75rem;
	min-block-size: 2.75rem;
	margin: calc(var(--space-2xs) * -1);
	padding: 0;
	border: none;
	background: transparent;
	color: var(--color-on-surface-variant);
	cursor: pointer;

	&:hover {
		color: var(--color-primary);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
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
