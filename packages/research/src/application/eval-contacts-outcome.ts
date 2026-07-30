/**
 * Adapts a finished discover_contacts run — its terminal status and ranked
 * contacts — plus the paid spend metered to it into the normalized
 * ContactRunOutcome the scorer reads.
 *
 * This is the ONE place that knows the DiscoveredContact shape (name, role,
 * decision-maker flag, and the ranked email channel). The spend is passed in —
 * the CLI driver queries it from research_paid_spend — so scoring stays pure and
 * I/O-free, the same seam the research eval keeps between outcome and scoring.
 */

import { decidesPurchase } from '@batuda/domain'

import { type DiscoverContactsOutcome, emailChannel } from './contact-discovery'
import type {
	ContactRunOutcome,
	ContactTerminalStatus,
	OutcomeContact,
} from './eval-contacts-scoring'

export const outcomeFromContactRun = (
	outcome: DiscoverContactsOutcome,
	meta: { readonly spendCents: number },
): ContactRunOutcome => {
	const contacts: OutcomeContact[] =
		outcome.status === 'ok'
			? outcome.contacts.map(contact => {
					const channel = emailChannel(contact)
					return {
						name: contact.name,
						role: contact.role,
						isDecisionMaker: decidesPurchase(contact.buying_role),
						email:
							channel !== undefined
								? {
										value: channel.value,
										// The pipeline only asserts an address it could verify;
										// "deliverable" is the strict verdict the false-positive
										// measure counts against.
										deliverable: channel.verification === 'deliverable',
									}
								: undefined,
					}
				})
			: []

	// An approval-gated run delivered no contacts because a paid step hit the
	// spend limit — the same "spend-stopped, empty" bucket as budget_exceeded for
	// the purpose of scoring contact quality.
	const status: ContactTerminalStatus =
		outcome.status === 'approval_required' ? 'budget_exceeded' : outcome.status
	return { status, contacts, spendCents: meta.spendCents }
}
