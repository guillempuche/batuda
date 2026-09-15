import { Trans, useLingui } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { styled } from 'next-yak'
import { useMemo } from 'react'

import { COMPANY_SIZE_RANGES } from '@batuda/domain'
import { PriCollapsible } from '@batuda/ui/pri'

import {
	AttributeField,
	StoredAttributeRow,
} from '#/components/companies/attribute-field'
import {
	attributeRows,
	type StoredAttribute,
} from '#/components/companies/attribute-rows'
import type { AttributeDeclaration } from '#/components/instructions/attribute-shapes'
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
// counting as one apiece however many are on them. Attributes are left out: an
// organisation declares its own, so counting them here would make the same
// half-filled company read as more or less complete from one org to the next.
const TOTAL_ABOUT_FIELDS = 7

export type AboutCompany = {
	readonly industry: string | null
	readonly country: string | null
	readonly location: string | null
	readonly sizeRange: string | null
	readonly painPoints: string | null
	readonly tags: ReadonlyArray<string>
	readonly productsFit: ReadonlyArray<string>
	readonly attributes: ReadonlyMap<string, StoredAttribute>
}

/**
 * "About" — the editable fields a user fills in when setting up or qualifying
 * a company. Open by default, since whether a lead is qualified is the question
 * it answers and that is worth seeing beside the deal-driving signals (next
 * action, cadence, tasks, timeline) rather than behind a click. Three
 * subsections:
 *
 *   - Sales context (industry, country, location, size)
 *   - Discovery (pain points)
 *   - Tags & fit (tags, products fit)
 *   - Attributes (whatever this organisation declared)
 *
 * Priority and next action live in the header / NextActionCard, so they
 * don't appear here.
 */
export function AboutSection({
	company,
	declarations,
	declarationsFailed = false,
	onSave,
}: {
	readonly company: AboutCompany
	// Null while what this organisation declares is not known — still arriving,
	// or the fetch failed. Not the same as an organisation that declares nothing.
	readonly declarations: ReadonlyArray<AttributeDeclaration> | null
	// Whether that fetch failed, which is worth saying: waiting for an answer
	// that is not coming reads as a page still loading.
	readonly declarationsFailed?: boolean
	readonly onSave: (field: string, next: unknown) => Promise<void>
}) {
	const { t } = useLingui()
	const { labels, labelFor } = useCompanyIndustries()
	const attributes = useMemo(
		() =>
			declarations === null
				? null
				: attributeRows(declarations, company.attributes),
		[declarations, company.attributes],
	)
	const attributesFilled =
		attributes?.declared.filter(row => row.stored !== null).length ?? 0
	// How much of this is actually filled in, shown on the header so the count
	// still says whether there is anything behind it once the section is shut.
	const filled = [
		company.industry,
		company.country,
		company.location,
		company.sizeRange,
		company.painPoints,
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
					<Group data-testid='company-attributes'>
						<GroupTitle>
							<Trans>Attributes</Trans>
							{/* A count out of a number nobody knows yet would be a guess. */}
							{attributes !== null ? (
								<Count data-testid='company-attributes-count'>
									{attributesFilled}/{attributes.declared.length}
								</Count>
							) : null}
						</GroupTitle>
						{attributes === null ? (
							<>
								<Muted>
									{declarationsFailed ? (
										<Trans>
											The attributes this organisation declares could not be
											loaded, so the values are shown as stored.
										</Trans>
									) : (
										<Trans>
											Which attributes this organisation declares is not known
											yet, so the values are shown as stored.
										</Trans>
									)}
								</Muted>
								{/* Read-only on purpose: a key that looks undeclared from here
								    may simply not have arrived yet, and offering to clear it
								    would be offering to throw a value away over that. */}
								{[...company.attributes].map(([key, stored]) => (
									<StoredAttributeRow
										key={key}
										attributeKey={key}
										stored={stored}
										declaration={null}
										testId={`company-attribute-${key}`}
									/>
								))}
							</>
						) : (
							<>
								{attributes.declared.length === 0 &&
								attributes.other.length === 0 ? (
									<Muted data-testid='company-attributes-empty'>
										<Trans>
											No attributes declared yet. Declare them in the
											organisation's research templates.
										</Trans>{' '}
										<TemplatesLinkWrap>
											<Link to='/settings/organization/templates'>
												<Trans>Open templates</Trans>
											</Link>
										</TemplatesLinkWrap>
									</Muted>
								) : null}
								{attributes.declared.length > 0 ? (
									<Grid>
										{attributes.declared.map(row => (
											<AttributeField
												key={row.declaration.key}
												declaration={row.declaration}
												stored={row.stored}
												onSave={onSave}
											/>
										))}
									</Grid>
								) : null}
								{attributes.other.length > 0 ? (
									<Other data-testid='company-attributes-other'>
										<OtherTitle>
											<Trans>Other</Trans>
										</OtherTitle>
										<OtherNote>
											<Trans>
												Retired or no longer declared. They can be read or
												cleared; a run does not fill them any more.
											</Trans>
										</OtherNote>
										{attributes.other.map(row => (
											<StoredAttributeRow
												key={row.key}
												attributeKey={row.key}
												stored={row.stored}
												declaration={row.declaration}
												onClear={() =>
													onSave('attributes', { [row.key]: null })
												}
												testId={`company-attribute-other-${row.key}`}
											/>
										))}
									</Other>
								) : null}
							</>
						)}
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
	display: flex;
	align-items: center;
	gap: var(--space-2xs);
	margin: 0;
	font-size: var(--typescale-label-medium-size);
	letter-spacing: 0.08em;
	color: var(--color-on-surface-variant);
`

const Muted = styled.p`
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	line-height: var(--typescale-body-small-line);
	color: var(--color-on-surface-variant);
`

// The link inside is a bare router Link: styling it directly would drop the
// typing that makes a wrong destination a compile error.
const TemplatesLinkWrap = styled.span`
	& > a {
		font-size: var(--typescale-body-small-size);
		color: var(--color-primary);
	}
`

const Other = styled.section`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
`

const OtherTitle = styled.h5`
	${stenciledTitle}
	margin: 0;
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
`

const OtherNote = styled.p`
	margin: 0 0 var(--space-2xs);
	font-family: var(--font-body);
	font-size: var(--typescale-label-small-size);
	line-height: var(--typescale-label-small-line);
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
