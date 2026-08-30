import { DateTime, Effect } from 'effect'

import type { CurrentOrg } from '@batuda/controllers'
import { StageChanged, TimelineActivityService } from '@batuda/timeline'

// Record a pipeline stage transition on the company's timeline, but only when
// the status actually changed. `from` is the status captured before the write;
// `to` is the incoming status (undefined when the update didn't touch it).
// `actorUserId` is the person who made the change, or null for agent-driven ones.
// Kept free of SessionContext so both the HTTP handler and the MCP tool can call it.
//
// `occurredAt` is for a caller that changed the stage as a consequence of
// something else: it passes the moment it wants the history to show, so its
// entries stay in the order they happened. Everyone else lets it default to now.
export const recordStageChange = (params: {
	readonly companyId: string
	readonly from: string | null
	readonly to: string | undefined
	readonly actorUserId: string | null
	readonly occurredAt?: Date | undefined
}): Effect.Effect<void, never, TimelineActivityService | CurrentOrg> =>
	Effect.gen(function* () {
		if (params.to === undefined || params.to === params.from) return
		const timeline = yield* TimelineActivityService
		yield* timeline.record(
			new StageChanged({
				companyId: params.companyId,
				from: params.from,
				to: params.to,
				actorUserId: params.actorUserId,
				occurredAt:
					params.occurredAt ?? DateTime.toDateUtc(DateTime.nowUnsafe()),
			}),
		)
	})
