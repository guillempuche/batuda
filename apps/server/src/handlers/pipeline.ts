import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { BatudaApi } from '@batuda/controllers'

import { PipelineService } from '../services/pipeline'

export const PipelineLive = HttpApiBuilder.group(
	BatudaApi,
	'pipeline',
	handlers =>
		Effect.gen(function* () {
			const svc = yield* PipelineService
			return handlers
				.handle('get', () => svc.getPipeline().pipe(Effect.orDie))
				.handle('nextSteps', _ =>
					svc.getNextSteps(_.query.limit).pipe(Effect.orDie),
				)
		}),
)
