import { promises as dns } from 'node:dns'

import { Effect } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveMxOutcome } from './mx-verify'

// `resolveMxOutcome` reads MX records straight off `node:dns`, so the resolver
// is the only collaborator to stub. Each case drives one branch of the
// has_mx / no_mx / unknown decision.
vi.mock('node:dns', () => ({ promises: { resolveMx: vi.fn() } }))

const resolveMx = vi.mocked(dns.resolveMx)

// A DNS failure carries a libuv `code`; build one the way the resolver throws.
const dnsError = (code: string): Error =>
	Object.assign(new Error(`mock dns ${code}`), { code })

const run = (domain: string): Promise<'has_mx' | 'no_mx' | 'unknown'> =>
	Effect.runPromise(resolveMxOutcome(domain))

afterEach(() => {
	resolveMx.mockReset()
})

describe('resolveMxOutcome', () => {
	describe('when the domain publishes mail exchangers', () => {
		it('should report has_mx', async () => {
			// GIVEN a domain that resolves at least one MX record
			resolveMx.mockResolvedValue([{ priority: 10, exchange: 'mx1.acme.com' }])
			// WHEN the pre-gate runs
			// THEN the domain can receive mail
			// [mx-verify.ts — records.length > 0 ? 'has_mx']
			await expect(run('acme.com')).resolves.toBe('has_mx')
		})
	})

	describe('when the domain resolves but lists no exchangers', () => {
		it('should report no_mx so the paid verifier is skipped', async () => {
			// GIVEN a successful lookup that returns an empty record set
			resolveMx.mockResolvedValue([])
			// THEN there is no mail exchanger — the address cannot deliver
			// [mx-verify.ts — records.length > 0 ? … : 'no_mx']
			await expect(run('no-mail.com')).resolves.toBe('no_mx')
		})
	})

	describe('when the host does not exist', () => {
		it('should treat ENOTFOUND as no_mx', async () => {
			// GIVEN the domain itself does not resolve
			resolveMx.mockRejectedValue(dnsError('ENOTFOUND'))
			// THEN it definitively cannot receive mail
			// [mx-verify.ts — isNoRecords: code === 'ENOTFOUND']
			await expect(run('does-not-exist.invalid')).resolves.toBe('no_mx')
		})
	})

	describe('when the host exists but has no MX data', () => {
		it('should treat ENODATA as no_mx', async () => {
			// GIVEN the host resolves but publishes no MX record
			resolveMx.mockRejectedValue(dnsError('ENODATA'))
			// THEN it still cannot receive mail
			// [mx-verify.ts — isNoRecords: code === 'ENODATA']
			await expect(run('a-record-only.com')).resolves.toBe('no_mx')
		})
	})

	describe('when the lookup fails inconclusively', () => {
		it('should fall through to unknown on a transient DNS error', async () => {
			// GIVEN a server-side DNS failure (not a "no such record" answer)
			resolveMx.mockRejectedValue(dnsError('ESERVFAIL'))
			// THEN the verdict stays open so a good address is not failed closed
			// (the 2s timeout shares this onFailure → unknown path)
			// [mx-verify.ts — isNoRecords false → 'unknown']
			await expect(run('flaky-dns.com')).resolves.toBe('unknown')
		})

		it('should fall through to unknown when the error carries no code', async () => {
			// GIVEN a rejection with no libuv `code` field at all
			resolveMx.mockRejectedValue(new Error('socket hang up'))
			// THEN the missing code reads as inconclusive, never as no_mx
			// [mx-verify.ts — (error as {code?}).code is undefined → 'unknown']
			await expect(run('weird.com')).resolves.toBe('unknown')
		})
	})
})
