import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { BatudaApi } from '../api'
import { CompanyService } from '../services/companies'

export const CompaniesLive = HttpApiBuilder.group(
	BatudaApi,
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
						Effect.map(r => r[0]),
						Effect.orDie,
					),
				)
				.handle('update', _ =>
					svc.update(_.params.id, _.payload as any).pipe(
						Effect.map(r => r[0]),
						Effect.orDie,
					),
				)
		}),
)
