import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import type { CurrentOrg } from '@batuda/domain'
import { boundedCause, recordFacts } from '@batuda/observability'
import { LeadAssigned, TimelineActivityService } from '@batuda/timeline'

import { recordStageChange } from './company-stage-change'
import { requireOrgMembers } from './org-members'

// Who a sent email is attributed to. Agents are carried so the history can say
// one of them wrote it, but they never become owners: a lead belongs to
// somebody who can be asked about it.
//
// `claimsLead` separates the two things the sender is used for. Answering an
// invitation somebody else sent still has their name on it, but it is not
// reaching out, so it names them without taking the lead.
export interface EmailActor {
	readonly userId: string
	readonly isAgent: boolean
	readonly claimsLead: boolean
}

// Emailing a company nobody has picked up makes it yours, and moves it out of
// the untouched column — to `contacted` when we wrote first, or `responded`
// when we are writing back to a company that already wrote to us.
//
// Two conditions, checked separately because they answer different questions:
// `owner_id IS NULL` is "nobody has claimed this", `status = 'prospect'` is
// "nobody has worked this". A lead can be either without being both, and each
// step should happen on its own terms.
//
// Deliberately NOT "has this company been emailed before", even though the
// stored mail could answer it. Whether somebody emailed a company two years ago
// from a mailbox that has since been connected says nothing about whether the
// lead is being worked now — an account nobody has claimed and nobody has moved
// off the first column is unworked whatever its archive holds. Asking who has
// taken it is the question with a consequence.
//
// Each write is one conditional UPDATE, so two people emailing the same company
// at once cannot both win it: the second blocks on the first one's row lock,
// then re-reads the committed row, matches nothing and does nothing. That lock
// costs nothing extra here — recording the sent email bumps the same row's
// `last_email_at` a moment earlier in this same transaction, so the request is
// already holding it.
export const claimLeadOnEmail = (params: {
	readonly companyId: string
	readonly actor: EmailActor | null
	// When the email was sent. The two entries below are stamped just after it,
	// because every history read orders on this alone and rows written together
	// are otherwise indistinguishable — the email, the claim and the stage move
	// would shuffle on each load.
	readonly sentAt: Date
}): Effect.Effect<
	void,
	never,
	SqlClient.SqlClient | TimelineActivityService | CurrentOrg
> =>
	Effect.gen(function* () {
		const { actor } = params
		if (!actor || actor.isAgent || !actor.claimsLead) return

		const sql = yield* SqlClient.SqlClient
		const timeline = yield* TimelineActivityService

		// The owner column holds a plain user id with nothing in the database
		// behind it, so this is all that stands between a session still pointing
		// at an organisation somebody has left and a lead handed to them there.
		// A stranger loses the lead, not the stage move: an email still went out,
		// whoever sent it.
		const senderWorksHere = yield* requireOrgMembers(sql, [actor.userId]).pipe(
			Effect.as(true),
			Effect.catchTag('BadRequest', () => Effect.succeed(false)),
		)

		// Its own transaction, which nesting turns into a savepoint. By the time
		// this runs the message has already left over SMTP, so a failure here has
		// to roll back only this much — take the surrounding one down and there is
		// no record of a message the recipient already has, and somebody sends it
		// again.
		yield* sql.withTransaction(
			Effect.gen(function* () {
				// A company taken out of view is not brought back by anything
				// arriving for it, so restoring one shows the account as it was
				// when it was dropped — the same rule the sent email's own date
				// bump follows.
				const claimed = senderWorksHere
					? yield* sql<{ id: string }>`
						UPDATE companies SET
							owner_id = ${actor.userId},
							updated_at = now()
						WHERE id = ${params.companyId}
							AND owner_id IS NULL
							AND deleted_at IS NULL
						RETURNING id`
					: []

				if (claimed.length > 0) {
					yield* timeline.record(
						new LeadAssigned({
							companyId: params.companyId,
							ownerUserId: actor.userId,
							actorUserId: actor.userId,
							occurredAt: new Date(params.sentAt.getTime() + 1),
						}),
					)
				}

				// Where the lead lands depends on who started it. Writing first
				// to somebody who has never answered is `contacted`; writing back
				// to a company that already wrote to us is `responded`, and the
				// difference is the strongest signal in the funnel — one is a
				// stranger, the other is a conversation. Flattening both into
				// `contacted` would lose it for good, since this only ever fires
				// while the stage is still `prospect`.
				//
				// Read from the company's own history rather than the stored
				// mail: an `email_received` entry is written only for a message
				// that arrived and matched this company, so our own copies in the
				// Sent folder cannot be mistaken for them answering.
				//
				// `version` is the token a research proposal is checked against,
				// and `status` is a field a proposal may write — so moving the
				// stage without bumping it would let one prepared beforehand put
				// the old stage back. The owner write leaves it alone: research
				// cannot write an owner, so bumping there would only invalidate
				// proposals about unrelated fields.
				const advanced = yield* sql<{ id: string; status: string }>`
					UPDATE companies SET
						status = CASE
							WHEN EXISTS (
								SELECT 1 FROM timeline_activity
								WHERE company_id = ${params.companyId}
									AND kind = 'email_received'
							)
							THEN 'responded'
							ELSE 'contacted'
						END,
						version = version + 1,
						updated_at = now()
					WHERE id = ${params.companyId}
						AND status = 'prospect'
						AND deleted_at IS NULL
					RETURNING id, status`

				const landedOn = advanced[0]?.status
				if (landedOn !== undefined) {
					yield* recordStageChange({
						companyId: params.companyId,
						from: 'prospect',
						to: landedOn,
						actorUserId: actor.userId,
						occurredAt: new Date(params.sentAt.getTime() + 2),
					})
				}

				// Nobody asked for either of these, so this is what answers why an
				// owner appeared. On the request's own record rather than a line
				// of its own, so it arrives beside what the send was doing and
				// reaches the trace with it.
				if (claimed.length > 0 || advanced.length > 0) {
					yield* recordFacts({
						'company.id': params.companyId,
						'company.lead_claimed': claimed.length > 0,
						'company.lead_owner': claimed.length > 0 ? actor.userId : null,
						'company.stage_advanced': advanced.length > 0,
					})
				}
			}),
		)
	}).pipe(
		// This one keeps a line of its own as well: the send has already answered
		// the caller, so a claim that failed unnoticed would otherwise leave
		// nothing behind. The cause is cut to a length the log exporter can
		// carry — a database one arrives holding the failing statement and the
		// values in it.
		Effect.catchCause(cause =>
			recordFacts({
				'company.id': params.companyId,
				'company.lead_claim_failed': true,
			}).pipe(
				Effect.andThen(
					Effect.logWarning('Lead claim after send failed').pipe(
						Effect.annotateLogs({
							event: 'company.lead_claim_failed',
							companyId: params.companyId,
							cause: boundedCause(cause),
						}),
					),
				),
			),
		),
	)
