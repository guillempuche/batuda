import { Trans, useLingui } from '@lingui/react/macro'
import { ChevronRight } from 'lucide-react'
import styled from 'styled-components'

import { COMPANY_SIZE_RANGES } from '@batuda/domain'
import { PriCollapsible } from '@batuda/ui/pri'

import {
	EditableChips,
	EditableCombobox,
	EditableField,
	EditableSelect,
} from '#/components/shared/editable-field'
import { useCompanyIndustries } from '#/hooks/use-company-industries'
import { agedPaperSurface, stenciledTitle } from '#/lib/workshop-mixins'

// The bands are numbers, not words, so they read the same in every language and
// need no translating. An empty first entry is what lets somebody take a size
// back off a company.
const SIZE_OPTIONS = [
	{ value: '', label: '—' },
	...COMPANY_SIZE_RANGES.map(band => ({ value: band, label: band })),
]

export type AboutCompany = {
	readonly industry: string | null
	readonly country: string | null
	readonly location: string | null
	readonly sizeRange: string | null
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
 *   - Sales context (industry, country, location, size)
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
	const { labels, labelFor } = useCompanyIndustries()
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
							{/* Typed, not picked from a list: the first person to sell to
							    boat builders has to be able to write it down. What the
							    others already wrote is offered while typing, so the same
							    trade is spelled the same way twice. */}
							<EditableCombobox
								label={t`Industry`}
								value={labelFor(company.industry)}
								suggestions={labels}
								onSave={next => onSave('industry', next)}
								testId='company-industry'
							/>
							<EditableField
								label={t`Country`}
								value={company.country}
								onSave={next => onSave('country', next)}
							/>
							<EditableField
								label={t`Location`}
								value={company.location}
								onSave={next => onSave('location', next)}
							/>
							{/* A band rather than a typed number: the bands are a closed set,
							    so a typed "20 people" would be refused on the way in with
							    nothing on screen to say which words are allowed. A row still
							    holding an older band shows it, because the dropdown falls
							    back to whatever value it was given. */}
							<EditableSelect
								label={t`Size`}
								value={company.sizeRange}
								options={SIZE_OPTIONS}
								onSave={next => onSave('sizeRange', next)}
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
