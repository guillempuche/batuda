import { Buffer } from 'node:buffer'
import { createCipheriv, hkdfSync, randomBytes, randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { decryptWithKey } from './decrypt'

// Round-trip the AES-256-GCM blob the server writes when a user
// connects an inbox. The encrypt side is duplicated inline (a cross-
// app import would couple the worker test to apps/server's build);
// that's why the helper below tracks the same HKDF-SHA256 + per-
// inbox subkey scheme the server uses
// (apps/server/src/services/credential-crypto.ts).

const encryptForInbox = (
	masterKey: Buffer,
	inboxId: string,
	plaintext: string,
): { ciphertext: Buffer; nonce: Buffer; tag: Buffer } => {
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
		cipher.update(plaintext, 'utf8'),
		cipher.final(),
	])
	const tag = cipher.getAuthTag()
	return { ciphertext, nonce, tag }
}

describe('decryptWithKey', () => {
	describe('when the masterKey, inboxId, ciphertext, nonce and tag match', () => {
		it('should round-trip the original plaintext', () => {
			// GIVEN a 32-byte master key + a known inbox id + a plaintext
			// WHEN we encrypt then decrypt
			// THEN the recovered string equals the original
			// [decrypt.ts:31 — decryptWithKey]
			const masterKey = randomBytes(32)
			const inboxId = randomUUID()
			const blob = encryptForInbox(masterKey, inboxId, 'hunter2-secret')

			const recovered = decryptWithKey(masterKey, {
				inboxId,
				ciphertext: blob.ciphertext,
				nonce: blob.nonce,
				tag: blob.tag,
			})

			expect(recovered).toBe('hunter2-secret')
		})
	})

	describe('when the inboxId does not match the encrypting one', () => {
		it('should throw because the per-inbox subkey diverges', () => {
			// GIVEN a blob encrypted under inbox A
			// WHEN we attempt to decrypt with inbox B
			// THEN the GCM tag mismatch raises
			// [decrypt.ts:13 — deriveSubkey binds inboxId into HKDF info]
			const masterKey = randomBytes(32)
			const inboxA = randomUUID()
			const inboxB = randomUUID()
			const blob = encryptForInbox(masterKey, inboxA, 'shared-secret')

			expect(() =>
				decryptWithKey(masterKey, {
					inboxId: inboxB,
					ciphertext: blob.ciphertext,
					nonce: blob.nonce,
					tag: blob.tag,
				}),
			).toThrow()
		})
	})

	describe('when the ciphertext byte is tampered', () => {
		it('should throw on the auth-tag check', () => {
			// GIVEN a valid blob
			// WHEN one byte of the ciphertext is flipped
			// THEN GCM final() throws
			const masterKey = randomBytes(32)
			const inboxId = randomUUID()
			const blob = encryptForInbox(masterKey, inboxId, 'tamper-me')

			const tampered = Buffer.from(blob.ciphertext)
			tampered[0] = (tampered[0]! ^ 0xff) & 0xff

			expect(() =>
				decryptWithKey(masterKey, {
					inboxId,
					ciphertext: tampered,
					nonce: blob.nonce,
					tag: blob.tag,
				}),
			).toThrow()
		})
	})
})
