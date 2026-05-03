import { Trans } from '@lingui/react/macro'

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
 * Renders a `prospect-scan-v1` research finding. Each prospect carries
 * a `why_relevant` rationale + optional industry/region/tax_id +
 * pain-indicator tags + citations.
 */

type ProspectEntry = {
	readonly name: string
	readonly website?: string
	readonly tax_id?: string
	readonly industry?: string
	readonly region?: string
	readonly why_relevant: string
	readonly pain_indicators?: ReadonlyArray<string>
	readonly citations?: ReadonlyArray<Citation>
}

type ProspectScanFindings = CommonFindings & {
	readonly prospects?: ReadonlyArray<ProspectEntry>
}

export function ProspectScanView({
	findings,
}: {
	readonly findings: ProspectScanFindings | null | undefined
}) {
	const prospects = findings?.prospects ?? []

	return (
		<Sections>
			{prospects.length > 0 ? (
				<Section data-testid='research-prospects'>
					<SectionTitle>
						<Trans>Prospects</Trans>
					</SectionTitle>
					<List>
						{prospects.map(p => (
							<ListItem key={`${p.name}|${p.tax_id ?? p.website ?? ''}`}>
								<RowHead>
									<Pill>{p.name}</Pill>
									{p.website !== undefined ? (
										<a href={p.website} target='_blank' rel='noreferrer'>
											{p.website}
										</a>
									) : null}
								</RowHead>
								<Reason>{p.why_relevant}</Reason>
								<FieldsTable>
									{p.industry !== undefined ? (
										<FieldRow>
											<FieldKey>
												<Trans>Industry</Trans>
											</FieldKey>
											<FieldValue>{p.industry}</FieldValue>
										</FieldRow>
									) : null}
									{p.region !== undefined ? (
										<FieldRow>
											<FieldKey>
												<Trans>Region</Trans>
											</FieldKey>
											<FieldValue>{p.region}</FieldValue>
										</FieldRow>
									) : null}
									{p.tax_id !== undefined ? (
										<FieldRow>
											<FieldKey>
												<Trans>Tax ID</Trans>
											</FieldKey>
											<FieldValue>{p.tax_id}</FieldValue>
										</FieldRow>
									) : null}
									{p.pain_indicators !== undefined &&
									p.pain_indicators.length > 0 ? (
										<FieldRow>
											<FieldKey>
												<Trans>Pain indicators</Trans>
											</FieldKey>
											<FieldValue>
												<TagList>
													{p.pain_indicators.map(t => (
														<Tag key={t}>{t}</Tag>
													))}
												</TagList>
											</FieldValue>
										</FieldRow>
									) : null}
								</FieldsTable>
								<CitationList citations={p.citations} />
							</ListItem>
						))}
					</List>
				</Section>
			) : null}

			<CommonSections findings={findings} />
		</Sections>
	)
}
