import { Cause, Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import type { CurrentOrg } from '@batuda/domain'

import { recordStageChange } from './company-stage-change'
import { LeadAssigned, TimelineActivityService } from './timeline-activity'

// Who a sent email is attributed to. Agents are carried so the history can say
// one of them wrote it, but they never become owners: a lead belongs to
// somebody who can be asked about it.
export interface EmailActor {
	readonly userId: string
	readonly isAgent: boolean
}

// Emailing a company nobody has picked up makes it yours, and moves it out of
// the untouched column.
//
// Two conditions, checked separately because they answer different questions:
// `owner_id IS NULL` is "nobody has claimed this", `status = 'prospect'` is
// "nobody has worked this". A lead can be either without being both, and each
// step should happen on its own terms.
//
// Deliberately NOT "has this company been emailed before". That cannot be
// answered: a mailbox connected with years of history has its Sent folder read
// in as inbound (apps/mail-worker stores every message it fetches that way), so
// the stored mail cannot say which side sent what. Asking whether anybody has
// taken the lead is both answerable and the thing actually worth knowing.
//
// Each write is one conditional UPDATE, so two people emailing the same company
// at once cannot both win it — the second one matches no row and does nothing.
// No SELECT first, and no row lock: the whole request runs in one transaction
// (see enterOrgScope), so a lock taken here would be held until the response,
// and a FOR UPDATE would block the mail worker's inbound writes for the same
// company.
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
		if (!actor || actor.isAgent) return

		const sql = yield* SqlClient.SqlClient
		const timeline = yield* TimelineActivityService

		// Its own transaction, which nesting turns into a savepoint. By the time
		// this runs the message has already left over SMTP, so a failure here has
		// to roll back only this much — take the surrounding one down and there is
		// no record of a message the recipient already has, and somebody sends it
		// again.
		yield* sql.withTransaction(
			Effect.gen(function* () {
				// Bump `version` on both writes: it is the token a research
				// proposal is checked against, so leaving it alone would let a
				// proposal prepared before this send quietly put the old owner
				// and stage back.
				const claimed = yield* sql<{ id: string }>`
					UPDATE companies SET
						owner_id = ${actor.userId},
						version = version + 1,
						updated_at = now()
					WHERE id = ${params.companyId} AND owner_id IS NULL
					RETURNING id`

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

				const advanced = yield* sql<{ id: string }>`
					UPDATE companies SET
						status = 'contacted',
						version = version + 1,
						updated_at = now()
					WHERE id = ${params.companyId} AND status = 'prospect'
					RETURNING id`

				if (advanced.length > 0) {
					yield* recordStageChange({
						companyId: params.companyId,
						from: 'prospect',
						to: 'contacted',
						actorUserId: actor.userId,
						occurredAt: new Date(params.sentAt.getTime() + 2),
					})
				}
			}),
		)
	}).pipe(
		Effect.catchCause(cause =>
			Effect.logWarning('Lead claim after send failed').pipe(
				Effect.annotateLogs({
					event: 'company.lead_claim_failed',
					companyId: params.companyId,
					cause: Cause.pretty(cause),
				}),
			),
		),
	)
