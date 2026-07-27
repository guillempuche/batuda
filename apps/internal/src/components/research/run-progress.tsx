import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import type { ReactNode } from 'react'
import styled from 'styled-components'

import type { ResearchProgress } from '#/components/research/event-shapes'

/**
 * Live status for an in-flight run, driven by the event long-poll. Shows
 * which of the three phases the agent is in (gather → extract → write), the
 * step count, and how many sources it has pulled — so a paid, minutes-long
 * job doesn't look frozen.
 *
 * Read silently on purpose. Announcing this panel meant re-reading every figure
 * in it each time a poll returned — "gathering evidence, step 1 of 3, searching
 * and reasoning, 7 steps run, 4 sources", over and over, interrupting whatever
 * the reader was on. The page announces the phase alone, when it changes, from a
 * region that outlives this panel; see `phaseMessage`.
 */
export function RunProgress({
	progress,
	steps,
}: {
	readonly progress: ResearchProgress
	// Rounds the run itself reports, read off its row: the event stream would
	// undercount a run that was already working when the page loaded.
	readonly steps: number | null
}) {
	const { t } = useLingui()
	return (
		<Wrap data-testid='research-run-progress'>
			<Pulse aria-hidden />
			<Body>
				<Line>
					<Phase>{phaseLabel(progress.phase)}</Phase>
					{progress.phase !== null ? (
						<Step>{t`Step ${progress.phase} of 3`}</Step>
					) : null}
				</Line>
				<Meta>
					{progress.activeTool !== null ? (
						<MetaItem>{toolLabel(progress.activeTool)}</MetaItem>
					) : null}
					{steps !== null && steps > 0 ? (
						<MetaItem>
							<Plural value={steps} one='# step run' other='# steps run' />
						</MetaItem>
					) : null}
					{progress.sourceCount !== null ? (
						<MetaItem>
							<Plural
								value={progress.sourceCount}
								one='# source'
								other='# sources'
							/>
						</MetaItem>
					) : null}
				</Meta>
			</Body>
		</Wrap>
	)
}

function phaseLabel(phase: number | null): ReactNode {
	switch (phase) {
		case 1:
			return <Trans>Gathering evidence</Trans>
		case 2:
			return <Trans>Extracting findings</Trans>
		case 3:
			return <Trans>Writing the brief</Trans>
		default:
			return <Trans>Starting the run…</Trans>
	}
}

function toolLabel(tool: string): ReactNode {
	switch (tool) {
		case 'llm.generateText':
			return <Trans>Searching and reasoning</Trans>
		case 'llm.generateObject':
			return <Trans>Structuring the findings</Trans>
		default:
			return tool
	}
}

const Wrap = styled.div`
	display: flex;
	align-items: center;
	gap: var(--space-sm);
	padding: var(--space-sm) var(--space-md);
	border: 1px solid color-mix(in oklab, var(--color-primary) 30%, transparent);
	border-radius: var(--shape-2xs);
	background: color-mix(in oklab, var(--color-primary) 8%, transparent);
`

const Pulse = styled.span`
	flex-shrink: 0;
	width: 10px;
	height: 10px;
	border-radius: var(--shape-full);
	background: var(--color-primary);
	animation: research-progress-pulse 1.4s ease-in-out infinite;

	@keyframes research-progress-pulse {
		0%,
		100% {
			opacity: 0.35;
			transform: scale(0.85);
		}
		50% {
			opacity: 1;
			transform: scale(1.15);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		animation: none;
	}
`

const Body = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const Line = styled.div`
	display: inline-flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: var(--space-2xs);
`

const Phase = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-title-small-size);
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--color-on-surface);
`

const Step = styled.span`
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const Meta = styled.div`
	display: inline-flex;
	flex-wrap: wrap;
	gap: var(--space-sm);
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const MetaItem = styled.span``

/**
 * The phase as one short sentence, for the page's spoken summary. Kept beside
 * the visual labels so the two cannot drift apart.
 */
export function phaseMessage(phase: number | null): MessageDescriptor {
	switch (phase) {
		case 1:
			return msg`Gathering evidence.`
		case 2:
			return msg`Extracting findings.`
		case 3:
			return msg`Writing the brief.`
		default:
			return msg`Starting the run.`
	}
}
