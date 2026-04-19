import { DateTime, Effect } from 'effect'
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
					svc
						.getWithRelations(_.params.slug)
						.pipe(
							Effect.catch(e =>
								e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
							),
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
