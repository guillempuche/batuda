import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import type { AuthUser } from '../domain/types'
import { inviteUser } from './invite-user'
import type { MagicLinkSender, UserRepository } from './ports'

const anyUser: AuthUser = {
	id: 'user_1',
	email: 'invitee@example.com',
	name: 'Invitee',
	role: 'user',
	emailVerified: false,
	createdAt: new Date('2026-01-01T00:00:00.000Z'),
}

// Creating the account is the only thing `inviteUser` should reach for. The
// rest fail loudly, so a future change that starts calling one is visible here
// rather than quietly passing.
const unusedEffect = Effect.die(new Error('not used by inviteUser'))
const unused = () => unusedEffect

const stubUsers = (): UserRepository => ({
	countAll: unusedEffect,
	findByEmail: unused,
	listAll: unusedEffect,
	createWithPassword: unused,
	createPasswordless: () => Effect.succeed(anyUser),
	setRole: unused,
	setName: unused,
	setPassword: unused,
})

const countingSender = (): MagicLinkSender & { readonly sent: string[] } => {
	const sent: string[] = []
	return {
		sent,
		send: (email: string) => Effect.sync(() => void sent.push(email)),
	}
}

describe('inviteUser', () => {
	describe('when the caller can deliver the link', () => {
		it('should issue one', async () => {
			// GIVEN a caller that has not opted out of delivery
			const magicLink = countingSender()

			// WHEN a user is invited
			const user = await Effect.runPromise(
				inviteUser(stubUsers(), magicLink, {
					email: 'invitee@example.com',
					name: 'Invitee',
					role: 'user',
				}),
			)

			// THEN the account exists and a link went to the sender
			expect(user.email).toBe('invitee@example.com')
			expect(magicLink.sent).toEqual(['invitee@example.com'])
		})
	})

	describe('when the caller cannot deliver the link', () => {
		// Issuing writes a real sign-in credential, so a caller with no transport
		// must be able to create the account without minting one nobody receives.
		it('should create the account without issuing one', async () => {
			// GIVEN a caller that has said it cannot deliver
			const magicLink = countingSender()

			// WHEN a user is invited with delivery turned off
			const user = await Effect.runPromise(
				inviteUser(stubUsers(), magicLink, {
					email: 'invitee@example.com',
					name: 'Invitee',
					role: 'user',
					sendMagicLink: false,
				}),
			)

			// THEN the account still exists but no link was ever issued
			expect(user.email).toBe('invitee@example.com')
			expect(magicLink.sent).toEqual([])
		})
	})
})
