import { useAtomSet } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useId, useState } from 'react'
import styled from 'styled-components'

import { NAME_ONLY_EVIDENCE } from '@batuda/research/application/name-only-guard'
import { PriButton, usePriToast } from '@batuda/ui/pri'

import { SafeLink } from '#/components/research/safe-link'
import { BatudaApiAtom } from '#/lib/batuda-api-atom'
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
} from './shared'

/**
 * Renders a `prospect_scan_v1` research finding. Each prospect carries
 * a `why_relevant` rationale + optional industry/country/location/tax_id +
 * citations.
 *
 * A prospect the run could not confirm as a real trading company still belongs on
 * the list — the small firms a scan is really for are the ones with the thinnest
 * trail — so it arrives carrying the reason it could not be confirmed. The row is
 * badged, the reason is spelled out under it, and it is what holds back the
 * one-click handoff from vouching for the company on somebody's behalf.
 */

type ProspectEntry = {
	readonly name: string
	readonly website?: string
	// A company with no site of its own often has one of these and nothing else,
	// so they travel with the lead rather than staying in a finding nobody opens
	// again.
	readonly social_profiles?: ReadonlyArray<{
		readonly kind: string
		readonly value: string
	}>
	readonly tax_id?: string
	readonly industry?: string
	readonly country?: string
	readonly location?: string
	readonly why_relevant: string
	readonly unconfirmed_reason?: string
	// Doubt the run did not put into words but the engine established on its own, so
	// the wording belongs here rather than in the finding.
	readonly unconfirmed_evidence?: string
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
							<ProspectRow
								key={`${p.name}|${p.tax_id ?? p.website ?? ''}`}
								prospect={p}
							/>
						))}
					</List>
				</Section>
			) : null}

			<CommonSections findings={findings} />
		</Sections>
	)
}

// One company in the list. It is its own component so the reason it could not be
// confirmed can carry an id, which the row's button points at — a reader moving
// button to button otherwise meets a column of identical "Add as lead" controls
// with nothing saying which company each belongs to, let alone which of them will
// write a company nobody has vouched for.
function ProspectRow({ prospect }: { readonly prospect: ProspectEntry }) {
	const doubtId = useId()
	const { t } = useLingui()
	// A reason with nothing written in it is not a doubt anybody can weigh, and runs
	// stored before the engine started taking those back still carry them. Read as a
	// mark it would badge the row and hold back the vouching step while naming no
	// cause at all.
	const doubt = prospect.unconfirmed_reason?.trim()
	// The engine's own finding: every page this row cites was a page listing many
	// companies, and it carries neither a site nor a place. Told here rather than
	// stored as a sentence, so it reads in the language the reader is using.
	const nameOnly = prospect.unconfirmed_evidence === NAME_ONLY_EVIDENCE
	const spoken = doubt !== undefined && doubt !== ''
	const unconfirmed = spoken || nameOnly

	return (
		<ListItem>
			<RowHead>
				<Pill>{prospect.name}</Pill>
				{unconfirmed ? (
					<CandidatePill data-testid='prospect-candidate'>
						<Trans>Unconfirmed company</Trans>
					</CandidatePill>
				) : null}
				{prospect.website !== undefined ? (
					<SafeLink href={prospect.website}>{prospect.website}</SafeLink>
				) : null}
			</RowHead>
			<Reason>{prospect.why_relevant}</Reason>
			{unconfirmed ? (
				<Reason id={doubtId}>
					<ReasonLabel>
						<Trans>Could not be confirmed:</Trans>
					</ReasonLabel>{' '}
					{spoken
						? doubt
						: t`Only found named in a list of companies, with no website and no location of its own.`}
				</Reason>
			) : null}
			<FieldsTable>
				{prospect.location !== undefined ? (
					<FieldRow>
						<FieldKey>
							<Trans>Location</Trans>
						</FieldKey>
						<FieldValue>{prospect.location}</FieldValue>
					</FieldRow>
				) : null}
				{prospect.industry !== undefined ? (
					<FieldRow>
						<FieldKey>
							<Trans>Industry</Trans>
						</FieldKey>
						<FieldValue>{prospect.industry}</FieldValue>
					</FieldRow>
				) : null}
				{prospect.country !== undefined ? (
					<FieldRow>
						<FieldKey>
							<Trans>Country</Trans>
						</FieldKey>
						<FieldValue>{prospect.country}</FieldValue>
					</FieldRow>
				) : null}
				{prospect.tax_id !== undefined ? (
					<FieldRow>
						<FieldKey>
							<Trans>Tax ID</Trans>
						</FieldKey>
						<FieldValue>{prospect.tax_id}</FieldValue>
					</FieldRow>
				) : null}
			</FieldsTable>
			<CitationList citations={prospect.citations} />
			<AddAsLeadButton
				prospect={prospect}
				unconfirmed={unconfirmed}
				describedBy={unconfirmed ? doubtId : undefined}
			/>
		</ListItem>
	)
}

