import { useLingui } from '@lingui/react'
import { useLingui as useLinguiMacro } from '@lingui/react/macro'
import { useState } from 'react'
import styled from 'styled-components'

import { agedPaperRow, brushedMetalBezel } from '#/lib/workshop-mixins'
import { ChannelIcon, channelLabelFor } from './channel-icon'
import { RelativeDate } from './relative-date'

/**
 * Journal entry on aged paper. Left column = metal bezel with the channel
 * icon (brushed texture + ring); right column = stenciled title + italic
 * summary + optional outcome/next-action meta lines. Long summaries
 * collapse to a preview and expand on click — no modal, no route change.
 */
export type TimelineEntryData = {
	id: string
	channel: string
	subject?: string | null
	summary?: string | null
	outcome?: string | null
	nextAction?: string | null
	date: Date | string
}

const COLLAPSE_THRESHOLD = 140

export function TimelineEntry({ entry }: { entry: TimelineEntryData }) {
	const [expanded, setExpanded] = useState(false)
	const { i18n } = useLingui()
	const { t } = useLinguiMacro()
	const channelLabel = i18n._(channelLabelFor(entry.channel))
	const title = entry.subject?.trim() || channelLabel
	const summary = entry.summary ?? ''
	const isLong = summary.length > COLLAPSE_THRESHOLD
	const displaySummary =
		!expanded && isLong ? `${summary.slice(0, COLLAPSE_THRESHOLD)}…` : summary

	return (
		<Row type='button' onClick={() => isLong && setExpanded(e => !e)}>
			<IconBezel aria-hidden>
				<ChannelIcon channel={entry.channel} size={18} />
			</IconBezel>
			<Body>
				<Title>
					<span>{title}</span>
					<DateSpan>
						<RelativeDate value={entry.date} />
					</DateSpan>
				</Title>
				{summary && <Summary>{displaySummary}</Summary>}
				{entry.outcome && <Meta>{t`Outcome: ${entry.outcome}`}</Meta>}
				{entry.nextAction && <Meta>{t`Next: ${entry.nextAction}`}</Meta>}
				{isLong && (
					<ToggleHint>{expanded ? t`Show less` : t`Show more`}</ToggleHint>
				)}
			</Body>
		</Row>
	)
}

const Row = styled.button.withConfig({ displayName: 'TimelineEntry' })`
	${agedPaperRow}
	display: grid;
	grid-template-columns: auto 1fr;
	gap: var(--space-md);
	width: 100%;
	text-align: left;
	border: none;
	border-bottom: 1px solid var(--color-ledger-line);
	padding: var(--space-md) var(--space-md);
	cursor: pointer;
	color: var(--color-on-surface);

	&:hover {
		background-color: var(--color-paper-aged-hover);
	}

	&:focus-visible {
		outline: none;
		box-shadow: var(--glow-active);
	}
`

const IconBezel = styled.span.withConfig({ displayName: 'TimelineEntryIcon' })`
	${brushedMetalBezel}
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2.5rem;
	height: 2.5rem;
	flex-shrink: 0;
	border-radius: 50%;
	color: var(--color-on-surface);
`

const Body = styled.div.withConfig({ displayName: 'TimelineEntryBody' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-2xs);
	min-width: 0;
`

const Title = styled.div.withConfig({ displayName: 'TimelineEntryTitle' })`
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--space-sm);
	font-family: var(--font-display);
	font-size: var(--typescale-title-small-size);
	line-height: var(--typescale-title-small-line);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--color-on-surface);

	> span:first-child {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
`

const DateSpan = styled.span.withConfig({ displayName: 'TimelineEntryDate' })`
	flex-shrink: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-regular);
	letter-spacing: 0;
	text-transform: none;
	color: var(--color-on-surface-variant);
	font-style: italic;
`

const Summary = styled.p.withConfig({ displayName: 'TimelineEntrySummary' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	color: var(--color-on-surface-variant);
	font-style: italic;
	margin: 0;
`

const Meta = styled.p.withConfig({ displayName: 'TimelineEntryMeta' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	color: var(--color-on-surface-variant);
	margin: 0;
`

const ToggleHint = styled.span.withConfig({
	displayName: 'TimelineEntryToggleHint',
})`
	margin-top: var(--space-3xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-primary);
`
