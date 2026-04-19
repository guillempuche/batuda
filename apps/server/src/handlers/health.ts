import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { BatudaApi } from '@batuda/controllers'

import { buildMeta } from '../lib/build-meta'

export const HealthLive = HttpApiBuilder.group(BatudaApi, 'health', handlers =>
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
