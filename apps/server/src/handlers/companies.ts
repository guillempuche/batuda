import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { ForjaApi } from '../api'
import { CompanyService } from '../services/companies'

export const CompaniesLive = HttpApiBuilder.group(
	ForjaApi,
	'companies',
	handlers =>
		Effect.gen(function* () {
			const svc = yield* CompanyService
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
		}),
)
