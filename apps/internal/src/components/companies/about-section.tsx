import { Trans, useLingui } from '@lingui/react/macro'
import { ChevronRight } from 'lucide-react'
import styled from 'styled-components'

import { PriCollapsible } from '@batuda/ui/pri'

import {
	EditableChips,
	EditableField,
} from '#/components/shared/editable-field'
import { agedPaperSurface, stenciledTitle } from '#/lib/workshop-mixins'

export type AboutCompany = {
	readonly industry: string | null
	readonly region: string | null
	readonly location: string | null
	readonly sizeRange: string | null
	readonly source: string | null
	readonly painPoints: string | null
	readonly currentTools: string | null
	readonly tags: ReadonlyArray<string>
	readonly productsFit: ReadonlyArray<string>
}

/**
 * "About" — the long tail of editable fields the user only touches when
 * setting up or qualifying a company. Collapsed by default so the
 * Overview leads with deal-driving signals (next action, cadence,
 * tasks, timeline). Three subsections:
 *
 *   - Sales context (industry, region, location, size, source)
 *   - Discovery (pain points, current tools)
 *   - Tags & fit (tags, products fit)
 *
 * Priority and next action live in the header / NextActionCard, so they
 * don't appear here.
 */
export function AboutSection({
	company,
	onSave,
}: {
	readonly company: AboutCompany
	readonly onSave: (field: string, next: unknown) => Promise<void>
}) {
	const { t } = useLingui()
	return (
		<PriCollapsible.Root>
			<TriggerWrap>
				<Trigger data-testid='company-about-trigger'>
					<ChevronRight size={14} aria-hidden />
					<Trans>About</Trans>
				</Trigger>
			</TriggerWrap>
			<PriCollapsible.Panel>
				<Body data-testid='company-about-panel'>
					<Group>
						<GroupTitle>
							<Trans>Sales context</Trans>
						</GroupTitle>
						<Grid>
							<EditableField
								label={t`Industry`}
								value={company.industry}
								onSave={next => onSave('industry', next)}
							/>
							<EditableField
								label={t`Region`}
								value={company.region}
								onSave={next => onSave('region', next)}
							/>
							<EditableField
								label={t`Location`}
								value={company.location}
								onSave={next => onSave('location', next)}
							/>
							<EditableField
								label={t`Size`}
								value={company.sizeRange}
								onSave={next => onSave('sizeRange', next)}
							/>
							<EditableField
								label={t`Source`}
								value={company.source}
								onSave={next => onSave('source', next)}
							/>
						</Grid>
					</Group>
					<Group>
						<GroupTitle>
							<Trans>Discovery</Trans>
						</GroupTitle>
						<Grid>
							<EditableField
								label={t`Pain points`}
								value={company.painPoints}
								onSave={next => onSave('painPoints', next)}
								multiline
							/>
							<EditableField
								label={t`Current tools`}
								value={company.currentTools}
								onSave={next => onSave('currentTools', next)}
							/>
						</Grid>
					</Group>
					<Group>
						<GroupTitle>
							<Trans>Tags &amp; fit</Trans>
						</GroupTitle>
						<Grid>
							<EditableChips
								label={t`Tags`}
								values={company.tags}
								onSave={next => onSave('tags', next)}
								emptyHint={t`No tags yet`}
							/>
							<EditableChips
								label={t`Products fit`}
								values={company.productsFit}
								onSave={next => onSave('productsFit', next)}
								emptyHint={t`No products linked yet`}
							/>
						</Grid>
					</Group>
				</Body>
			</PriCollapsible.Panel>
		</PriCollapsible.Root>
	)
}

const TriggerWrap = styled.div`
	display: flex;
	justify-content: flex-start;
`

const Trigger = styled(PriCollapsible.Trigger)`
	& > svg {
		transition: transform 200ms ease;
	}

	&[data-open] > svg,
	&[aria-expanded='true'] > svg {
		transform: rotate(90deg);
	}
`

const Body = styled.div`
	${agedPaperSurface}
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
	padding: var(--space-md);
	margin-top: var(--space-sm);
`

const Group = styled.section`
	display: flex;
	flex-direction: column;
	gap: var(--space-sm);
`

const GroupTitle = styled.h4`
	${stenciledTitle}
	margin: 0;
	font-size: var(--typescale-label-medium-size);
	letter-spacing: 0.08em;
	color: var(--color-on-surface-variant);
`

const Grid = styled.div`
	display: grid;
	grid-template-columns: 1fr;
	gap: var(--space-sm);

	@container (min-width: 32rem) {
		grid-template-columns: 1fr 1fr;
	}
`
