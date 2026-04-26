import { Buffer } from 'node:buffer'
import {
	createCipheriv,
	createDecipheriv,
	hkdfSync,
	randomBytes,
} from 'node:crypto'

import { Effect, Layer, Redacted, ServiceMap } from 'effect'

import { EnvVars } from '../lib/env'

export interface EncryptedCredential {
	readonly ciphertext: Uint8Array
	readonly nonce: Uint8Array
	readonly tag: Uint8Array
}

// Per-inbox subkey via HKDF-SHA256. The inbox id is bound into the key
// derivation so identical plaintexts under different inbox ids produce
// different ciphertexts, and a compromised row blob cannot be replayed
// against another row without also having the master key.
const deriveSubkey = (masterKey: Buffer, inboxId: string): Buffer =>
	Buffer.from(
		hkdfSync(
			'sha256',
			masterKey,
			Buffer.alloc(0),
			Buffer.from(inboxId, 'utf8'),
			32,
		),
	)

export const encryptWithKey = (
	masterKey: Buffer,
	input: { inboxId: string; plain: string },
): EncryptedCredential => {
	const key = deriveSubkey(masterKey, input.inboxId)
	const nonce = randomBytes(12)
	const cipher = createCipheriv('aes-256-gcm', key, nonce)
	const ciphertext = Buffer.concat([
		cipher.update(input.plain, 'utf8'),
		cipher.final(),
	])
	return { ciphertext, nonce, tag: cipher.getAuthTag() }
}

export const decryptWithKey = (
	masterKey: Buffer,
	input: {
		inboxId: string
		ciphertext: Uint8Array
		nonce: Uint8Array
		tag: Uint8Array
	},
): string => {
	const key = deriveSubkey(masterKey, input.inboxId)
	const decipher = createDecipheriv('aes-256-gcm', key, input.nonce)
	decipher.setAuthTag(Buffer.from(input.tag))
	const plain = Buffer.concat([
		decipher.update(Buffer.from(input.ciphertext)),
		decipher.final(),
	])
	return plain.toString('utf8')
}

export class CredentialCrypto extends ServiceMap.Service<CredentialCrypto>()(
	'CredentialCrypto',
	{
		make: Effect.gen(function* () {
			const env = yield* EnvVars
			const masterKey = Buffer.from(
				Redacted.value(env.EMAIL_CREDENTIAL_KEY),
				'base64',
			)
			if (masterKey.length !== 32) {
				return yield* Effect.die(
					new Error(
						`EMAIL_CREDENTIAL_KEY must decode to exactly 32 bytes (got ${masterKey.length}). Generate with: node -e "console.log(crypto.randomBytes(32).toString('base64'))"`,
					),
				)
			}

			return {
				encryptPassword: (input: { inboxId: string; plain: string }) =>
					encryptWithKey(masterKey, input),
				decryptPassword: (input: {
					inboxId: string
					ciphertext: Uint8Array
					nonce: Uint8Array
					tag: Uint8Array
				}) => decryptWithKey(masterKey, input),
			} as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
