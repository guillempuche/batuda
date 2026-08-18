import { Layer } from 'effect'

import { ParticipantMatcher } from '@batuda/email/participant-matcher'

import { PgLive } from '../db.js'
import { CredentialDecryptor } from '../decrypt.js'
import { WorkerEnvVars } from '../env.js'
import { OtlpObservability } from '../observability.js'
import { RawMessageStorage } from '../storage.js'
import { ConfigFileLive } from './config-provider.js'

/**
 * Everything the worker loop runs on.
 *
 * Separate from the start-up file so a test can build it without starting the
 * worker: the telemetry line below is easy to get wrong in a way that shows up
 * only as silence.
 */
export const Live = Layer.mergeAll(
	CredentialDecryptor.layer,
	RawMessageStorage.layer,
	ParticipantMatcher.layer,
).pipe(
	// ParticipantMatcher reads contacts/companies via SqlClient, so PgLive must
	// be PROVIDED to the merged layers — `mergeAll` alongside it leaves that
	// requirement unsatisfied. provideMerge also hands SqlClient back out, for
	// the inbox claim and session queries the worker loop runs.
	Layer.provideMerge(PgLive),
	Layer.provideMerge(WorkerEnvVars.layer),
	// Merged, not only provided: the exporter installs itself by putting a logger
	// and a tracer into what this layer HANDS BACK, which is what the worker loop
	// runs on. Provided alone it would reach the layers built here and nothing
	// else — a worker that boots, says sending is on, and sends nothing. Sits
	// above ConfigFileLive so the export settings are readable by the time it is
	// built.
	Layer.provideMerge(OtlpObservability),
	// Install the baked-file config values before the readers above resolve, so
	// the env-var layer and the database client can read non-secret settings
	// that no longer travel on the boot command line.
	Layer.provide(ConfigFileLive),
)
