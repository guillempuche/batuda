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
 * a `whyRelevant` rationale + optional industry/region/taxId +
 * pain-indicator tags + citations.
 */

type ProspectEntry = {
	readonly name: string
	readonly website?: string
	readonly taxId?: string
	readonly industry?: string
	readonly region?: string
	readonly whyRelevant: string
	readonly painIndicators?: ReadonlyArray<string>
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
							<ListItem key={`${p.name}|${p.taxId ?? p.website ?? ''}`}>
								<RowHead>
									<Pill>{p.name}</Pill>
									{p.website !== undefined ? (
										<a href={p.website} target='_blank' rel='noreferrer'>
											{p.website}
										</a>
									) : null}
								</RowHead>
								<Reason>{p.whyRelevant}</Reason>
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
									{p.taxId !== undefined ? (
										<FieldRow>
											<FieldKey>
												<Trans>Tax ID</Trans>
											</FieldKey>
											<FieldValue>{p.taxId}</FieldValue>
										</FieldRow>
									) : null}
									{p.painIndicators !== undefined &&
									p.painIndicators.length > 0 ? (
										<FieldRow>
											<FieldKey>
												<Trans>Pain indicators</Trans>
											</FieldKey>
											<FieldValue>
												<TagList>
													{p.painIndicators.map(t => (
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
