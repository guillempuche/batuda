import { Schema } from 'effect'

export class UserNotFound extends Schema.TaggedErrorClass<UserNotFound>()(
	'UserNotFound',
	{ email: Schema.String },
) {}

// `bootstrapFirstAdmin` refuses when any row already exists in "user". Carries
// the row count so the CLI can explain *why* the bootstrap is a no-op.
export class UsersAlreadyExist extends Schema.TaggedErrorClass<UsersAlreadyExist>()(
	'UsersAlreadyExist',
	{ count: Schema.Number },
) {}

// `inviteUser` refuses on duplicate email — the caller should either resend a
// magic link via a different command or reset the password.
export class UserAlreadyExists extends Schema.TaggedErrorClass<UserAlreadyExists>()(
	'UserAlreadyExists',
	{ email: Schema.String },
) {}

export class MagicLinkFailed extends Schema.TaggedErrorClass<MagicLinkFailed>()(
	'MagicLinkFailed',
	{ email: Schema.String, cause: Schema.String },
) {}

export class ApiKeyNotFound extends Schema.TaggedErrorClass<ApiKeyNotFound>()(
	'ApiKeyNotFound',
	{ keyId: Schema.String },
) {}

// Any underlying failure in the Better-Auth adapter or pg pool that isn't
// already a domain-meaningful error — preserves a human-readable `message` so
// the CLI can print it without unwrapping nested causes.
export class AuthConfigError extends Schema.TaggedErrorClass<AuthConfigError>()(
	'AuthConfigError',
	{ message: Schema.String },
) {}
