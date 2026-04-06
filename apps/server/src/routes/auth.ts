import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

export const AuthGroup = HttpApiGroup.make('auth')
	.add(
		HttpApiEndpoint.get('authGet', '/auth/*', {
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.post('authPost', '/auth/*', {
			success: Schema.Unknown,
		}),
	)
