import { useAtomSet } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useId, useState } from 'react'
import styled from 'styled-components'

import { companySlugFromName } from '@batuda/domain'
import { prospectHoldBack } from '@batuda/research/application/prospect-hold-back'
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
	sourcedText,
} from './shared'

/**
 * Renders a `prospect_scan_v1` research finding. Each prospect carries
 * a `why_relevant` rationale + optional industry/countries/location/tax_id +
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
	readonly website?: unknown
	// A company with no site of its own often has one of these and nothing else,
	// so they travel with the lead rather than staying in a finding nobody opens
	// again.
	readonly social_profiles?: ReadonlyArray<{
		readonly kind: string
		readonly value: string
	}>
	readonly tax_id?: string
	readonly industry?: string
	readonly countries?: ReadonlyArray<string>
	// Paired with the page it was read on, like the website above. Runs stored
	// before it was paired hold a bare string, so both shapes are read.
	readonly location?: unknown
	readonly why_relevant: string
	readonly unconfirmed_reason?: string
	// Doubt the run did not put into words but the engine established on its own, so
	// the wording belongs here rather than in the finding.
	readonly unconfirmed_evidence?: string
	// What the guards found out about this row, as words rather than sentences, so
	// each is written here in the reader's own language. A list rather than one
	// field, because a row can be more than one thing at once and a second
	// single-value field would quietly overwrite the first.
	readonly marks?: ReadonlyArray<string>
	// Why the run placed this company outside the area that was asked for. Its own
	// field, because a mark is a word and the reason is the run's own sentence.
	readonly outside_place_reason?: string
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
								key={`${p.name}|${p.tax_id ?? sourcedText(p.website) ?? ''}`}
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
	const placeId = useId()
	const { t } = useLingui()
	// What the run held back about this company. The same answer gates the
	// vouching step below, so it is read from one place rather than two.
	const { couldNotConfirm, outsidePlace, holdsBack, spokenReason } =
		prospectHoldBack(prospect)
	const outsideReason = prospect.outside_place_reason?.trim()
	// The address on its own: a scan reports it paired with the page it was read
	// on, so the value here is not the string a link needs. The place is reported
	// the same way, and read the same way.
	const site = sourcedText(prospect.website)
	const place = sourcedText(prospect.location)

	return (
		<ListItem>
			<RowHead>
				<Pill>{prospect.name}</Pill>
				{couldNotConfirm ? (
					<CandidatePill data-testid='prospect-candidate'>
						<Trans>Unconfirmed company</Trans>
					</CandidatePill>
				) : null}
				{outsidePlace ? (
					<CandidatePill data-testid='prospect-outside-place'>
						<Trans>Outside the area searched</Trans>
					</CandidatePill>
				) : null}
				{site !== undefined ? <SafeLink href={site}>{site}</SafeLink> : null}
			</RowHead>
			<Reason>{prospect.why_relevant}</Reason>
			{couldNotConfirm ? (
				<Reason id={doubtId}>
					<ReasonLabel>
						<Trans>Could not be confirmed:</Trans>
					</ReasonLabel>{' '}
					{/* The fallback is the engine's finding rather than the run's, so it
					    is said here rather than stored, and reads in the reader's
					    language. */}
					{spokenReason ??
						t`Only found named in a list of companies, with no website and no location of its own.`}
				</Reason>
			) : null}
			{/* Said separately from the doubt above, and never in its words: a company
			    placed elsewhere usually has both a website and a location, so the
			    sentence there would be plainly untrue of it. */}
			{outsidePlace ? (
				<Reason id={placeId}>
					<ReasonLabel>
						<Trans>Outside the area searched:</Trans>
					</ReasonLabel>{' '}
					{outsideReason !== undefined && outsideReason !== ''
						? outsideReason
						: t`The evidence places this company outside the area the search asked about.`}
				</Reason>
			) : null}
			<FieldsTable>
				{place !== undefined ? (
					<FieldRow>
						<FieldKey>
							<Trans>Location</Trans>
						</FieldKey>
						<FieldValue>{place}</FieldValue>
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
				{prospect.countries !== undefined && prospect.countries.length > 0 ? (
					<FieldRow>
						<FieldKey>
							<Trans>Countries</Trans>
						</FieldKey>
						<FieldValue>{prospect.countries.join(', ')}</FieldValue>
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
				heldBack={holdsBack}
				// Both reasons, not the first of them. A row can carry the doubt and
				// the place at once, and the place is the half likelier to stop
				// somebody adding the company — read out only one, and that is the
				// half they never hear.
				describedBy={
					[couldNotConfirm ? doubtId : '', outsidePlace ? placeId : '']
						.filter(Boolean)
						.join(' ') || undefined
				}
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
	heldBack,
	describedBy,
}: {
	readonly prospect: ProspectEntry
	/** Either kind of hold-back; both stop the vouching step. */
	readonly heldBack: boolean
	/**
	 * The reasons this company was held back, for a reader to be pointed at —
	 * space-separated when there is more than one, as the attribute allows.
	 */
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
				// A company row holds one country, and a scan may have named several. The
				// first is the one it is registered in, which is what the row means.
				...(prospect.countries?.[0] ? { country: prospect.countries[0] } : {}),
				// The place goes onto the company record and from there onto a map, so
				// it is read off the pairing rather than written across whole — an
				// object put here would reach the CRM as one.
				...(sourcedText(prospect.location)
					? { location: sourcedText(prospect.location) }
					: {}),
				...(sourcedText(prospect.website)
					? { website: sourcedText(prospect.website) }
					: {}),
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
		// What the company ended up as, not what this click meant it to be: the
		// vouching step is a second call that can fail on its own, and a message
		// read off the intent would say verified when it is not.
		const vouchWanted = id !== null && !heldBack
		const verified =
			vouchWanted &&
			(
				await verifyCompany({
					params: { id },
					payload: { verified: true },
				})
			)._tag === 'Success'
		// A wanted vouch that did not land is its own outcome: the company is on
		// file, and 'unverified' would read as the run's doing rather than as
		// something to try again.
		if (vouchWanted && !verified) {
			toast.add({
				title: t`Added, but could not be marked verified`,
				type: 'error',
			})
		} else {
			toast.add({
				title: verified
					? t`Added as a verified lead`
					: t`Added as an unverified lead`,
				type: 'success',
			})
		}
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
				heldBack
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
			{/* Says which of the two this does, as the screen-reader label and the
			    message afterwards already do. */}
			{busy
				? t`Adding…`
				: heldBack
					? t`Add as unverified lead`
					: t`Add as lead`}
		</PriButton>
	)
}

// A web address for a prospect, with a short random suffix so two prospects of the
// same name (or an existing company) don't collide.
//
// The name is read by the shared rule rather than here, because reading it here got
// it wrong both ways: "Calderería Sentmenat" came out "caldereri-a-sentmenat", and
// "北京科技有限公司" came out "lead-x7f2q" with the company's own name nowhere in it.
function toSlug(name: string): string {
	const suffix = Math.random().toString(36).slice(2, 7)
	return `${companySlugFromName(name)}-${suffix}`
}
