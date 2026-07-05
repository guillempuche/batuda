import { Buffer } from 'node:buffer'
import { createDecipheriv, hkdfSync } from 'node:crypto'

import { Effect, Layer, Redacted, ServiceMap } from 'effect'

import { WorkerEnvVars } from './env.js'

// Per-connection subkey via HKDF-SHA256 — must match the server-side
// derivation in apps/server/src/services/credential-crypto.ts so the
// blob written when a connection is created can be reversed here. The
// connection id is bound into the key derivation: a leaked row blob cannot
// be replayed against another row without the master key.
const deriveSubkey = (masterKey: Buffer, connectionId: string): Buffer =>
	Buffer.from(
		hkdfSync(
			'sha256',
			masterKey,
			Buffer.alloc(0),
			Buffer.from(connectionId, 'utf8'),
			32,
		),
	)

export interface DecryptInput {
	readonly connectionId: string
	readonly ciphertext: Uint8Array
	readonly nonce: Uint8Array
	readonly tag: Uint8Array
}

export const decryptWithKey = (
	masterKey: Buffer,
	input: DecryptInput,
): string => {
	const key = deriveSubkey(masterKey, input.connectionId)
	const decipher = createDecipheriv('aes-256-gcm', key, input.nonce)
	decipher.setAuthTag(Buffer.from(input.tag))
	const plain = Buffer.concat([
		decipher.update(Buffer.from(input.ciphertext)),
		decipher.final(),
	])
	return plain.toString('utf8')
}

export class CredentialDecryptor extends ServiceMap.Service<CredentialDecryptor>()(
	'CredentialDecryptor',
	{
		make: Effect.gen(function* () {
			const env = yield* WorkerEnvVars
			const masterKey = Buffer.from(
				Redacted.value(env.EMAIL_CREDENTIAL_KEY),
				'base64',
			)
			if (masterKey.length !== 32) {
				return yield* Effect.die(
					new Error(
						`EMAIL_CREDENTIAL_KEY must decode to exactly 32 bytes (got ${masterKey.length}).`,
					),
				)
			}
			return {
				decrypt: (input: DecryptInput) => decryptWithKey(masterKey, input),
			} as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
