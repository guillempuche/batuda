import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

/**
 * What one kind of telemetry is doing. `failing` means the last batch was
 * refused or never answered and has stayed that way — not that nothing has been
 * sent lately, which is the ordinary state of a quiet service.
 */
const SignalReport = Schema.Struct({
	failing: Schema.Boolean,
	failure: Schema.optional(
		Schema.Literals([
			'unauthorized',
			'rate_limited',
			'rejected',
			'unreachable',
		]),
	),
	lastSuccessAt: Schema.optional(Schema.Number),
})

/**
 * Whether this process is still reaching its telemetry backend.
 *
 * Reported here as well as on the console because a process that cannot export
 * cannot say so through the thing it exports to — and the console of a deployed
 * instance is not always reachable. One request answers it from anywhere.
 *
 * No backend host, no vendor wording, no status line: this endpoint is served
 * without authentication, and the reason alone is enough to tell a rejected key
 * from a quota from a dead route.
 */
const TelemetryReport = Schema.Struct({
	exporting: Schema.Boolean,
	signals: Schema.Struct({
		traces: SignalReport,
		logs: SignalReport,
		metrics: SignalReport,
	}),
})

export const HealthResponse = Schema.Struct({
	status: Schema.String,
	version: Schema.String,
	commit: Schema.String,
	region: Schema.String,
	telemetry: TelemetryReport,
})

export const HealthGroup = HttpApiGroup.make('health').add(
	HttpApiEndpoint.get('check', '/health', {
		success: HealthResponse,
	}),
)
