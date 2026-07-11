import { useAtomSet } from '@effect/atom-react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useState } from 'react'

import { PriButton, usePriToast } from '@batuda/ui/pri'

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
	Tag,
	TagList,
} from './shared'

/**
 * Renders a `prospect_scan_v1` research finding. Each prospect carries
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

// One-click handoff: turn a discovered prospect into a verified lead (a new
// company at the `prospect` stage, marked verified and sourced from research)
// and open it, so a research result flows straight into the pipeline.
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
				source: 'research',
				...(prospect.industry ? { industry: prospect.industry } : {}),
				...(prospect.region ? { region: prospect.region } : {}),
				...(prospect.website ? { website: prospect.website } : {}),
			},
		} as never)
		if (exit._tag !== 'Success') {
			setBusy(false)
			toast.add({ title: t`Could not add as a lead`, type: 'error' })
			return
		}
		const row = exit.value as Record<string, unknown>
		const id = typeof row['id'] === 'string' ? row['id'] : null
		const newSlug = typeof row['slug'] === 'string' ? row['slug'] : slug
		if (id !== null) {
			await verifyCompany({
				params: { id },
				payload: { verified: true },
			} as never)
		}
		toast.add({ title: t`Added as a verified lead`, type: 'success' })
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
