import { simpleParser } from 'mailparser'
import { describe, expect, it } from 'vitest'

import { parseBounce } from './bounces'

// RFC 3464 DSN scaffolding helper. A delivery-status notification is a
// multipart/report;report-type=delivery-status with three parts:
//   1. text/plain — human-readable explanation (ignored by the parser)
//   2. message/delivery-status — Final-Recipient + Status + Diagnostic-Code
//   3. message/rfc822 OR text/rfc822-headers — the original we sent
const dsn = (args: {
	readonly originalMessageId: string
	readonly status: string
	readonly recipient: string
	readonly diagnostic?: string
	readonly originalForm?: 'rfc822' | 'rfc822-headers'
}): string => {
	const boundary = 'BOUNDARY_dsn'
	const original =
		args.originalForm === 'rfc822-headers'
			? [
					`Content-Type: text/rfc822-headers`,
					``,
					`Message-ID: ${args.originalMessageId}`,
					`To: ${args.recipient}`,
					`Subject: original`,
					``,
				].join('\r\n')
			: [
					`Content-Type: message/rfc822`,
					``,
					`Message-ID: ${args.originalMessageId}`,
					`To: ${args.recipient}`,
					`Subject: original`,
					``,
					`body bytes`,
					``,
				].join('\r\n')
	return [
		`From: MAILER-DAEMON@example.com`,
		`To: alice@example.com`,
		`Subject: Undelivered Mail Returned to Sender`,
		`Content-Type: multipart/report; report-type=delivery-status; boundary="${boundary}"`,
		``,
		`--${boundary}`,
		`Content-Type: text/plain; charset=utf-8`,
		``,
		`Delivery to the following recipient failed permanently.`,
		``,
		`--${boundary}`,
		`Content-Type: message/delivery-status`,
		``,
		`Reporting-MTA: dns; mta.example.com`,
		``,
		`Final-Recipient: rfc822;${args.recipient}`,
		`Action: failed`,
		`Status: ${args.status}`,
		args.diagnostic ? `Diagnostic-Code: smtp; ${args.diagnostic}` : '',
		``,
		`--${boundary}`,
		original,
		`--${boundary}--`,
		``,
	].join('\r\n')
}

