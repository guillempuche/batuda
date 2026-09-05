import { Trans, useLingui } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import {
	Check,
	ChevronRight,
	CircleHelp,
	Scale,
	TriangleAlert,
	X,
} from 'lucide-react'
import { styled } from 'next-yak'

import { PriCollapsible } from '@batuda/ui/pri'

import { normalizeConfidence } from '#/components/research/proposal-logic'
import { RelativeDate } from '#/components/shared/relative-date'
import { verdictLabel } from '#/lib/company-fit-verdict'
import { agedPaperSurface, stenciledTitle } from '#/lib/workshop-mixins'

export type FitCheck = {
	readonly criterion: string
	readonly result: string
	readonly evidenceQuote?: string | undefined
	readonly sourceId?: string | undefined
}

export type FitConflict = {
	readonly field: string
	readonly value: string
	readonly sourceId?: string | undefined
	readonly note?: string | undefined
}

export type FieldSource = {
	readonly sourceUrl: string
	readonly runId: string
	readonly confidence?: number | undefined
	readonly asOf?: string | undefined
}

export type FitCompany = {
	readonly fitVerdict: string | null
	readonly fitChecks: ReadonlyArray<FitCheck> | null
	readonly fitConflicts: ReadonlyArray<FitConflict> | null
	readonly fieldProvenance: Readonly<Record<string, FieldSource>> | null
}

/**
 * Whether this company is worth selling to, and why.
 *
 * The one-word verdict on its own asks to be taken on trust, so the rules behind
 * it are listed with the quote and page that decided each one — a reader can
 * disagree with the judgement by checking its evidence rather than by feeling.
 *
 * Two smaller trails sit underneath: readings the sources disagreed on (the
 * field carries the most recent one, and the rejected ones stay visible rather
 * than being silently dropped), and, per field, which page it was read from and
 * which run read it.
 */
export function CompanyFitSection({
	company,
}: {
	readonly company: FitCompany
}) {
	const { i18n } = useLingui()
	const checks = company.fitChecks ?? []
	const conflicts = company.fitConflicts ?? []
	const provenance = Object.entries(company.fieldProvenance ?? {})

	// Whether a company was judged and found wanting, or never judged at all, are
	// two different answers. Vanishing gave the same silence to both.
	const unjudged =
		company.fitVerdict === null &&
		checks.length === 0 &&
		conflicts.length === 0 &&
		provenance.length === 0

	if (unjudged)
		return (
			<PriCollapsible.Root>
				<TriggerWrap>
					<PriCollapsible.Trigger data-testid='company-fit-trigger'>
						<ChevronRight size={14} aria-hidden />
						<Scale size={14} aria-hidden />
						<Trans>Fit</Trans>
					</PriCollapsible.Trigger>
				</TriggerWrap>
				<PriCollapsible.Panel>
					<Body data-testid='company-fit-panel'>
						<Unjudged data-testid='company-fit-empty'>
							<Trans>
								Research has not weighed this company up yet. Run it to get a
								verdict and the reasons behind it.
							</Trans>
						</Unjudged>
					</Body>
				</PriCollapsible.Panel>
			</PriCollapsible.Root>
		)

	return (
		<PriCollapsible.Root defaultOpen={company.fitVerdict !== null}>
			<TriggerWrap>
				<PriCollapsible.Trigger data-testid='company-fit-trigger'>
					<ChevronRight size={14} aria-hidden />
					<Scale size={14} aria-hidden />
					<Trans>Fit</Trans>
					{company.fitVerdict !== null ? (
						<Verdict
							$verdict={company.fitVerdict}
							data-testid='company-fit-verdict'
						>
							{verdictLabel(i18n, company.fitVerdict)}
						</Verdict>
					) : null}
				</PriCollapsible.Trigger>
			</TriggerWrap>
			<PriCollapsible.Panel>
				<Body data-testid='company-fit-panel'>
					{checks.length > 0 ? (
						<Group>
							<GroupTitle>
								<Trans>Criteria</Trans>
							</GroupTitle>
							<List>
								{checks.map(check => (
									<CheckRow key={`${check.criterion}-${check.result}`}>
										<ResultIcon $result={check.result}>
											{check.result === 'pass' ? (
												<Check size={12} aria-hidden />
											) : check.result === 'fail' ? (
												<X size={12} aria-hidden />
											) : (
												<CircleHelp size={12} aria-hidden />
											)}
										</ResultIcon>
										<CheckBody>
											<Criterion>{check.criterion}</Criterion>
											{check.evidenceQuote !== undefined ? (
												<Quote>“{check.evidenceQuote}”</Quote>
											) : null}
										</CheckBody>
										{check.sourceId !== undefined ? (
											<SourceLink
												href={check.sourceId}
												target='_blank'
												rel='noreferrer noopener'
											>
												<Trans>source</Trans>
											</SourceLink>
										) : null}
									</CheckRow>
								))}
							</List>
						</Group>
					) : null}

					{conflicts.length > 0 ? (
						<Group>
							<GroupTitle>
								<TriangleAlert size={12} aria-hidden />
								<Trans>Sources disagree</Trans>
							</GroupTitle>
							<List>
								{conflicts.map(conflict => (
									<ConflictRow
										key={`${conflict.field}-${conflict.value}`}
										data-testid='company-fit-conflict'
									>
										<Criterion>{conflict.field}</Criterion>
										<ConflictValue>
											<Trans>also reported as {conflict.value}</Trans>
										</ConflictValue>
										{conflict.note !== undefined ? (
											<Quote>{conflict.note}</Quote>
										) : null}
										{conflict.sourceId !== undefined ? (
											<SourceLink
												href={conflict.sourceId}
												target='_blank'
												rel='noreferrer noopener'
											>
												<Trans>source</Trans>
											</SourceLink>
										) : null}
									</ConflictRow>
								))}
							</List>
						</Group>
					) : null}

					{provenance.length > 0 ? (
						<Group>
							<GroupTitle>
								<Trans>Where each fact came from</Trans>
							</GroupTitle>
							<List>
								{provenance.map(([field, source]) => {
									// The model reports a 0–1 fraction while enrichment providers
									// report 0–100, so both are put on the same scale before being
									// shown as a percentage.
									const sureness = normalizeConfidence(source.confidence)
									return (
										<ProvenanceRow
											key={field}
											data-testid='company-field-source'
										>
											<Criterion>{field}</Criterion>
											<SourceLink
												href={source.sourceUrl}
												target='_blank'
												rel='noreferrer noopener'
											>
												{hostOf(source.sourceUrl)}
											</SourceLink>
											<RunLinkWrap>
												<Link to='/research/$id' params={{ id: source.runId }}>
													<Trans>run</Trans>
												</Link>
											</RunLinkWrap>
											{/* How sure the run was, and how old the fact is: one read
											    a year ago should not look like one confirmed this
											    morning. */}
											{sureness !== null ? (
												<Qualifier data-testid='company-field-source-confidence'>
													{`${sureness}%`}
												</Qualifier>
											) : null}
											{source.asOf !== undefined ? (
												<Qualifier data-testid='company-field-source-as-of'>
													<Trans>as of</Trans>{' '}
													<RelativeDate value={source.asOf} />
												</Qualifier>
											) : null}
										</ProvenanceRow>
									)
								})}
							</List>
						</Group>
					) : null}
				</Body>
			</PriCollapsible.Panel>
		</PriCollapsible.Root>
	)
}

