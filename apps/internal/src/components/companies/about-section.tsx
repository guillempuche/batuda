import { Trans, useLingui } from '@lingui/react/macro'
import { ChevronRight } from 'lucide-react'
import { styled } from 'next-yak'

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

// What the trigger's count is out of — the fields below, with tags and products
// counting as one apiece however many are on them.
const TOTAL_ABOUT_FIELDS = 8

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
 * "About" — the editable fields a user fills in when setting up or qualifying
 * a company. Open by default, since whether a lead is qualified is the question
 * it answers and that is worth seeing beside the deal-driving signals (next
 * action, cadence, tasks, timeline) rather than behind a click. Three
 * subsections:
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
	// How much of this is actually filled in, shown on the header so the count
	// still says whether there is anything behind it once the section is shut.
	const filled = [
		company.industry,
		company.country,
		company.location,
		company.sizeRange,
		company.painPoints,
		company.currentTools,
		company.tags.length > 0 ? 'tags' : null,
		company.productsFit.length > 0 ? 'fit' : null,
	].filter(v => v !== null && v !== '').length

	return (
		<PriCollapsible.Root defaultOpen>
			<TriggerWrap>
				<PriCollapsible.Trigger data-testid='company-about-trigger'>
					<ChevronRight size={14} aria-hidden />
					<Trans>About</Trans>
					<Count data-testid='company-about-count'>
						{filled}/{TOTAL_ABOUT_FIELDS}
					</Count>
				</PriCollapsible.Trigger>
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
								splitOnComma
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

const Body = styled.div`
	${agedPaperSurface}
	display: flex;
	flex-direction: column;
	gap: var(--space-md);
	padding: var(--space-md);
	margin-top: var(--space-sm);

	/* The fields below ask about their own width. Without this they were asking
	 * the whole tab panel instead — measuring over a thousand pixels while
	 * sitting in a column of four hundred, and so laying out two columns that
	 * squeezed a town name onto two lines. */
	container-type: inline-size;
`

const Count = styled.span`
	padding: 0 var(--space-2xs);
	border: 1px solid currentColor;
	border-radius: var(--shape-2xs);
	font-size: var(--typescale-label-small-size);
	font-variant-numeric: tabular-nums;
	opacity: 0.8;
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
