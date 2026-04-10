import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { ForjaApi } from '@engranatge/controllers'

import { buildMeta } from '../lib/build-meta'

export const HealthLive = HttpApiBuilder.group(ForjaApi, 'health', handlers =>
	Effect.succeed(
		handlers.handle('check', () =>
			Effect.succeed({
				status: 'ok',
				version: buildMeta.version,
				commit: buildMeta.commitShort,
				region: buildMeta.region,
			}),
		),
	),
)
