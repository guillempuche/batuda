import type { Effect } from 'effect'

import type {
	ApiKeyNotFound,
	AuthConfigError,
	MagicLinkFailed,
	UserAlreadyExists,
	UserNotFound,
} from '../domain/errors'
import type {
	ApiKeyRecord,
	AuthUser,
	Role,
	SessionRecord,
} from '../domain/types'

// Inputs are plain data — the use cases map them onto whichever Better-Auth
// admin endpoint they need, then the adapter translates to pg. The ports stay
// transport-agnostic so a future HTTP-only adapter (e.g. calling a running
// server from a different process) can drop in without touching use cases.

export interface NewUserInput {
	readonly email: string
	readonly name: string
	readonly role: Role
}

export interface NewUserWithPasswordInput extends NewUserInput {
	readonly password: string
}

export interface CreateApiKeyInput {
	readonly email: string
	readonly name: string
	readonly prefix: string
	readonly expiresIn: number | undefined
}

export interface CreatedApiKey {
	readonly id: string
	readonly key: string
	readonly ownerEmail: string
	readonly ownerRole: Role | 'user'
	readonly name: string
}

export interface UserRepository {
	readonly countAll: Effect.Effect<number, AuthConfigError>
	readonly findByEmail: (
		email: string,
	) => Effect.Effect<AuthUser | null, AuthConfigError>
	readonly listAll: Effect.Effect<ReadonlyArray<AuthUser>, AuthConfigError>
	readonly createWithPassword: (
		input: NewUserWithPasswordInput,
	) => Effect.Effect<AuthUser, UserAlreadyExists | AuthConfigError>
	readonly createPasswordless: (
		input: NewUserInput,
	) => Effect.Effect<AuthUser, UserAlreadyExists | AuthConfigError>
	readonly setRole: (
		email: string,
		role: Role,
	) => Effect.Effect<void, UserNotFound | AuthConfigError>
	readonly setPassword: (
		email: string,
		password: string,
	) => Effect.Effect<void, UserNotFound | AuthConfigError>
}

export interface ApiKeyRepository {
	readonly list: (
		email: string | undefined,
	) => Effect.Effect<ReadonlyArray<ApiKeyRecord>, AuthConfigError>
	readonly create: (
		input: CreateApiKeyInput,
	) => Effect.Effect<CreatedApiKey, UserNotFound | AuthConfigError>
	readonly revoke: (
		keyId: string,
	) => Effect.Effect<void, ApiKeyNotFound | AuthConfigError>
}

export interface SessionRepository {
	readonly list: (
		email: string | undefined,
	) => Effect.Effect<ReadonlyArray<SessionRecord>, AuthConfigError>
}

// Sends the magic link via whatever transport the caller has wired — dev
// catcher in local, AgentMail in cloud. Use cases never touch email state
// directly.
export interface MagicLinkSender {
	readonly send: (email: string) => Effect.Effect<void, MagicLinkFailed>
}