function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '')
	} catch {
		return url
	}
}

const TriggerWrap = styled.div`
	display: flex;
	justify-content: flex-start;
`

const Verdict = styled.span<{ $verdict: string }>`
	${stenciledTitle}
	padding: 0 var(--space-2xs);
	border: 1px solid currentColor;
	border-radius: var(--shape-2xs);
	font-size: var(--typescale-label-small-size);
	color: ${p =>
		p.$verdict === 'strong_fit'
			? 'var(--color-success)'
			: p.$verdict === 'no_fit'
				? 'var(--color-error)'
				: 'var(--color-on-surface-variant)'};
`

const Unjudged = styled.p`
	margin: 0;
	font-family: var(--font-body);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
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
	gap: var(--space-2xs);
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

const List = styled.ul`
	display: flex;
	flex-direction: column;
	gap: var(--space-xs);
	margin: 0;
	padding: 0;
	list-style: none;
`

const CheckRow = styled.li`
	display: flex;
	align-items: flex-start;
	gap: var(--space-2xs);
`

const ResultIcon = styled.span<{ $result: string }>`
	display: inline-flex;
	flex-shrink: 0;
	margin-top: 2px;
	color: ${p =>
		p.$result === 'pass'
			? 'var(--color-success)'
			: p.$result === 'fail'
				? 'var(--color-error)'
				: 'var(--color-on-surface-variant)'};
`

const CheckBody = styled.div`
	display: flex;
	flex-direction: column;
	gap: var(--space-3xs);
	min-width: 0;
	flex: 1;
`

const ConflictRow = styled.li`
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: var(--space-2xs);
`

const ProvenanceRow = styled.li`
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: var(--space-2xs);
`

const Qualifier = styled.span`
	display: inline-flex;
	align-items: baseline;
	gap: var(--space-3xs);
	font-size: var(--typescale-label-small-size);
	color: var(--color-on-surface-variant);
	white-space: nowrap;
`

const Criterion = styled.span`
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface);
`

const ConflictValue = styled.span`
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const Quote = styled.span`
	font-size: var(--typescale-label-small-size);
	font-style: italic;
	color: var(--color-on-surface-variant);
`

const SourceLink = styled.a`
	font-size: var(--typescale-label-small-size);
	color: var(--color-primary);
`

const RunLinkWrap = styled.span`
	& > a {
		font-size: var(--typescale-label-small-size);
		color: var(--color-primary);
	}
`
