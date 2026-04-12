// Bounded-context entry point. The server imports `buildBetterAuthConfig`
// to instantiate its own `betterAuth(...)` (with `magicLink()` wired to
// `EmailProvider`); the CLI imports the adapter + use cases to run
// out-of-band operations against the same schema.

export {
	type BootstrapFirstAdminInput,
	bootstrapFirstAdmin,
} from './application/bootstrap-first-admin'
export { createApiKey } from './application/create-api-key'
export { type InviteUserInput, inviteUser } from './application/invite-user'
export { listApiKeys } from './application/list-api-keys'
export { listSessions } from './application/list-sessions'
export { listUsers } from './application/list-users'
// ── Application (use cases + ports) ────────────────────────────────────────
export type {
	ApiKeyRepository,
	CreateApiKeyInput,
	CreatedApiKey,
	MagicLinkSender,
	NewUserInput,
	NewUserWithPasswordInput,
	SessionRepository,
	UserRepository,
} from './application/ports'
export { promoteUser } from './application/promote-user'
export { resetPassword } from './application/reset-password'
export { revokeApiKey } from './application/revoke-api-key'
// ── Domain ─────────────────────────────────────────────────────────────────
export {
	ApiKeyNotFound,
	AuthConfigError,
	MagicLinkFailed,
	UserAlreadyExists,
	UserNotFound,
	UsersAlreadyExist,
} from './domain/errors'
export type {
	ApiKeyRecord,
	AuthUser,
	Role,
	SessionRecord,
} from './domain/types'
export { Role as RoleSchema } from './domain/types'
export {
	type BetterAuthAdapterInput,
	type MagicLinkCallback,
	type MagicLinkCallbackInput,
	makeBetterAuthAdapter,
} from './infrastructure/better-auth-adapter'
// ── Infrastructure ─────────────────────────────────────────────────────────
export {
	type AuthEnv,
	type BuildBetterAuthConfigInput,
	buildBetterAuthConfig,
} from './infrastructure/build-better-auth-config'
export { acquirePgPool } from './infrastructure/pg-pool'
