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
 * Renders a `company-enrichment-v1` research finding. Surfaces the
 * enrichment object (industry, size_range, pain_points, etc.) as a
 * typed field table, then competitor + contact arrays as their own
 * sections, finally the cross-cutting common sections.
 */

type EnrichmentBlock = {
	readonly industry?: string
	readonly size_range?: string
	readonly pain_points?: string
	readonly current_tools?: string
	readonly products_fit?: ReadonlyArray<string>
	readonly tags?: ReadonlyArray<string>
	readonly location?: string
	readonly region?: string
	readonly address?: string
	readonly latitude?: number
	readonly longitude?: number
	readonly citations?: ReadonlyArray<Citation>
}

type CompetitorEntry = {
	readonly name: string
	readonly website?: string
	readonly why?: string
	readonly citations?: ReadonlyArray<Citation>
}

type ContactEntry = {
	readonly name: string
	readonly role?: string
	readonly email?: string
	readonly phone?: string
	readonly citations?: ReadonlyArray<Citation>
}

type CompanyEnrichmentFindings = CommonFindings & {
	readonly enrichment?: EnrichmentBlock
	readonly competitors?: ReadonlyArray<CompetitorEntry>
	readonly contacts?: ReadonlyArray<ContactEntry>
}

const ENRICHMENT_FIELDS: ReadonlyArray<{
	readonly key: keyof EnrichmentBlock
	readonly label: ReactNode
}> = [
	{ key: 'industry', label: <Trans>Industry</Trans> },
	{ key: 'size_range', label: <Trans>Size</Trans> },
	{ key: 'region', label: <Trans>Region</Trans> },
	{ key: 'location', label: <Trans>Location</Trans> },
	{ key: 'address', label: <Trans>Address</Trans> },
	{ key: 'pain_points', label: <Trans>Pain points</Trans> },
	{ key: 'current_tools', label: <Trans>Current tools</Trans> },
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
							const value = e[key]
							if (value === undefined || value === null || value === '') {
								return null
							}
							return (
								<FieldRow key={String(key)}>
									<FieldKey>{label}</FieldKey>
									<FieldValue>{String(value)}</FieldValue>
								</FieldRow>
							)
						})}
						{e.products_fit !== undefined && e.products_fit.length > 0 ? (
							<FieldRow>
								<FieldKey>
									<Trans>Products fit</Trans>
								</FieldKey>
								<FieldValue>
									<TagList>
										{e.products_fit.map(p => (
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
					<CitationList citations={e.citations} />
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
							<ListItem key={`${c.name}|${c.email ?? c.phone ?? ''}`}>
								<RowHead>
									<Pill>{c.name}</Pill>
									{c.role !== undefined ? <Reason>{c.role}</Reason> : null}
								</RowHead>
								<FieldsTable>
									{c.email !== undefined ? (
										<FieldRow>
											<FieldKey>
												<Trans>Email</Trans>
											</FieldKey>
											<FieldValue>
												<a href={`mailto:${c.email}`}>{c.email}</a>
											</FieldValue>
										</FieldRow>
									) : null}
									{c.phone !== undefined ? (
										<FieldRow>
											<FieldKey>
												<Trans>Phone</Trans>
											</FieldKey>
											<FieldValue>{c.phone}</FieldValue>
										</FieldRow>
									) : null}
								</FieldsTable>
								<CitationList citations={c.citations} />
							</ListItem>
						))}
					</List>
				</Section>
			) : null}

			<CommonSections findings={findings} />
		</Sections>
	)
}
