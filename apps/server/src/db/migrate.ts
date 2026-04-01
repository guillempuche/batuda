import { NodeRuntime } from '@effect/platform-node'
import { Effect } from 'effect'

import { MigratorLive } from './migrator'

const program = Effect.log('Running migrations...').pipe(
	Effect.provide(MigratorLive),
	Effect.tap(() => Effect.log('Migrations complete')),
)

NodeRuntime.runMain(program)
