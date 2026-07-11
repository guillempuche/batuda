import { DateTime, Effect } from 'effect'
import { HttpServerResponse } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { BatudaApi, NotFound, SessionContext } from '@batuda/controllers'

import { CompanyService } from '../services/companies'
import {
	geocodeCompany,
	updateCompanyRegeocoding,
} from '../services/company-geocoding'
import { recordStageChange } from '../services/company-stage-change'
import { Geocoder } from '../services/geocoder'

export const CompaniesLive = HttpApiBuilder.group(
	BatudaApi,
	'companies',
	handlers =>
		Effect.gen(function* () {
			const svc = yield* CompanyService
			const geocoder = yield* Geocoder
			return handlers
				.handle('list', _ => svc.search(_.query).pipe(Effect.orDie))
				.handle('get', _ =>
					svc.getWithRelations(_.params.slug).pipe(
						// Effect.fail(NotFound) is supposed to be picked up by the
						// route's declared error schema and serialised as 404, but
						// the v4 Schema.TaggedErrorClass instance doesn't round-
						// trip through HttpApi's response encoder cleanly (the
						// orDie at HttpApiBuilder.ts:606 runs because the encoder
						// rejects the value). Build the HttpServerResponse by
						// hand for NotFound; everything else dies as a defect.
						Effect.catchTag('NotFound', e =>
							Effect.succeed(
								HttpServerResponse.jsonUnsafe(
									{ _tag: 'NotFound', entity: e.entity, id: e.id },
									{ status: 404 },
								),
							),
						),
						Effect.orDie,
					),
				)
				.handle('create', _ =>
					svc.create(_.payload).pipe(
						Effect.tap(r =>
							Effect.logInfo('Company created').pipe(
								Effect.annotateLogs({
									event: 'company.created',
									slug: r[0]?.['slug'],
								}),
							),
						),
						Effect.map(r => r[0]),
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
						)
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
						// The helper returns null when there's no address to search on or
						// the geocoder found no match; the endpoint reports both as a
						// 404 the Where panel renders as "no match".
						Effect.flatMap(row =>
							row === null
								? Effect.fail(
										new NotFound({ entity: 'geocode-miss', id: _.params.id }),
									)
								: Effect.logInfo('Company geocoded').pipe(
										Effect.annotateLogs({
											event: 'company.geocoded',
											companyId: _.params.id,
										}),
										Effect.as(row),
									),
						),
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
						const row = (rows as ReadonlyArray<unknown>)[0]
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
		}),
)
