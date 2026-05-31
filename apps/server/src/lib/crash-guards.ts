import { DateTime } from 'effect'

const describe = (value: unknown): unknown =>
	value instanceof Error
		? { name: value.name, message: value.message, stack: value.stack }
		: String(value)

const logFatal = (message: string, fields: Record<string, unknown>): void => {
	// Use the plain console here, not the app's logger: the program is already
	// crashing, so we keep logging dead-simple. The line is still structured
	// (JSON) so our log tools can read it like the rest.
	console.error(
		JSON.stringify({
			level: 'FATAL',
			message,
			timestamp: DateTime.formatIso(DateTime.nowUnsafe()),
			...fields,
		}),
	)
}

/**
 * Safety net for rare, low-level errors that slip past the app's normal error
 * handling — for example a database or email connection failing at an awkward
 * moment. Left unhandled, the program would stop *silently*: still listed as
 * "running" but answering nothing (the kind of failure that previously took the
 * site down). Instead we record the error and exit, so the hosting platform's
 * automatic "restart on failure" rule brings it back in a clean state.
 *
 * Call once, at startup. These handlers must never throw.
 */
export const installCrashGuards = (): void => {
	process.on('uncaughtException', (error, origin) => {
		try {
			logFatal('uncaughtException — exiting for restart', {
				origin,
				error: describe(error),
			})
		} finally {
			process.exit(1)
		}
	})

	process.on('unhandledRejection', reason => {
		try {
			logFatal('unhandledRejection — exiting for restart', {
				reason: describe(reason),
			})
		} finally {
			process.exit(1)
		}
	})
}
