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
	readonly productsFit?: ReadonlyArray<string>
	readonly tags?: ReadonlyArray<string>
	readonly location?: SourcedString
	readonly region?: SourcedString
	readonly address?: SourcedString
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
	readonly competitors?: ReadonlyArray<CompetitorEntry>
	readonly contacts?: ReadonlyArray<ContactEntry>
}

const ENRICHMENT_FIELDS: ReadonlyArray<{
	readonly key:
		| 'industry'
		| 'sizeRange'
		| 'region'
		| 'location'
		| 'address'
		| 'painPoints'
		| 'currentTools'
	readonly label: ReactNode
}> = [
	{ key: 'industry', label: <Trans>Industry</Trans> },
	{ key: 'sizeRange', label: <Trans>Size</Trans> },
	{ key: 'region', label: <Trans>Region</Trans> },
	{ key: 'location', label: <Trans>Location</Trans> },
	{ key: 'address', label: <Trans>Address</Trans> },
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

	return (
		<Sections>
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
						{e.productsFit !== undefined && e.productsFit.length > 0 ? (
							<FieldRow>
								<FieldKey>
									<Trans>Products fit</Trans>
								</FieldKey>
								<FieldValue>
									<TagList>
										{e.productsFit.map(p => (
											<Tag key={p}>{p}</Tag>
										))}
									</TagList>
								</FieldValue>
							</FieldRow>
						) : null}
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

			<CommonSections findings={findings} />
		</Sections>
	)
}
