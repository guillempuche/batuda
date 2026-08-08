import { Plural, Trans } from '@lingui/react/macro'
import type { ReactNode } from 'react'

import { SafeLink } from '#/components/research/safe-link'
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
	QualityList,
	Reason,
	RowHead,
	Section,
	Sections,
	SectionTitle,
	sourcedText,
	Tag,
	TagList,
} from './shared'

/**
 * Renders a `company_enrichment_v1` research finding. Surfaces the
 * enrichment object (industry, size_range, current_tools, etc.) as a
 * typed field table, then competitor + contact arrays as their own
 * sections, finally the cross-cutting common sections.
 */

// A per-field value paired with the source backing it, as stored.
type SourcedString = {
	readonly value: string
	readonly source_id: string
	readonly quote?: string
	readonly confidence?: number
}

const sourcedToCitations = (
	field: SourcedString | null | undefined,
): ReadonlyArray<Citation> =>
	field != null
		? [
				{
					source_id: field.source_id,
					...(field.quote !== undefined ? { quote: field.quote } : {}),
					...(field.confidence !== undefined
						? { confidence: field.confidence }
						: {}),
				},
			]
		: []

type EnrichmentBlock = {
	readonly industry?: SourcedString
	readonly size_range?: SourcedString
	readonly current_tools?: SourcedString
	readonly tags?: ReadonlyArray<string>
	readonly location?: SourcedString
	readonly country?: SourcedString
}

// An evidence-backed row (a fit check or a disqualifier): the source URL and,
// where present, the quote that decides it.
type EvidenceRef = {
	readonly evidence_quote?: string
	readonly source_id?: string
}

const evidenceToCitations = (e: EvidenceRef): ReadonlyArray<Citation> =>
	e.source_id !== undefined
		? [
				{
					source_id: e.source_id,
					...(e.evidence_quote !== undefined
						? { quote: e.evidence_quote }
						: {}),
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
	readonly source_id?: string
	readonly note?: string
}

// The run's quality signal: how well the run grounded, and whether it is thin
// enough that an automation should not act on it unreviewed.
type QualityBlock = {
	readonly rounds?: number
	readonly sources_matched?: number
	readonly fields_grounded?: number
	readonly grounding_ratio?: number
	readonly low_confidence?: boolean
}

type CompetitorEntry = {
	readonly name: string
	readonly website?: unknown
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
	readonly verdict_rationale?: string
	readonly fit_checks?: ReadonlyArray<FitCheck>
	readonly disqualifiers?: ReadonlyArray<Disqualifier>
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
		| 'size_range'
		| 'country'
		| 'location'
		| 'current_tools'
	readonly label: ReactNode
}> = [
	{ key: 'industry', label: <Trans>Industry</Trans> },
	{ key: 'size_range', label: <Trans>Size</Trans> },
	{ key: 'country', label: <Trans>Country</Trans> },
	{ key: 'location', label: <Trans>Location</Trans> },
	{ key: 'current_tools', label: <Trans>Current tools</Trans> },
]

// A competitor's address, whether the run paired it with its source or, on an
// older run, stored it bare.
const CompetitorSite = ({ website }: { readonly website?: unknown }) => {
	const site = sourcedText(website)
	return site === undefined ? null : <SafeLink href={site}>{site}</SafeLink>
}

export function CompanyEnrichmentView({
	findings,
}: {
	readonly findings: CompanyEnrichmentFindings | null | undefined
}) {
	const e = findings?.enrichment
	const competitors = findings?.competitors ?? []
	const contacts = findings?.contacts ?? []
	const verdict = findings?.verdict
	const verdictRationale = findings?.verdict_rationale
	const fitChecks = findings?.fit_checks ?? []
	const disqualifiers = findings?.disqualifiers ?? []
	const conflicts = findings?.conflicts ?? []
	const quality = findings?.quality

	return (
		<Sections>
			{verdict !== undefined ||
			fitChecks.length > 0 ||
			disqualifiers.length > 0 ? (
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
											c.source_id !== undefined
												? [{ source_id: c.source_id }]
												: []
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
									<CompetitorSite website={c.website} />
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
												<SafeLink href={`mailto:${c.email.value}`}>
													{c.email.value}
												</SafeLink>
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
					<QualityList>
						<li>
							<Plural
								value={quality.fields_grounded ?? 0}
								one='# fact backed by a source'
								other='# facts backed by a source'
							/>
						</li>
						<li>
							<Plural
								value={quality.sources_matched ?? 0}
								one="# page on the company's own site"
								other="# pages on the company's own site"
							/>
						</li>
						<li>
							<Plural
								value={quality.rounds ?? 0}
								one='# pass over the evidence'
								other='# passes over the evidence'
							/>
						</li>
					</QualityList>
				</Section>
			) : null}

			<CommonSections findings={findings} />
		</Sections>
	)
}
