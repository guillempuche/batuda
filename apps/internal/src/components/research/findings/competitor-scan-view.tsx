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
 * Renders a `competitor-scan-v1` research finding. Each competitor has
 * description + strengths + weaknesses + overlap; the optional
 * market_summary provides a top-level summary card.
 */

type CompetitorEntry = {
	readonly name: string
	readonly website?: string
	readonly description?: string
	readonly strengths?: ReadonlyArray<string>
	readonly weaknesses?: ReadonlyArray<string>
	readonly overlap?: string
	readonly citations?: ReadonlyArray<Citation>
}

type MarketSummary = {
	readonly total_competitors_found: number
	readonly market_maturity?: string
	readonly key_differentiators?: ReadonlyArray<string>
	readonly citations?: ReadonlyArray<Citation>
}

type CompetitorScanFindings = CommonFindings & {
	readonly competitors?: ReadonlyArray<CompetitorEntry>
	readonly market_summary?: MarketSummary
}

export function CompetitorScanView({
	findings,
}: {
	readonly findings: CompetitorScanFindings | null | undefined
}) {
	const competitors = findings?.competitors ?? []
	const summary = findings?.market_summary

	return (
		<Sections>
			{summary !== undefined ? (
				<Section data-testid='research-market-summary'>
					<SectionTitle>
						<Trans>Market summary</Trans>
					</SectionTitle>
					<FieldsTable>
						<FieldRow>
							<FieldKey>
								<Trans>Total competitors</Trans>
							</FieldKey>
							<FieldValue>{summary.total_competitors_found}</FieldValue>
						</FieldRow>
						{summary.market_maturity !== undefined ? (
							<FieldRow>
								<FieldKey>
									<Trans>Maturity</Trans>
								</FieldKey>
								<FieldValue>{summary.market_maturity}</FieldValue>
							</FieldRow>
						) : null}
						{summary.key_differentiators !== undefined &&
						summary.key_differentiators.length > 0 ? (
							<FieldRow>
								<FieldKey>
									<Trans>Key differentiators</Trans>
								</FieldKey>
								<FieldValue>
									<TagList>
										{summary.key_differentiators.map(d => (
											<Tag key={d}>{d}</Tag>
										))}
									</TagList>
								</FieldValue>
							</FieldRow>
						) : null}
					</FieldsTable>
					<CitationList citations={summary.citations} />
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
								{c.description !== undefined ? (
									<Reason>{c.description}</Reason>
								) : null}
								<FieldsTable>
									{c.overlap !== undefined ? (
										<FieldRow>
											<FieldKey>
												<Trans>Overlap</Trans>
											</FieldKey>
											<FieldValue>{c.overlap}</FieldValue>
										</FieldRow>
									) : null}
									{c.strengths !== undefined && c.strengths.length > 0 ? (
										<FieldRow>
											<FieldKey>
												<Trans>Strengths</Trans>
											</FieldKey>
											<FieldValue>
												<TagList>
													{c.strengths.map(s => (
														<Tag key={s}>{s}</Tag>
													))}
												</TagList>
											</FieldValue>
										</FieldRow>
									) : null}
									{c.weaknesses !== undefined && c.weaknesses.length > 0 ? (
										<FieldRow>
											<FieldKey>
												<Trans>Weaknesses</Trans>
											</FieldKey>
											<FieldValue>
												<TagList>
													{c.weaknesses.map(w => (
														<Tag key={w}>{w}</Tag>
													))}
												</TagList>
											</FieldValue>
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
