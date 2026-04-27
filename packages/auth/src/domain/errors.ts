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

// `inviteAdmin` refuses to claim an org slug that's already in use unless the
// caller opts in via `--allow-existing-org`. Without the gate, CLI mistakes
// could attach a new admin to someone else's org.
export class OrgSlugTaken extends Schema.TaggedErrorClass<OrgSlugTaken>()(
	'OrgSlugTaken',
	{ slug: Schema.String },
) {}

// Surfaced when an admin invite hits an existing `(userId, organizationId)`
// row — handles both the slug-reuse case and the rare race where the user
// landed in the org via a parallel path (e.g. server `/auth` flow) between
// our find and write.
export class AlreadyMember extends Schema.TaggedErrorClass<AlreadyMember>()(
	'AlreadyMember',
	{ email: Schema.String, slug: Schema.String },
) {}
