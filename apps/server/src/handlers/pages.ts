import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { ForjaApi } from '@engranatge/controllers'

import { PageService } from '../services/pages'

export const PagesLive = HttpApiBuilder.group(ForjaApi, 'pages', handlers =>
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
				svc.incrementView(_.params.slug, _.query.lang ?? 'ca').pipe(
					Effect.tap(() =>
						Effect.logInfo('Page viewed').pipe(
							Effect.annotateLogs({
								event: 'page.viewed',
								slug: _.params.slug,
								lang: _.query.lang ?? 'ca',
							}),
						),
					),
					Effect.asVoid,
					Effect.orDie,
				),
			)
			.handle('list', _ => svc.list(_.query).pipe(Effect.orDie))
			.handle('create', _ =>
				svc.create(_.payload as any).pipe(
					Effect.tap(r =>
						Effect.logInfo('Page created').pipe(
							Effect.annotateLogs({
								event: 'page.created',
								slug: (r as any)[0]?.slug,
								lang: (r as any)[0]?.lang,
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
						Effect.logInfo('Page updated').pipe(
							Effect.annotateLogs({
								event: 'page.updated',
								pageId: _.params.id,
							}),
						),
					),
					Effect.map(r => r[0]),
					Effect.orDie,
				),
			)
			.handle('publish', _ =>
				svc.publish(_.params.id).pipe(
					Effect.tap(() =>
						Effect.logInfo('Page published').pipe(
							Effect.annotateLogs({
								event: 'page.published',
								pageId: _.params.id,
							}),
						),
					),
					Effect.map(r => r[0]),
					Effect.orDie,
				),
			)
	}),
)