describe('parseBounce', () => {
	it('returns null for a non-DSN message', async () => {
		// GIVEN a normal text/plain inbound mail (no multipart/report)
		// WHEN parseBounce runs
		// THEN it returns null so the caller falls through to normal persist
		const mail = await simpleParser(
			[
				`From: x@y.com`,
				`To: a@b.com`,
				`Subject: hi`,
				`Content-Type: text/plain`,
				``,
				`hello`,
			].join('\r\n'),
		)
		expect(parseBounce(mail)).toBeNull()
	})

	it('classifies a 5.x.x DSN as a hard bounce', async () => {
		// GIVEN a DSN with Status: 5.1.1 and a message/rfc822 original
		// WHEN parseBounce runs
		// THEN bounceType='hard', statusCode='5.1.1', and originalMessageId
		//   resolves to the embedded original — these are the three fields
		//   applyBounce uses to flip email_messages.status and contacts.email_status
		const mail = await simpleParser(
			dsn({
				originalMessageId: '<orig-hard@example.com>',
				status: '5.1.1',
				recipient: 'nope@example.invalid',
				diagnostic: '550 5.1.1 user unknown',
			}),
		)
		const bounce = parseBounce(mail)
		expect(bounce).not.toBeNull()
		expect(bounce?.bounceType).toBe('hard')
		expect(bounce?.statusCode).toBe('5.1.1')
		expect(bounce?.originalMessageId).toBe('<orig-hard@example.com>')
		expect(bounce?.recipients).toEqual(['nope@example.invalid'])
		expect(bounce?.diagnostic).toContain('user unknown')
	})

	it('classifies a 4.x.x DSN as a soft bounce', async () => {
		// GIVEN a DSN with Status: 4.2.2 (mailbox full / transient)
		// WHEN parseBounce runs
		// THEN bounceType='soft' so the caller bumps email_soft_bounce_count
		//   instead of flipping the contact straight to bounced
		const mail = await simpleParser(
			dsn({
				originalMessageId: '<orig-soft@example.com>',
				status: '4.2.2',
				recipient: 'busy@example.com',
			}),
		)
		const bounce = parseBounce(mail)
		expect(bounce?.bounceType).toBe('soft')
		expect(bounce?.statusCode).toBe('4.2.2')
	})

	it('extracts originalMessageId from the text/rfc822-headers variant', async () => {
		// GIVEN a DSN whose third part is text/rfc822-headers (Postfix and
		//   Exchange both prefer this form), not a full message/rfc822
		// WHEN parseBounce runs
		// THEN the original Message-ID is still resolved from the headers-only
		//   part — the join key into email_messages must work for both shapes
		const mail = await simpleParser(
			dsn({
				originalMessageId: '<headers-only@example.com>',
				status: '5.0.0',
				recipient: 'gone@example.com',
				originalForm: 'rfc822-headers',
			}),
		)
		const bounce = parseBounce(mail)
		expect(bounce?.originalMessageId).toBe('<headers-only@example.com>')
	})

	it('downgrades to bounceType=unknown when no Status is present', async () => {
		// GIVEN a DSN where the delivery-status part omits Status
		// WHEN parseBounce runs
		// THEN bounceType='unknown' so the caller skips hard/soft side effects
		//   (we still surface the row, but contacts/timeline stay untouched)
		const malformed = [
			`From: MAILER-DAEMON@example.com`,
			`To: alice@example.com`,
			`Subject: Undelivered`,
			`Content-Type: multipart/report; report-type=delivery-status; boundary="b"`,
			``,
			`--b`,
			`Content-Type: text/plain`,
			``,
			`failed`,
			``,
			`--b`,
			`Content-Type: message/delivery-status`,
			``,
			`Final-Recipient: rfc822;mystery@example.com`,
			``,
			`--b`,
			`Content-Type: message/rfc822`,
			``,
			`Message-ID: <orig@example.com>`,
			``,
			`--b--`,
			``,
		].join('\r\n')
		const mail = await simpleParser(malformed)
		const bounce = parseBounce(mail)
		expect(bounce?.bounceType).toBe('unknown')
		expect(bounce?.statusCode).toBeNull()
	})

	it('returns originalMessageId=null when no embedded original is present', async () => {
		// GIVEN a DSN with only a delivery-status part (no message/rfc822 nor
		//   text/rfc822-headers — some misconfigured MTAs send these)
		// WHEN parseBounce runs
		// THEN bounce metadata is returned but originalMessageId is null —
		//   applyBounce treats this as a no-op so we never flip the wrong row
		const noOrig = [
			`From: MAILER-DAEMON@example.com`,
			`To: alice@example.com`,
			`Subject: Undelivered`,
			`Content-Type: multipart/report; report-type=delivery-status; boundary="b"`,
			``,
			`--b`,
			`Content-Type: message/delivery-status`,
			``,
			`Final-Recipient: rfc822;a@b.com`,
			`Status: 5.0.0`,
			``,
			`--b--`,
			``,
		].join('\r\n')
		const mail = await simpleParser(noOrig)
		const bounce = parseBounce(mail)
		expect(bounce).not.toBeNull()
		expect(bounce?.originalMessageId).toBeNull()
		expect(bounce?.recipients).toEqual(['a@b.com'])
	})

	it('truncates a long Diagnostic-Code to 500 chars', async () => {
		// GIVEN a DSN whose Diagnostic-Code value blows past 500 chars
		//   (some MTAs paste the full upstream bounce body in here)
		// WHEN parseBounce runs
		// THEN the captured diagnostic is capped, protecting downstream UI
		//   and log lines from runaway strings
		const mail = await simpleParser(
			dsn({
				originalMessageId: '<orig@example.com>',
				status: '5.1.1',
				recipient: 'a@b.com',
				diagnostic: 'X'.repeat(800),
			}),
		)
		const bounce = parseBounce(mail)
		expect(bounce?.diagnostic).not.toBeNull()
		expect(bounce?.diagnostic?.length ?? 0).toBeLessThanOrEqual(500)
	})

	it('lowercases recipient addresses and strips RFC822 prefix', async () => {
		// GIVEN a Final-Recipient line in the canonical "rfc822;USER@HOST" form
		//   with mixed case
		// WHEN parseBounce runs
		// THEN the address is normalized lowercase so the downstream
		//   `lower(email) = ANY($1)` join in applyBounce matches contact rows
		const mail = await simpleParser(
			dsn({
				originalMessageId: '<orig@example.com>',
				status: '5.1.1',
				recipient: 'NOPE@Example.Invalid',
			}),
		)
		const bounce = parseBounce(mail)
		expect(bounce?.recipients).toEqual(['nope@example.invalid'])
	})
})
