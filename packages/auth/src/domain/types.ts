import { Schema } from 'effect'

export const Role = Schema.Literals(['admin', 'user'])
export type Role = typeof Role.Type

// Membership role inside an organization. Distinct from `Role` which lives
// on the user row and gates platform-level admin actions; this one gates
// what the user can do *inside* a given org.
export const OrgMembershipRole = Schema.Literals(['owner', 'admin', 'member'])
export type OrgMembershipRole = typeof OrgMembershipRole.Type

export interface Organization {
	readonly id: string
	readonly name: string
	readonly slug: string
	readonly createdAt: Date
}

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
