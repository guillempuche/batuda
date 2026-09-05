import { Info } from 'lucide-react'
import { styled } from 'next-yak'
import type { ReactNode } from 'react'

import { PriTooltip } from '@batuda/ui/pri'

import { brushedMetalPlate, stenciledTitle } from '#/lib/workshop-mixins'

/**
 * Stenciled display-font section title with a ruler under-rule. Optional
 * count badge renders as a mini stamped-metal tag; the action slot stays
 * right-aligned for "show all" links or toolbar buttons.
 *
 * `help` is for a section whose membership follows a rule — what puts a row on
 * this list and what keeps it off. Those rules are decisions somebody made once
 * and nobody can see, and a heading is where a reader looks for them.
 */
export function SectionHeader({
	title,
	count,
	help,
	action,
}: {
	title: string
	count?: number
	help?: string
	action?: ReactNode
}) {
	return (
		<Wrapper>
			<TitleRow>
				<Heading>{title}</Heading>
				{typeof count === 'number' && <Count>{count}</Count>}
				{help && (
					<PriTooltip.Provider delay={300}>
						<PriTooltip.Root>
							<PriTooltip.Trigger
								render={
									<HelpButton type='button' aria-label={help}>
										<Info size={13} aria-hidden />
									</HelpButton>
								}
							/>
							<PriTooltip.Portal>
								<PriTooltip.Positioner side='top' sideOffset={6}>
									<PriTooltip.Popup>{help}</PriTooltip.Popup>
								</PriTooltip.Positioner>
							</PriTooltip.Portal>
						</PriTooltip.Root>
					</PriTooltip.Provider>
				)}
			</TitleRow>
			{action && <Actions>{action}</Actions>}
		</Wrapper>
	)
}

const HelpButton = styled.button`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	padding: 0;
	background: none;
	border: none;
	cursor: help;
	color: var(--color-on-surface-variant);

	&:hover {
		color: var(--color-on-surface);
	}

	&:focus-visible {
		outline: none;
		border-radius: var(--shape-full);
		box-shadow: var(--glow-active);
	}
`

const Wrapper = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-sm);
	padding-bottom: var(--space-sm);
	background-image: repeating-linear-gradient(
		90deg,
		var(--color-ledger-line-strong) 0 4px,
		transparent 4px 10px
	);
	background-repeat: no-repeat;
	background-position: left bottom;
	background-size: 100% 1px;
`

const TitleRow = styled.div`
	display: inline-flex;
	align-items: center;
	gap: var(--space-sm);
	min-width: 0;
`

const Heading = styled.h3`
	${stenciledTitle}
	margin: 0;
	font-size: var(--typescale-title-medium-size);
	line-height: var(--typescale-title-medium-line);
`

const Count = styled.span`
	${brushedMetalPlate}
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 1.75rem;
	padding: 2px var(--space-2xs);
	border-radius: var(--shape-2xs);
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	font-weight: var(--font-weight-bold);
	letter-spacing: 0.04em;
	color: var(--color-on-surface);
	text-shadow: var(--text-shadow-emboss);
`

const Actions = styled.div`
	display: inline-flex;
	align-items: center;
	gap: var(--space-xs);
`
