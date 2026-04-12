import { Schema } from 'effect'

export const Role = Schema.Literals(['admin', 'user'])
export type Role = typeof Role.Type

export interface AuthUser {
	readonly id: string
	readonly email: string
	readonly name: string
	readonly role: Role | null
	readonly emailVerified: boolean
	readonly createdAt: Date
}

export interface ApiKeyRecord {
	readonly id: string
	readonly name: string | null
	readonly prefix: string | null
	readonly userId: string
	readonly enabled: boolean
	readonly expiresAt: Date | null
	readonly createdAt: Date
}

export interface SessionRecord {
	readonly id: string
	readonly userId: string
	readonly userEmail: string
	readonly expiresAt: Date
	readonly createdAt: Date
	readonly ipAddress: string | null
	readonly userAgent: string | null
}
