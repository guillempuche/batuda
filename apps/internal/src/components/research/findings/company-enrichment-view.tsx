import { Trans } from '@lingui/react/macro'
import type { ReactNode } from 'react'

import {
	type Citation,
	CitationList,
	type CommonFindings,
	CommonSections,
	FieldKey,
	FieldRow,
	FieldsTable,
	FieldValue,
	List,
	ListItem,
	Pill,
	Reason,
	RowHead,
	Section,
	Sections,
	SectionTitle,
	Tag,
	TagList,
} from './shared'

/**
 * Renders a `company_enrichment_v1` research finding. Surfaces the
 * enrichment object (industry, sizeRange, painPoints, etc.) as a
 * typed field table, then competitor + contact arrays as their own
 * sections, finally the cross-cutting common sections.
 *
 * The schema stores keys as snake_case in the JSONB column, but the
 * Pg client recursively camelizes JSONB on read, so the wire shape is
 * camelCase end-to-end (see ./shared.tsx).
 */

// Wire shape of a per-field Sourced value (camelCased from the stored
// { value, source_id, quote?, confidence? }): the value plus the source backing it.
type SourcedString = {
	readonly value: string
	readonly sourceId: string
	readonly quote?: string
	readonly confidence?: number
}

const sourcedToCitations = (
	field: SourcedString | null | undefined,
): ReadonlyArray<Citation> =>
	field != null
		? [
				{
					sourceId: field.sourceId,
					...(field.quote !== undefined ? { quote: field.quote } : {}),
					...(field.confidence !== undefined
						? { confidence: field.confidence }
						: {}),
				},
			]
		: []

type EnrichmentBlock = {
	readonly industry?: SourcedString
	readonly sizeRange?: SourcedString
	readonly painPoints?: SourcedString
	readonly currentTools?: SourcedString
	readonly tags?: ReadonlyArray<string>
	readonly location?: SourcedString
	readonly country?: SourcedString
}

// An evidence-backed row (a fit check or a disqualifier): the source URL and,
// where present, the quote that decides it, camelCased from the stored shape.
type EvidenceRef = {
	readonly evidenceQuote?: string
	readonly sourceId?: string
}

const evidenceToCitations = (e: EvidenceRef): ReadonlyArray<Citation> =>
	e.sourceId !== undefined
		? [
				{
					sourceId: e.sourceId,
					...(e.evidenceQuote !== undefined ? { quote: e.evidenceQuote } : {}),
				},
			]
		: []

type FitCheck = EvidenceRef & {
	readonly criterion: string
	readonly result: 'pass' | 'fail' | 'unknown'
}

type Disqualifier = EvidenceRef & { readonly rule: string }

type ConflictEntry = {
	readonly field: string
	readonly value: string
	readonly sourceId?: string
	readonly note?: string
}

// The run's quality signal (camelCased): how well the run grounded, and whether
// it is thin enough that an automation should not act on it unreviewed.
type QualityBlock = {
	readonly rounds?: number
	readonly sourcesMatched?: number
	readonly fieldsGrounded?: number
	readonly groundingRatio?: number
	readonly lowConfidence?: boolean
}

type CompetitorEntry = {
	readonly name: string
	readonly website?: string
	readonly why?: string
	readonly citations?: ReadonlyArray<Citation>
}

type ContactEntry = {
	readonly name: string
	readonly role?: SourcedString
	readonly email?: SourcedString
	readonly phone?: SourcedString
}

type CompanyEnrichmentFindings = CommonFindings & {
	readonly enrichment?: EnrichmentBlock
	readonly verdict?: string
	readonly verdictRationale?: string
	readonly fitChecks?: ReadonlyArray<FitCheck>
	readonly disqualifiers?: ReadonlyArray<Disqualifier>
	readonly hook?: string
	readonly conflicts?: ReadonlyArray<ConflictEntry>
	readonly quality?: QualityBlock
	readonly competitors?: ReadonlyArray<CompetitorEntry>
	readonly contacts?: ReadonlyArray<ContactEntry>
}

