import { DateTime, Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { BatudaApi, NotFound, SessionContext } from '@batuda/controllers'

import { CompanyService } from '../services/companies'
import { withBriefOwnership } from '../services/company-brief'
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
						const actor = yield* SessionContext
						// A person editing the notes takes ownership of them: this marker is what
						// later research reads to decide whether to add to the notes or replace
						// them. An agent's edit deliberately leaves the marker alone, so an agent
						// can never make its own writing look like a person's.
						const payload = withBriefOwnership(_.payload, actor)
						const result = yield* updateCompanyRegeocoding(
							_.params.id,
							payload,
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
		}),
)
