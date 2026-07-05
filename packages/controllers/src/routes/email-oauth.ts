import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

// Public OAuth-callback landing. The identity provider redirects the user's
// browser here with an authorization `code` and the signed `state` the start
// endpoint issued. The handler trusts only the org + user carried in that
// signature, so this group carries NO session or org middleware — it is
// reachable without a Batuda cookie. Prefixed `/v1` so the full path matches
// the redirect URI the token service registers with Google / Microsoft
// (`.../v1/email/oauth/:provider/callback`).
export const EmailOauthCallbackGroup = HttpApiGroup.make('emailOauthCallback')
	.add(
		HttpApiEndpoint.get('oauthCallback', '/email/oauth/:provider/callback', {
			params: { provider: Schema.Literals(['gmail-oauth', 'm365-oauth']) },
			// `code` is optional: on a cancelled/failed consent the provider
			// redirects with `?error=…` and no code, and the handler must run to
			// bounce the user back to settings rather than 400 on validation.
			query: {
				code: Schema.optional(Schema.String),
				state: Schema.String,
				error: Schema.optional(Schema.String),
			},
			success: Schema.Unknown,
		}),
	)
	.prefix('/v1')