// Humanized, localized label for the holistic fit verdict token.
function VerdictLabel({ verdict }: { readonly verdict: string }) {
	switch (verdict) {
		case 'strong_fit':
			return <Trans>Strong fit</Trans>
		case 'possible_fit':
			return <Trans>Possible fit</Trans>
		case 'weak_fit':
			return <Trans>Weak fit</Trans>
		case 'no_fit':
			return <Trans>No fit</Trans>
		default:
			return <>{verdict}</>
	}
}

// Localized label for one fit check's pass/fail/unknown result.
function CheckResult({ result }: { readonly result: string }) {
	switch (result) {
		case 'pass':
			return <Trans>Pass</Trans>
		case 'fail':
			return <Trans>Fail</Trans>
		default:
			return <Trans>Unknown</Trans>
	}
}

const ENRICHMENT_FIELDS: ReadonlyArray<{
	readonly key:
		| 'industry'
		| 'sizeRange'
		| 'country'
		| 'location'
		| 'painPoints'
		| 'currentTools'
	readonly label: ReactNode
}> = [
	{ key: 'industry', label: <Trans>Industry</Trans> },
	{ key: 'sizeRange', label: <Trans>Size</Trans> },
	{ key: 'country', label: <Trans>Country</Trans> },
	{ key: 'location', label: <Trans>Location</Trans> },
	{ key: 'painPoints', label: <Trans>Pain points</Trans> },
	{ key: 'currentTools', label: <Trans>Current tools</Trans> },
]

