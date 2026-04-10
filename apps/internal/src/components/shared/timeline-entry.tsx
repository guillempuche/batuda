import { useLingui } from '@lingui/react'
import { useLingui as useLinguiMacro } from '@lingui/react/macro'
import { useState } from 'react'
import styled from 'styled-components'

import { ChannelIcon, channelLabelFor } from './channel-icon'
import { RelativeDate } from './relative-date'

/**
 * Single row in the company-detail timeline. Left: a circular
 * surface-container chip with the channel icon. Right: title +
 * summary + relative date. Long summaries collapse by default and
 * expand on click — no route change, no modal.
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
			<IconChip aria-hidden>
				<ChannelIcon channel={entry.channel} size={18} />
			</IconChip>
			<Body>
				<Title>
					<span>{title}</span>
					<RelativeDate value={entry.date} />
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
	display: grid;
	grid-template-columns: auto 1fr;
	gap: var(--space-md);
	width: 100%;
	text-align: left;
	background: transparent;
	border: none;
	padding: var(--space-sm) 0;
	cursor: pointer;

	&:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
		border-radius: var(--shape-sm);
	}
`

const IconChip = styled.span.withConfig({ displayName: 'TimelineEntryIcon' })`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2.25rem;
	height: 2.25rem;
	flex-shrink: 0;
	background: var(--color-surface-container);
	color: var(--color-on-surface-variant);
	border-radius: var(--shape-full);
`

const Body = styled.div.withConfig({ displayName: 'TimelineEntryBody' })`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	min-width: 0;
`

const Title = styled.div.withConfig({ displayName: 'TimelineEntryTitle' })`
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--space-sm);
	font-family: var(--font-body);
	font-size: var(--typescale-label-large-size);
	line-height: var(--typescale-label-large-line);
	font-weight: var(--font-weight-medium);
	color: var(--color-on-surface);

	> span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
`

const Summary = styled.p.withConfig({ displayName: 'TimelineEntrySummary' })`
	font-family: var(--font-body);
	font-size: var(--typescale-body-medium-size);
	line-height: var(--typescale-body-medium-line);
	letter-spacing: var(--typescale-body-medium-tracking);
	color: var(--color-on-surface);
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
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--typescale-label-small-weight);
	letter-spacing: var(--typescale-label-small-tracking);
	color: var(--color-primary);
`
