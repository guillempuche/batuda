import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { BatudaApi, CurrentOrg, SessionContext } from '@batuda/controllers'

import { MemberService } from '../services/members'

// Adding someone to the active organization. Which organization that is comes
// from `OrgMiddleware`, never from the request body, and `MemberService`
// checks the caller's role in it before writing anything.
export const MembersLive = HttpApiBuilder.group(
	BatudaApi,
	'members',
	handlers =>
		Effect.gen(function* () {
			const members = yield* MemberService
			return handlers.handle('add', _ =>
				Effect.gen(function* () {
					const org = yield* CurrentOrg
					const { userId } = yield* SessionContext
					const added = yield* members.add(org.id, userId, {
						email: _.payload.email.trim().toLowerCase(),
						role: _.payload.role,
						locale: _.payload.locale,
					})
					// Audit without the address — who did it and to which membership is
					// enough to reconstruct the event.
					yield* Effect.logInfo('Member added').pipe(
						Effect.annotateLogs({
							event: 'member.added',
							orgId: org.id,
							actorUserId: userId,
							memberId: added.id,
							memberUserId: added.userId,
							role: added.role,
						}),
					)
					return added
				}),
			)
		}),
)
