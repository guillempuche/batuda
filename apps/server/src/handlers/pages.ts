import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { BatudaApi } from '../api'
import { PageService } from '../services/pages'

export const PagesLive = HttpApiBuilder.group(BatudaApi, 'pages', handlers =>
	Effect.gen(function* () {
		const svc = yield* PageService
		return handlers
			.handle('getPublic', _ =>
				svc
					.getBySlugAndLang(_.params.slug, _.query.lang ?? 'ca')
					.pipe(
						Effect.catch(e =>
							e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
						),
					),
			)
			.handle('view', _ =>
				svc
					.incrementView(_.params.slug, _.query.lang ?? 'ca')
					.pipe(Effect.asVoid, Effect.orDie),
			)
			.handle('list', _ => svc.list(_.query).pipe(Effect.orDie))
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
			.handle('publish', _ =>
				svc.publish(_.params.id).pipe(
					Effect.map(r => r[0]),
					Effect.orDie,
				),
			)
	}),
)
