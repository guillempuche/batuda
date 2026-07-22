import { useLingui } from '@lingui/react/macro'
import { Columns3, LayoutGrid } from 'lucide-react'
import styled from 'styled-components'

import { KpiCounter } from '#/components/shared/kpi-counter'
import { rulerUnderRule, stenciledTitle } from '#/lib/workshop-mixins'

/**
 * Shared header for the two companies views (card list and pipeline board).
 * Both routes render this so the title, the ruler underline, and the
 * List/Board switch stay in the same place and style as the user flips
 * between views — only the body below changes. The optional KPI plate is
 * shown by the list (which knows its total); the board leaves it out.
 */
export function CompaniesHeader({
	title,
	subtitle,
	view,
	listHref,
	boardHref,
	kpi,
}: {
	readonly title: string
	readonly subtitle?: string
	readonly view: 'list' | 'board'
	readonly listHref: string
	readonly boardHref: string
	readonly kpi?: { readonly value: number; readonly label: string }
}) {
	const { t } = useLingui()
	return (
		<Intro>
			<TitleRow>
				<TitleBlock>
					<Title>{title}</Title>
					{subtitle && <Subtitle>{subtitle}</Subtitle>}
				</TitleBlock>
				<ViewToggle role='group' aria-label={t`Switch view`}>
					<ViewLink
						$active={view === 'list'}
						href={listHref}
						data-testid='companies-view-list'
						{...(view === 'list' ? { 'aria-current': 'page' } : {})}
					>
						<LayoutGrid size={14} aria-hidden />
						<span>{t`List`}</span>
					</ViewLink>
					<ViewLink
						$active={view === 'board'}
						href={boardHref}
						data-testid='companies-view-board'
						{...(view === 'board' ? { 'aria-current': 'page' } : {})}
					>
						<Columns3 size={14} aria-hidden />
						<span>{t`Board`}</span>
					</ViewLink>
				</ViewToggle>
			</TitleRow>
			{kpi && <KpiCounter value={kpi.value} label={kpi.label} />}
		</Intro>
	)
}

const Intro = styled.div.withConfig({ displayName: 'CompaniesHeaderIntro' })`
	display: grid;
	gap: var(--space-md);
	align-items: end;

	@media (min-width: 768px) {
		grid-template-columns: 1fr auto;
	}
`

const TitleRow = styled.div.withConfig({
	displayName: 'CompaniesHeaderTitleRow',
})`
	${rulerUnderRule}
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	padding-bottom: var(--space-sm);
`

const TitleBlock = styled.div.withConfig({
	displayName: 'CompaniesHeaderTitleBlock',
})`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	min-width: 0;
`

const Title = styled.h2.withConfig({ displayName: 'CompaniesHeaderTitle' })`
	${stenciledTitle}
	margin: 0;
	font-size: var(--typescale-headline-large-size);
	line-height: var(--typescale-headline-large-line);
`

const Subtitle = styled.p.withConfig({
	displayName: 'CompaniesHeaderSubtitle',
})`
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-large-size);
	line-height: var(--typescale-body-large-line);
	letter-spacing: var(--typescale-body-large-tracking);
	color: var(--color-on-surface-variant);
	font-style: italic;
`

const ViewToggle = styled.div.withConfig({
	displayName: 'CompaniesHeaderViewToggle',
})`
	display: inline-flex;
	align-items: stretch;
	border: 2px solid var(--color-outline);
	border-radius: var(--shape-2xs);
	overflow: hidden;
	flex-shrink: 0;
`

const ViewLink = styled.a.withConfig({
	displayName: 'CompaniesHeaderViewLink',
	shouldForwardProp: prop => prop !== '$active',
})<{ $active?: boolean }>`
	display: inline-flex;
	align-items: center;
	gap: var(--space-2xs);
	padding: var(--space-2xs) var(--space-sm);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	text-decoration: none;
	background: ${p => (p.$active ? 'var(--color-primary)' : 'transparent')};
	color: ${p =>
		p.$active ? 'var(--color-on-primary)' : 'var(--color-on-surface)'};

	& + & {
		border-left: 2px solid var(--color-outline);
	}

	&:hover {
		color: ${p =>
			p.$active ? 'var(--color-on-primary)' : 'var(--color-primary)'};
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`
