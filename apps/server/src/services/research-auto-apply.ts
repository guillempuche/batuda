import { Effect } from 'effect'
import type { SqlClient } from 'effect/unstable/sql'

import {
	AUTO_APPLY_CONFIDENCE_FLOOR,
	queryPendingProposals,
} from '@batuda/research'

/**
 * Which of a finished run's suggestions may be written onto a record with
 * nobody looking at them.
 *
 * This is the only thing between a research run and a customer's own records,
 * so it sits on its own rather than inline where it is called: a rule a test can
 * only imitate is a rule nothing actually checks, and every condition here is
 * one somebody could drop without noticing.
 *
 * Four things must all hold. The organisation has to have asked for this at all.
 * The run has to have finished sure of which company it was about — one that
 * needs reading keeps everything waiting, however good a single suggestion
 * looks, because what is in doubt is who the values belong to. The value has to
 * be one a machine can check, which in practice means a way of reaching someone
 * rather than a judgement like an industry. And that address has to have come
 * back as reachable. On top of the organisation's own bar there is a floor it
 * cannot go under, so a value nobody is sure of always waits for a person.
 */
export const proposalsToAutoApply = (
	sql: SqlClient.SqlClient,
	input: {
		readonly researchId: string
		/** The run's status as stored, not as announced when it ended. */
		readonly runStatus: string
		/** The organisation's own bar, out of a hundred; null means never. */
		readonly autoApplyMinConfidence: number | null
	},
) =>
	Effect.gen(function* () {
		if (input.runStatus !== 'succeeded') return []
		if (input.autoApplyMinConfidence === null) return []
		const eligible = yield* queryPendingProposals(sql, {
			researchId: input.researchId,
			machineCheckable: true,
			// The floor is a fraction between zero and one while these confidences
			// are scored out of a hundred, so it is scaled to match. Unscaled it sits
			// below everything it is meant to stop.
			minConfidence: Math.max(
				input.autoApplyMinConfidence,
				AUTO_APPLY_CONFIDENCE_FLOOR * 100,
			),
		})
		return eligible.items
			.filter(
				(
					proposal,
				): proposal is typeof proposal & { proposedUpdateId: string } =>
					proposal.verification === 'deliverable' &&
					proposal.proposedUpdateId !== null,
			)
			.map(proposal => proposal.proposedUpdateId)
	})
