import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { NodeServices } from '@effect/platform-node'
import * as PgMigrator from '@effect/sql-pg/PgMigrator'
import { Layer } from 'effect'
import { Migrator } from 'effect/unstable/sql'

import { PgLive } from './client'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export const MigratorLive = PgMigrator.layer({
	loader: Migrator.fromFileSystem(path.join(dirname, 'migrations')),
}).pipe(Layer.provide(PgLive), Layer.provide(NodeServices.layer))
