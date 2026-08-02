import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { SqlClient } from 'effect/unstable/sql'

import { BatudaApi, CurrentOrg } from '@batuda/controllers'

import {
	listIndustries,
	mergeIndustries,
	removeIndustryIfUnused,
	renameIndustry,
	setIndustryReviewed,
} from '../services/company-industries'

/**
 * Curating the organisation's own list of trades: read it, correct a name,
 * accept one research proposed, fold two into one, drop one nothing uses.
 *
 * Every op is scoped to the active org by `OrgMiddleware`, so a trade belonging
 * to somebody else reads as missing rather than as forbidden.
 */
export const CompanyIndustriesLive = HttpApiBuilder.group(
	BatudaApi,
	'companyIndustries',
	handlers =>
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient

			// The two refusals the routes declare are the ones a caller can act on: a
			// trade that is not there, and a change the list will not take. Anything
			// else is the database failing, which no caller can do anything with.
			const isAnswerable = <E extends { readonly _tag: string }>(
				e: E,
			): e is Extract<E, { readonly _tag: 'NotFound' | 'Conflict' }> =>
				e._tag === 'NotFound' || e._tag === 'Conflict'

			const answerable = <A, E extends { readonly _tag: string }, R>(
				effect: Effect.Effect<A, E, R>,
			) =>
				effect.pipe(
					Effect.catch(e => (isAnswerable(e) ? Effect.fail(e) : Effect.die(e))),
				)

			return handlers
				.handle('list', _ =>
					Effect.gen(function* () {
						const org = yield* CurrentOrg
						return yield* listIndustries(sql, org.id)
					}).pipe(Effect.orDie),
				)
				.handle('rename', _ =>
					Effect.gen(function* () {
						const org = yield* CurrentOrg
						yield* renameIndustry(sql, org.id, _.params.id, _.payload.label)
					}).pipe(answerable),
				)
				.handle('review', _ =>
					Effect.gen(function* () {
						const org = yield* CurrentOrg
						yield* setIndustryReviewed(sql, org.id, _.params.id)
					}).pipe(answerable),
				)
				.handle('merge', _ =>
					Effect.gen(function* () {
						const org = yield* CurrentOrg
						const { moved } = yield* mergeIndustries(
							sql,
							org.id,
							_.params.id,
							_.payload.intoId,
						)
						yield* Effect.logInfo('Trades merged').pipe(
							Effect.annotateLogs({
								event: 'company_industry.merged',
								orgId: org.id,
								fromId: _.params.id,
								intoId: _.payload.intoId,
								moved,
							}),
						)
						return { moved }
					}).pipe(answerable),
				)
				.handle('delete', _ =>
					Effect.gen(function* () {
						const org = yield* CurrentOrg
						yield* removeIndustryIfUnused(sql, org.id, _.params.id)
					}).pipe(answerable),
				)
		}),
)
