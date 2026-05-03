import { Trans } from '@lingui/react/macro'
import styled from 'styled-components'

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
 * Renders a `contact-discovery-v1` research finding. Each contact
 * carries role + email + phone + linkedin + an optional decision-maker
 * flag + free-form notes.
 */

type ContactEntry = {
	readonly name: string
	readonly role?: string
	readonly email?: string
	readonly phone?: string
	readonly linkedin?: string
	readonly is_decision_maker?: boolean
	readonly notes?: string
	readonly citations?: ReadonlyArray<Citation>
}

type ContactDiscoveryFindings = CommonFindings & {
	readonly contacts?: ReadonlyArray<ContactEntry>
}

export function ContactDiscoveryView({
	findings,
}: {
	readonly findings: ContactDiscoveryFindings | null | undefined
}) {
	const contacts = findings?.contacts ?? []

	return (
		<Sections>
			{contacts.length > 0 ? (
				<Section data-testid='research-contacts'>
					<SectionTitle>
						<Trans>Contacts found</Trans>
					</SectionTitle>
					<List>
						{contacts.map(c => (
							<ListItem key={`${c.name}|${c.email ?? c.linkedin ?? ''}`}>
								<RowHead>
									<Pill>{c.name}</Pill>
									{c.role !== undefined ? <Reason>{c.role}</Reason> : null}
									{c.is_decision_maker === true ? (
										<DecisionMakerBadge>
											<Trans>Decision maker</Trans>
										</DecisionMakerBadge>
									) : null}
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
									{c.linkedin !== undefined ? (
										<FieldRow>
											<FieldKey>
												<Trans>LinkedIn</Trans>
											</FieldKey>
											<FieldValue>
												<a href={c.linkedin} target='_blank' rel='noreferrer'>
													{c.linkedin}
												</a>
											</FieldValue>
										</FieldRow>
									) : null}
								</FieldsTable>
								{c.notes !== undefined ? <Reason>{c.notes}</Reason> : null}
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

const DecisionMakerBadge = styled.span`
	font-family: var(--font-display);
	font-size: var(--typescale-label-small-size);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	background: color-mix(in oklab, var(--color-primary) 60%, white);
	color: var(--color-on-primary);
	padding: var(--space-3xs) var(--space-2xs);
	border-radius: var(--shape-3xs);
`
