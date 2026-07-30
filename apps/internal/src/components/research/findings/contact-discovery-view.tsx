import { Trans } from '@lingui/react/macro'
import styled from 'styled-components'

import { decidesPurchase } from '@batuda/domain'

import { displayValue } from '#/components/research/field-diff'
import { SafeLink } from '#/components/research/safe-link'
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
 * Renders a `contact_discovery_v1` research finding. Each contact
 * carries role + email + phone + linkedin + an optional decision-maker
 * flag + free-form notes.
 */

type ContactEntry = {
	readonly name: string
	readonly role?: string
	readonly email?: string
	readonly phone?: string
	readonly linkedin?: string
	readonly buying_role?: string | null
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
						{contacts.map(c => {
							// A value can arrive on its own or wrapped together with the page
							// it was read from. Rendering the wrapper puts an object where
							// text belongs, which takes the whole page down, so every value
							// is read out before it is shown.
							const name = displayValue(c.name) ?? ''
							const role = displayValue(c.role)
							const email = displayValue(c.email)
							const phone = displayValue(c.phone)
							const linkedin = displayValue(c.linkedin)
							const notes = displayValue(c.notes)
							return (
								<ListItem key={`${name}|${email ?? linkedin ?? ''}`}>
									<RowHead>
										<Pill>{name}</Pill>
										{role !== null ? <Reason>{role}</Reason> : null}
										{decidesPurchase(c.buying_role) ? (
											<DecisionMakerBadge>
												<Trans>Decision maker</Trans>
											</DecisionMakerBadge>
										) : null}
									</RowHead>
									<FieldsTable>
										{email !== null ? (
											<FieldRow>
												<FieldKey>
													<Trans>Email</Trans>
												</FieldKey>
												<FieldValue>
													<SafeLink href={`mailto:${email}`}>{email}</SafeLink>
												</FieldValue>
											</FieldRow>
										) : null}
										{phone !== null ? (
											<FieldRow>
												<FieldKey>
													<Trans>Phone</Trans>
												</FieldKey>
												<FieldValue>{phone}</FieldValue>
											</FieldRow>
										) : null}
										{linkedin !== null ? (
											<FieldRow>
												<FieldKey>
													<Trans>LinkedIn</Trans>
												</FieldKey>
												<FieldValue>
													<SafeLink href={linkedin}>{linkedin}</SafeLink>
												</FieldValue>
											</FieldRow>
										) : null}
									</FieldsTable>
									{notes !== null ? <Reason>{notes}</Reason> : null}
									<CitationList citations={c.citations} />
								</ListItem>
							)
						})}
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
	/* Container tokens rather than a mix toward white: in a dark theme the accent
	   is already pale, so lightening it further left the text on top unreadable. */
	background: var(--color-primary-container);
	color: var(--color-on-primary-container);
	padding: var(--space-3xs) var(--space-2xs);
	border-radius: var(--shape-3xs);
`
