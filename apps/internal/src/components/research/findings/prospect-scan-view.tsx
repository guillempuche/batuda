import { useAtomSet } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import styled from 'styled-components'

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
 * trail — so it arrives carrying the reason it could not be confirmed. That reason
 * is shown beside the name, and it is what holds back the one-click handoff from
 * vouching for the company on somebody's behalf.
 */

type ProspectEntry = {
	readonly name: string
	readonly website?: string
	readonly tax_id?: string
	readonly industry?: string
	readonly country?: string
	readonly location?: string
	readonly why_relevant: string
	readonly unconfirmed_reason?: string
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
									{p.unconfirmed_reason !== undefined ? (
										<CandidatePill data-testid='prospect-candidate'>
											<Trans>Unconfirmed</Trans>
										</CandidatePill>
									) : null}
									{p.website !== undefined ? (
										<SafeLink href={p.website}>{p.website}</SafeLink>
									) : null}
								</RowHead>
								<Reason>{p.why_relevant}</Reason>
								{p.unconfirmed_reason !== undefined ? (
									<Reason>{p.unconfirmed_reason}</Reason>
								) : null}
								<FieldsTable>
									{p.location !== undefined ? (
										<FieldRow>
											<FieldKey>
												<Trans>Location</Trans>
											</FieldKey>
											<FieldValue>{p.location}</FieldValue>
										</FieldRow>
									) : null}
									{p.industry !== undefined ? (
										<FieldRow>
											<FieldKey>
												<Trans>Industry</Trans>
											</FieldKey>
											<FieldValue>{p.industry}</FieldValue>
										</FieldRow>
									) : null}
									{p.country !== undefined ? (
										<FieldRow>
											<FieldKey>
												<Trans>Country</Trans>
											</FieldKey>
											<FieldValue>{p.country}</FieldValue>
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
								</FieldsTable>
								<CitationList citations={p.citations} />
								<AddAsLeadButton prospect={p} />
							</ListItem>
						))}
					</List>
				</Section>
			) : null}

			<CommonSections findings={findings} />
		</Sections>
	)
}

// The same shape as Pill, in the warning colour: a row the run could not confirm
// reads as a lead like any other until something on it says otherwise.
const CandidatePill = styled(Pill)`
	background: color-mix(in oklab, var(--color-warning) 16%, transparent);
	color: var(--color-warning);
`

// One-click handoff: turn a discovered prospect into a lead (a new company at the
// `prospect` stage, sourced from research) and open it, so a research result flows
// straight into the pipeline.
//
// It is marked verified on the way in — but only for a prospect the run confirmed.
// Verified means a person vouched for this being a real lead, and stamping it on a
// company the run itself said it could not confirm would launder the doubt away at
// the one step where it still shows.
function AddAsLeadButton({ prospect }: { readonly prospect: ProspectEntry }) {
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
		const confirmed = prospect.unconfirmed_reason === undefined
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
			disabled={busy}
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