export function CompanyEnrichmentView({
	findings,
}: {
	readonly findings: CompanyEnrichmentFindings | null | undefined
}) {
	const e = findings?.enrichment
	const competitors = findings?.competitors ?? []
	const contacts = findings?.contacts ?? []
	const verdict = findings?.verdict
	const verdictRationale = findings?.verdictRationale
	const fitChecks = findings?.fitChecks ?? []
	const disqualifiers = findings?.disqualifiers ?? []
	const hook = findings?.hook
	const conflicts = findings?.conflicts ?? []
	const quality = findings?.quality

	return (
		<Sections>
			{verdict !== undefined ||
			fitChecks.length > 0 ||
			disqualifiers.length > 0 ||
			hook !== undefined ? (
				<Section data-testid='research-fit'>
					<SectionTitle>
						<Trans>Fit</Trans>
					</SectionTitle>
					{verdict !== undefined ? (
						<RowHead>
							<Pill>
								<VerdictLabel verdict={verdict} />
							</Pill>
							{verdictRationale !== undefined ? (
								<Reason>{verdictRationale}</Reason>
							) : null}
						</RowHead>
					) : null}
					{fitChecks.length > 0 ? (
						<FieldsTable>
							{fitChecks.map(c => (
								<FieldRow key={c.criterion}>
									<FieldKey>{c.criterion}</FieldKey>
									<FieldValue>
										<CheckResult result={c.result} />
										<CitationList citations={evidenceToCitations(c)} />
									</FieldValue>
								</FieldRow>
							))}
						</FieldsTable>
					) : null}
					{disqualifiers.length > 0 ? (
						<List>
							{disqualifiers.map(d => (
								<ListItem key={d.rule}>
									<Reason>{d.rule}</Reason>
									<CitationList citations={evidenceToCitations(d)} />
								</ListItem>
							))}
						</List>
					) : null}
					{hook !== undefined ? <Reason>{hook}</Reason> : null}
				</Section>
			) : null}

			{conflicts.length > 0 ? (
				<Section data-testid='research-conflicts'>
					<SectionTitle>
						<Trans>Sources disagree</Trans>
					</SectionTitle>
					<FieldsTable>
						{conflicts.map(c => (
							<FieldRow key={`${c.field}|${c.value}`}>
								<FieldKey>{c.field}</FieldKey>
								<FieldValue>
									{c.value}
									<CitationList
										citations={
											c.sourceId !== undefined ? [{ sourceId: c.sourceId }] : []
										}
									/>
									{c.note !== undefined ? <Reason>{c.note}</Reason> : null}
								</FieldValue>
							</FieldRow>
						))}
					</FieldsTable>
				</Section>
			) : null}
			{e !== undefined ? (
				<Section data-testid='research-enrichment'>
					<SectionTitle>
						<Trans>Enrichment</Trans>
					</SectionTitle>
					<FieldsTable>
						{ENRICHMENT_FIELDS.map(({ key, label }) => {
							const field = e[key]
							if (field == null || field.value === '') {
								return null
							}
							return (
								<FieldRow key={key}>
									<FieldKey>{label}</FieldKey>
									<FieldValue>
										{field.value}
										<CitationList citations={sourcedToCitations(field)} />
									</FieldValue>
								</FieldRow>
							)
						})}
						{e.tags !== undefined && e.tags.length > 0 ? (
							<FieldRow>
								<FieldKey>
									<Trans>Tags</Trans>
								</FieldKey>
								<FieldValue>
									<TagList>
										{e.tags.map(t => (
											<Tag key={t}>{t}</Tag>
										))}
									</TagList>
								</FieldValue>
							</FieldRow>
						) : null}
					</FieldsTable>
				</Section>
			) : null}

			{competitors.length > 0 ? (
				<Section data-testid='research-competitors'>
					<SectionTitle>
						<Trans>Competitors</Trans>
					</SectionTitle>
					<List>
						{competitors.map(c => (
							<ListItem key={c.name}>
								<RowHead>
									<Pill>{c.name}</Pill>
									{c.website !== undefined ? (
										<a href={c.website} target='_blank' rel='noreferrer'>
											{c.website}
										</a>
									) : null}
								</RowHead>
								{c.why !== undefined ? <Reason>{c.why}</Reason> : null}
								<CitationList citations={c.citations} />
							</ListItem>
						))}
					</List>
				</Section>
			) : null}

			{contacts.length > 0 ? (
				<Section data-testid='research-contacts'>
					<SectionTitle>
						<Trans>Contacts</Trans>
					</SectionTitle>
					<List>
						{contacts.map(c => (
							<ListItem
								key={`${c.name}|${c.email?.value ?? c.phone?.value ?? ''}`}
							>
								<RowHead>
									<Pill>{c.name}</Pill>
									{c.role?.value !== undefined ? (
										<Reason>{c.role.value}</Reason>
									) : null}
								</RowHead>
								<FieldsTable>
									{c.email?.value != null ? (
										<FieldRow>
											<FieldKey>
												<Trans>Email</Trans>
											</FieldKey>
											<FieldValue>
												<a href={`mailto:${c.email.value}`}>{c.email.value}</a>
												<CitationList citations={sourcedToCitations(c.email)} />
											</FieldValue>
										</FieldRow>
									) : null}
									{c.phone?.value != null ? (
										<FieldRow>
											<FieldKey>
												<Trans>Phone</Trans>
											</FieldKey>
											<FieldValue>
												{c.phone.value}
												<CitationList citations={sourcedToCitations(c.phone)} />
											</FieldValue>
										</FieldRow>
									) : null}
								</FieldsTable>
							</ListItem>
						))}
					</List>
				</Section>
			) : null}

			{quality !== undefined ? (
				<Section data-testid='research-quality'>
					<SectionTitle>
						<Trans>Quality</Trans>
					</SectionTitle>
					<Reason>
						<Trans>
							{quality.fieldsGrounded ?? 0} fields grounded ·{' '}
							{quality.sourcesMatched ?? 0} own-domain sources ·{' '}
							{quality.rounds ?? 0} rounds
						</Trans>
					</Reason>
				</Section>
			) : null}

			<CommonSections findings={findings} />
		</Sections>
	)
}
