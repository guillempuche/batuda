import { createCipheriv, hkdfSync, randomBytes } from 'node:crypto'

import { Config, Effect } from 'effect'

import type { SeedCtx } from './shared'

interface InboxSpec {
	readonly email: string
	readonly id: string
	readonly displayName: string
	readonly ownerEmail: string
	readonly orgId: string
	readonly purpose: 'human' | 'agent'
	readonly isDefault: boolean
	readonly footerText: string
}

export type SeededInbox = {
	readonly id: string
	readonly email: string
	readonly orgId: string
}

// Stable demo-inbox UUIDs so saved /emails URLs survive a re-seed.
const TALLER_HUMAN_INBOX_ID = '11111111-1111-4111-8111-111111111111'
const TALLER_AGENT_INBOX_ID = '22222222-2222-4222-8222-222222222222'
const RESTAURANT_HUMAN_INBOX_ID = '33333333-3333-4333-8333-333333333333'
const RESTAURANT_AGENT_INBOX_ID = '44444444-4444-4444-8444-444444444444'

export const seedInboxes = ({ sql, tallerOrgId, restaurantOrgId }: SeedCtx) =>
	Effect.gen(function* () {
		const masterKeyB64 = yield* Config.string('EMAIL_CREDENTIAL_KEY')
		const masterKey = Buffer.from(masterKeyB64, 'base64')
		if (masterKey.length !== 32) {
			return yield* Effect.fail(
				new Error(
					'EMAIL_CREDENTIAL_KEY must be a base64 string decoding to 32 bytes. Run `pnpm cli setup` or check apps/cli/.env.',
				),
			)
		}

		const inboxSpecs: InboxSpec[] = [
			{
				id: TALLER_HUMAN_INBOX_ID,
				email: 'admin@taller.cat',
				displayName: 'Alice Admin',
				ownerEmail: 'admin@taller.cat',
				orgId: tallerOrgId,
				purpose: 'human',
				isDefault: true,
				footerText: '— Alice Admin\nTaller Demo · taller.cat',
			},
			{
				id: TALLER_AGENT_INBOX_ID,
				email: 'agent@taller.cat',
				displayName: 'Alice Agent',
				ownerEmail: 'admin@taller.cat',
				orgId: tallerOrgId,
				purpose: 'agent',
				isDefault: false,
				footerText: "Automated response from Alice's agent.",
			},
		]
		if (restaurantOrgId !== null) {
			inboxSpecs.push(
				{
					id: RESTAURANT_HUMAN_INBOX_ID,
					email: 'admin@restaurant.demo',
					displayName: 'Bob Owner',
					ownerEmail: 'admin@restaurant.demo',
					orgId: restaurantOrgId,
					purpose: 'human',
					isDefault: true,
					footerText: '— Bob Owner\nRestaurant Demo',
				},
				{
					id: RESTAURANT_AGENT_INBOX_ID,
					email: 'agent@restaurant.demo',
					displayName: 'Bob Agent',
					ownerEmail: 'admin@restaurant.demo',
					orgId: restaurantOrgId,
					purpose: 'agent',
					isDefault: false,
					footerText: "Automated response from Bob's agent.",
				},
			)
		}

		const ownerEmails = [...new Set(inboxSpecs.map(s => s.ownerEmail))]
		const ownerRows = yield* sql<{
			id: string
			email: string
		}>`SELECT id, email FROM "user" WHERE email = ANY(${ownerEmails as string[]})`
		const userIdByEmail = new Map(ownerRows.map(r => [r.email, r.id]))

		const seededInboxes: SeededInbox[] = []

		for (const spec of inboxSpecs) {
			const ownerId = userIdByEmail.get(spec.ownerEmail)
			if (!ownerId) {
				yield* Effect.logInfo(
					`  (skipped inbox ${spec.email} — owner not found, run seed auth first)`,
				)
				continue
			}
			const inboxId = spec.id
			const subkey = Buffer.from(
				hkdfSync(
					'sha256',
					masterKey,
					Buffer.alloc(0),
					Buffer.from(inboxId, 'utf8'),
					32,
				),
			)
			const nonce = randomBytes(12)
			const cipher = createCipheriv('aes-256-gcm', subkey, nonce)
			const ciphertext = Buffer.concat([
				cipher.update('demo-imap-password', 'utf8'),
				cipher.final(),
			])
			const tag = cipher.getAuthTag()
			yield* sql`
				INSERT INTO inboxes ${sql.insert({
					id: inboxId,
					organizationId: spec.orgId,
					email: spec.email,
					displayName: spec.displayName,
					purpose: spec.purpose,
					ownerUserId: ownerId,
					isDefault: spec.isDefault,
					isPrivate: false,
					active: true,
					imapHost: 'localhost',
					imapPort: 1143,
					imapSecurity: 'plain',
					smtpHost: 'localhost',
					smtpPort: 1025,
					smtpSecurity: 'plain',
					username: spec.email,
					passwordCiphertext: ciphertext,
					passwordNonce: nonce,
					passwordTag: tag,
					grantStatus: 'connected',
				})}
			`
			yield* sql`
				INSERT INTO inbox_footers ${sql.insert({
					organizationId: spec.orgId,
					inboxId,
					name: 'default',
					bodyJson: JSON.stringify([
						{
							type: 'paragraph',
							spans: [{ kind: 'text', value: spec.footerText }],
						},
					]),
					isDefault: true,
				})}
			`
			yield* Effect.logInfo(
				`  inbox: ${spec.email} (${spec.purpose}, owner ${ownerId})`,
			)
			seededInboxes.push({
				id: inboxId,
				email: spec.email,
				orgId: spec.orgId,
			})
		}

		return seededInboxes
	})
