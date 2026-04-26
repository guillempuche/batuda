import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { decryptWithKey, encryptWithKey } from './credential-crypto'

const masterKey = () => randomBytes(32)

describe('credential-crypto', () => {
	describe('encryptWithKey + decryptWithKey', () => {
		it('round-trips a password unchanged', () => {
			// GIVEN a master key and a plaintext password
			// WHEN encrypting then decrypting
			// THEN the original plaintext is recovered
			const key = masterKey()
			const inboxId = 'inbox-1'
			const plain = 'p@ssw0rd-with-symbols-€éñ'

			const enc = encryptWithKey(key, { inboxId, plain })
			const out = decryptWithKey(key, { inboxId, ...enc })

			expect(out).toBe(plain)
		})

		it('produces different ciphertext for the same plaintext on each call', () => {
			// GIVEN a fixed key, inbox id, and plaintext
			// WHEN encrypting twice
			// THEN nonces differ and ciphertexts differ (semantic security)
			const key = masterKey()
			const enc1 = encryptWithKey(key, { inboxId: 'i', plain: 'same' })
			const enc2 = encryptWithKey(key, { inboxId: 'i', plain: 'same' })

			expect(Buffer.compare(enc1.nonce, enc2.nonce)).not.toBe(0)
			expect(Buffer.compare(enc1.ciphertext, enc2.ciphertext)).not.toBe(0)
		})

		it('rejects ciphertext bound to a different inbox id', () => {
			// GIVEN a credential encrypted under inbox A
			// WHEN decrypting with inbox B's id
			// THEN the GCM auth tag check fails
			const key = masterKey()
			const enc = encryptWithKey(key, { inboxId: 'A', plain: 'secret' })

			expect(() => decryptWithKey(key, { inboxId: 'B', ...enc })).toThrowError(
				/unsupported state|unable to authenticate/i,
			)
		})

		it('rejects a tampered tag', () => {
			// GIVEN a valid encryption
			// WHEN flipping a bit in the auth tag
			// THEN decryption raises an authentication error
			const key = masterKey()
			const enc = encryptWithKey(key, { inboxId: 'i', plain: 'secret' })
			const tampered = Buffer.from(enc.tag)
			tampered[0] = (tampered[0] ?? 0) ^ 0x01

			expect(() =>
				decryptWithKey(key, { inboxId: 'i', ...enc, tag: tampered }),
			).toThrowError(/unsupported state|unable to authenticate/i)
		})

		it('rejects ciphertext under a different master key', () => {
			// GIVEN encryption under key K1
			// WHEN attempting to decrypt with key K2
			// THEN the GCM auth tag check fails
			const k1 = masterKey()
			const k2 = masterKey()
			const enc = encryptWithKey(k1, { inboxId: 'i', plain: 'secret' })

			expect(() => decryptWithKey(k2, { inboxId: 'i', ...enc })).toThrowError(
				/unsupported state|unable to authenticate/i,
			)
		})

		it('handles empty plaintext', () => {
			// GIVEN an empty string
			// WHEN round-tripping
			// THEN the empty string is recovered (still authenticated by tag)
			const key = masterKey()
			const enc = encryptWithKey(key, { inboxId: 'i', plain: '' })
			expect(decryptWithKey(key, { inboxId: 'i', ...enc })).toBe('')
		})
	})
})