// The same shape as Pill, in the warning colour, with an outline so it is not just
// a differently-tinted twin of the name chip beside it. The fill is mixed into a
// surface rather than into transparency: mixed into transparency it takes the
// colour of whatever it lands on, and what it lands on is the section's metal
// plate, which in the light theme is the same amber-beige as the warning colour —
// the badge came out at 1:1 against it, which is to say invisible in the theme
// most people use.
const CandidatePill = styled(Pill)`
	background: color-mix(
		in oklab,
		var(--color-warning) 18%,
		var(--color-surface-container-lowest)
	);
	color: var(--color-on-warning-container);
	border: 1px solid color-mix(in oklab, var(--color-warning) 45%, transparent);
`

// The label on the reason a company could not be confirmed. Without it the reason
// is a second italic paragraph directly under the first, and nothing — not the
// wording, which the model writes, nor the styling, which is identical — says which
// one is why the company matches and which is why nobody could vouch for it.
const ReasonLabel = styled.strong`
	font-style: normal;
	color: var(--color-on-warning-container);
`

// One-click handoff: turn a discovered prospect into a lead (a new company at the
// `prospect` stage, sourced from research) and open it, so a research result flows
// straight into the pipeline.
//
// It is marked verified on the way in — but only for a prospect the run confirmed.
// Verified means a person vouched for this being a real lead, and stamping it on a
// company the run itself said it could not confirm would launder the doubt away at
// the one step where it still shows.
function AddAsLeadButton({
	prospect,
	unconfirmed,
	describedBy,
}: {
	readonly prospect: ProspectEntry
	/** Whether the run left a real reason it could not confirm this company. */
	readonly unconfirmed: boolean
	/** The reason this company could not be confirmed, for a reader to be pointed at. */
	readonly describedBy?: string | undefined
}) {
	const { t } = useLingui()
	const toast = usePriToast()
	const navigate = useNavigate()
	const createCompany = useAtomSet(
		BatudaApiAtom.mutation('companies', 'create'),
		{ mode: 'promiseExit' },
	)
	const verifyCompany = useAtomSet(
		BatudaApiAtom.mutation('companies', 'verify'),
		{ mode: 'promiseExit' },
	)
	const [busy, setBusy] = useState(false)

	// Only the pages that say both what platform they are and where. These come out
	// of a model's answer, and one blank entry would otherwise make the whole
	// request invalid — losing the lead over a footnote, with nothing on screen to
	// say which row was at fault.
	const usableProfiles = (prospect.social_profiles ?? [])
		.filter(p => p.kind.trim() !== '' && p.value.trim() !== '')
		.map(p => ({ kind: p.kind.trim(), value: p.value.trim() }))

	const add = async () => {
		setBusy(true)
		const slug = toSlug(prospect.name)
		const exit = await createCompany({
			payload: {
				name: prospect.name,
				slug,
				status: 'prospect',
				...(prospect.industry ? { industry: prospect.industry } : {}),
				...(prospect.country ? { country: prospect.country } : {}),
				...(prospect.location ? { location: prospect.location } : {}),
				...(prospect.website ? { website: prospect.website } : {}),
				...(usableProfiles.length > 0
					? { socialProfiles: usableProfiles }
					: {}),
			},
		})
		if (exit._tag !== 'Success') {
			setBusy(false)
			toast.add({ title: t`Could not add as a lead`, type: 'error' })
			return
		}
		const row = exit.value as Record<string, unknown>
		const id = typeof row['id'] === 'string' ? row['id'] : null
		const newSlug = typeof row['slug'] === 'string' ? row['slug'] : slug
		const confirmed = !unconfirmed
		if (id !== null && confirmed) {
			await verifyCompany({
				params: { id },
				payload: { verified: true },
			})
		}
		toast.add({
			title: confirmed
				? t`Added as a verified lead`
				: t`Added as an unverified lead`,
			type: 'success',
		})
		void navigate({ to: '/companies/$slug', params: { slug: newSlug } })
	}

	return (
		<PriButton
			type='button'
			$variant='outlined'
			data-testid='prospect-add-lead'
			// Every row carries this button, so the visible words alone leave a reader
			// moving between them with no idea which company each one adds.
			aria-label={
				unconfirmed
					? t`Add ${prospect.name} as an unverified lead`
					: t`Add ${prospect.name} as lead`
			}
			{...(describedBy === undefined
				? {}
				: { 'aria-describedby': describedBy })}
			disabled={busy}
			// Kept reachable while it works: a natively disabled button drops focus to
			// nowhere mid-click, so the label changing to "Adding…" is announced to
			// nobody.
			focusableWhenDisabled
			aria-busy={busy}
			onClick={() => void add()}
		>
			<Plus size={14} aria-hidden />
			{busy ? t`Adding…` : t`Add as lead`}
		</PriButton>
	)
}

// A URL-safe slug from a free-text name, with a short random suffix so two
// prospects with the same name (or an existing company) don't collide.
function toSlug(name: string): string {
	const base = name
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40)
	const suffix = Math.random().toString(36).slice(2, 7)
	return base.length > 0 ? `${base}-${suffix}` : `lead-${suffix}`
}
