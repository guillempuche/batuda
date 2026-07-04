import { Effect } from 'effect'
import { HttpServerResponse } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { BatudaApi, NotFound } from '@batuda/controllers'

import { CompanyService } from '../services/companies'
import {
	geocodeCompany,
	updateCompanyRegeocoding,
} from '../services/company-geocoding'
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
					updateCompanyRegeocoding(_.params.id, _.payload).pipe(
						Effect.provideService(CompanyService, svc),
						Effect.provideService(Geocoder, geocoder),
						Effect.tap(() =>
							Effect.logInfo('Company updated').pipe(
								Effect.annotateLogs({
									event: 'company.updated',
									companyId: _.params.id,
								}),
							),
						),
						Effect.orDie,
					),
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
		}),
)
