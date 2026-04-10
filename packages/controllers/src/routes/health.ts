import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

const HealthResponse = Schema.Struct({
	status: Schema.String,
	version: Schema.String,
	commit: Schema.String,
	region: Schema.String,
})

export const HealthGroup = HttpApiGroup.make('health').add(
	HttpApiEndpoint.get('check', '/health', {
		success: HealthResponse,
	}),
)
