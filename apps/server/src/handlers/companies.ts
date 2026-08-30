import { DateTime, Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { SqlClient } from 'effect/unstable/sql'

import { BatudaApi, NotFound, SessionContext } from '@batuda/controllers'

import { channelsJsonFor, clearEmailSuppression } from '../services/channels'
import { CompanyService } from '../services/companies'
import {
	geocodeCompany,
	updateCompanyRegeocoding,
} from '../services/company-geocoding'
import { recordStageChange } from '../services/company-stage-change'
import { Geocoder } from '../services/geocoder'
import {
	CompanyDeleted,
	CompanyRestored,
	TimelineActivityService,
} from '../services/timeline-activity'

export const CompaniesLive = HttpApiBuilder.group(
	BatudaApi,
	'companies',
	handlers =>
		Effect.gen(function* () {
			const svc = yield* CompanyService
			const geocoder = yield* Geocoder
			const timeline = yield* TimelineActivityService
			const sql = yield* SqlClient.SqlClient
			return handlers
				.handle('list', _ => svc.search(_.query).pipe(Effect.orDie))
				.handle('facets', _ => svc.facets(_.query).pipe(Effect.orDie))
				.handle('get', _ =>
					svc.getWithRelations(_.params.slug).pipe(
						// Keep NotFound (mapped to 404 by the route's declared error
						// schema); die on infrastructure faults (SqlError, decode).
						Effect.catch(e =>
							e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
				.handle('create', _ =>
					svc.create(_.payload).pipe(
						Effect.flatMap(r =>
							r[0] === undefined
								? Effect.die(new Error('company insert returned no row'))
								: Effect.succeed(r[0]),
						),
						Effect.tap(c =>
							Effect.logInfo('Company created').pipe(
								Effect.annotateLogs({
									event: 'company.created',
									slug: c.slug,
								}),
							),
						),
						Effect.orDie,
					),
				)
				.handle('update', _ =>
					Effect.gen(function* () {
						// Capture the stage before the write so a change can be recorded
						// with its from→to. Only read it when the update touches status.
						const before =
							_.payload.status === undefined
								? null
								: yield* svc.findById(_.params.id).pipe(
										Effect.map(row =>
											typeof row['status'] === 'string' ? row['status'] : null,
										),
										Effect.catch(() => Effect.succeed(null)),
									)
						const result = yield* updateCompanyRegeocoding(
							_.params.id,
							_.payload,
						).pipe(
							Effect.provideService(CompanyService, svc),
							Effect.provideService(Geocoder, geocoder),
							// A company that is gone, or was taken out of view, is not an
							// edit that failed — it is one there was nothing to make.
							Effect.catchTag('NotFound', () => Effect.succeed(null)),
						)
						// Nothing happened, so nothing is written on the account's history
						// and nothing is claimed to the caller.
						if (result === null) return null
						yield* Effect.logInfo('Company updated').pipe(
							Effect.annotateLogs({
								event: 'company.updated',
								companyId: _.params.id,
							}),
						)
						const session = yield* SessionContext
						yield* recordStageChange({
							companyId: _.params.id,
							from: before,
							to: _.payload.status,
							actorUserId: session.userId,
						})
						return result
					}).pipe(Effect.orDie),
				)
				.handle('geocode', _ =>
					geocodeCompany(_.params.id).pipe(
						Effect.provideService(CompanyService, svc),
						Effect.provideService(Geocoder, geocoder),
						// A resolvable location returns the row. No match, or nothing to
						// search on, is the 404 the Where panel renders as "no match". A
						// geocoder that could not be reached is a server fault, kept apart
						// from "no match" so it surfaces as a 500, not a 404.
						Effect.flatMap(result => {
							switch (result._tag) {
								case 'geocoded':
									return Effect.logInfo('Company geocoded').pipe(
										Effect.annotateLogs({
											event: 'company.geocoded',
											companyId: _.params.id,
										}),
										Effect.as(result.company),
									)
								case 'lookup_failed':
									return Effect.die(
										new Error(
											`geocoder unreachable for company ${_.params.id}`,
										),
									)
								default:
									return Effect.fail(
										new NotFound({ entity: 'geocode-miss', id: _.params.id }),
									)
							}
						}),
						Effect.catch(e =>
							e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
				.handle('verify', _ =>
					Effect.gen(function* () {
						const session = yield* SessionContext
						// Stamp who confirmed the lead and when, or clear both.
						const rows = yield* svc.update(_.params.id, {
							verifiedAt: _.payload.verified
								? DateTime.toDateUtc(DateTime.nowUnsafe())
								: null,
							verifiedBy: _.payload.verified ? session.userId : null,
						})
						const row = rows[0]
						if (row === undefined)
							return yield* new NotFound({
								entity: 'company',
								id: _.params.id,
							})
						yield* Effect.logInfo('Company verification changed').pipe(
							Effect.annotateLogs({
								event: 'company.verified',
								companyId: _.params.id,
								verified: _.payload.verified,
							}),
						)
						return row
					}).pipe(
						Effect.catch(e =>
							e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
				.handle('delete', _ =>
					Effect.gen(function* () {
						const session = yield* SessionContext
						const result = yield* svc.softDelete(_.params.id)
						if (result.alreadyDeleted)
							return { contactsAffected: 0, alreadyDeleted: true }
						yield* timeline.record(
							new CompanyDeleted({
								companyId: _.params.id,
								contactsAffected: result.contactsAffected,
								actorUserId: session.userId,
								occurredAt: result.at,
							}),
						)
						yield* Effect.logInfo('Company deleted').pipe(
							Effect.annotateLogs({
								event: 'company.deleted',
								companyId: _.params.id,
								contactsAffected: result.contactsAffected,
							}),
						)
						return {
							contactsAffected: result.contactsAffected,
							alreadyDeleted: false,
						}
					}).pipe(
						Effect.catch(e =>
							e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
				.handle('restore', _ =>
					Effect.gen(function* () {
						const session = yield* SessionContext
						const result = yield* svc.restore(_.params.id)
						yield* timeline.record(
							new CompanyRestored({
								companyId: _.params.id,
								contactsAffected: result.contactsAffected,
								actorUserId: session.userId,
								occurredAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
							}),
						)
						yield* Effect.logInfo('Company restored').pipe(
							Effect.annotateLogs({
								event: 'company.restored',
								companyId: _.params.id,
								contactsAffected: result.contactsAffected,
							}),
						)
						return { contactsAffected: result.contactsAffected }
					}).pipe(
						// A name already taken is the caller's to resolve, so it keeps
						// its own answer rather than becoming a server fault.
						Effect.catch(e =>
							e._tag === 'NotFound' || e._tag === 'BadRequest'
								? Effect.fail(e)
								: Effect.die(e),
						),
					),
				)
				.handle('clearSuppression', _ =>
					Effect.gen(function* () {
						yield* clearEmailSuppression(sql, {
							table: 'companies' as const,
							id: _.params.id,
						})

						// Built into JSON by Postgres, like every other channel answer:
						// reading the rows straight back brings their dates along, and a
						// date is not something this answer knows how to write out.
						const rows = yield* sql<{
							readonly channels: ReadonlyArray<unknown>
						}>`
							SELECT ${channelsJsonFor(sql, 'companies')} AS channels
							FROM companies c
							WHERE c.id = ${_.params.id}::uuid
						`

						yield* Effect.logInfo('Company suppression cleared').pipe(
							Effect.annotateLogs({
								event: 'company.suppression_cleared',
								companyId: _.params.id,
							}),
						)
						return { id: _.params.id, channels: rows[0]?.channels ?? [] }
					}).pipe(Effect.orDie),
				)
		}),
)
