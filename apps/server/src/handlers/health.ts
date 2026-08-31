import { Clock, Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { BatudaApi } from '@batuda/controllers'
import { buildMeta, exportHealth, exportReport } from '@batuda/observability'

export const HealthLive = HttpApiBuilder.group(BatudaApi, 'health', handlers =>
	Effect.succeed(
		handlers.handle('check', () =>
			Effect.map(Clock.currentTimeMillis, now => ({
				status: 'ok',
				version: buildMeta.version,
				commit: buildMeta.commitShort,
				region: buildMeta.region,
				// Answers "is this instance still reaching Honeycomb?" without
				// needing the instance console, which only hands back its tail.
				telemetry: exportReport(exportHealth, now),
			})),
		),
	),
)
