import { DateTime, Effect } from 'effect'
import { HttpServerResponse } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { BatudaApi, NotFound } from '@batuda/controllers'

import { CompanyService } from '../services/companies'
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
					svc.create(_.payload as any).pipe(
						Effect.tap(r =>
							Effect.logInfo('Company created').pipe(
								Effect.annotateLogs({
									event: 'company.created',
									slug: (r as any)[0]?.slug,
								}),
							),
						),
						Effect.map(r => r[0]),
						Effect.orDie,
					),
				)
				.handle('update', _ =>
					svc.update(_.params.id, _.payload as any).pipe(
						Effect.tap(() =>
							Effect.logInfo('Company updated').pipe(
								Effect.annotateLogs({
									event: 'company.updated',
									companyId: _.params.id,
								}),
							),
						),
						Effect.map(r => r[0]),
						Effect.orDie,
					),
				)
				.handle('geocode', _ =>
					Effect.gen(function* () {
						const company = yield* svc.findById(_.params.id)
						const name = company['name'] as string | null
						const location = company['location'] as string | null
						const query = [name, location].filter(Boolean).join(', ')
						if (!query) {
							return yield* new NotFound({
								entity: 'geocode-query',
								id: _.params.id,
							})
						}
						const hit = yield* geocoder.lookup(query)
						if (!hit) {
							return yield* new NotFound({
								entity: 'geocode-miss',
								id: _.params.id,
							})
						}
						const rows = yield* svc.update(_.params.id, {
							latitude: hit.latitude,
							longitude: hit.longitude,
							geocodedAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
							geocodeSource: hit.source,
						})
						yield* Effect.logInfo('Company geocoded').pipe(
							Effect.annotateLogs({
								event: 'company.geocoded',
								companyId: _.params.id,
								source: hit.source,
							}),
						)
						return rows[0]
					}).pipe(
						Effect.catch(e =>
							e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
		}),
)
