import { Trans, useLingui } from '@lingui/react/macro'
import { Link2 } from 'lucide-react'
import styled from 'styled-components'

/**
 * "Sourced from research on {date}" trail with links to the source pages a
 * finding came from — so a stored value is traceable back to the run and the
 * evidence behind it. Shared by the review screen (per-proposal citations)
 * and the contact card (per-contact provenance).
 */

export type ProvenanceSource = {
	readonly url: string
	readonly title?: string | null
}

export function Provenance({
	date,
	sources,
}: {
	readonly date?: string | null
	readonly sources: ReadonlyArray<ProvenanceSource>
}) {
	const { i18n } = useLingui()
	if ((date === undefined || date === null) && sources.length === 0) return null

	const dateLabel =
		date !== undefined && date !== null ? formatDate(date, i18n.locale) : null

	// The same page can be cited more than once; show each source link a
	// single time (and give it a stable key by URL).
	const uniqueSources = [
		...new Map(sources.map(source => [source.url, source])).values(),
	]

	return (
		<Wrap data-testid='research-provenance'>
			<Label>
				<Link2 size={12} aria-hidden />
				{dateLabel !== null ? (
					<Trans>Sourced from research on {dateLabel}</Trans>
				) : (
					<Trans>Sourced from research</Trans>
				)}
			</Label>
			{uniqueSources.length > 0 ? (
				<SourceList>
					{uniqueSources.map(source => (
						<SourceLink
							key={source.url}
							href={source.url}
							target='_blank'
							rel='noopener noreferrer'
						>
							{source.title ?? hostOf(source.url)}
						</SourceLink>
					))}
				</SourceList>
			) : null}
		</Wrap>
	)
}

function formatDate(value: string, locale: string): string {
	const parsed = new Date(value)
	if (Number.isNaN(parsed.getTime())) return value
	return parsed.toLocaleDateString(locale, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	})
}

function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '')
	} catch {
		return url
	}
}

const Wrap = styled.div`
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-2xs);
	font-size: var(--typescale-body-small-size);
	color: var(--color-on-surface-variant);
`

const Label = styled.span`
	display: inline-flex;
	align-items: center;
	gap: var(--space-3xs);
	font-style: italic;
`

const SourceList = styled.span`
	display: inline-flex;
	flex-wrap: wrap;
	gap: var(--space-2xs);
`

const SourceLink = styled.a`
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
	color: var(--color-primary);
	/* Persistent underline so a source link is distinguishable from the
	 * italic trail text without relying on colour alone. */
	text-decoration: underline;

	&:hover {
		text-decoration-thickness: 2px;
	}
`
