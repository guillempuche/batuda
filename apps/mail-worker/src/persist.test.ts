// Pure-transform tests for the mailparser → ParsedInbound adapter.
// Live-DB INSERT behavior (idempotency, participant rows, thread
// upsert, attachments JSONB) is exercised end-to-end by the IMAP
// roundtrip test — duplicating the SQL contract here would require
// rebuilding the same fixtures and gives less coverage.

import { type ParsedMail, simpleParser } from 'mailparser'
import { describe, expect, it } from 'vitest'

import { fromParsedMail } from './persist'

const parse = (raw: string): Promise<ParsedMail> => simpleParser(raw)

const rfc822 = (args: {
	readonly from?: string
	readonly to?: string
	readonly cc?: string
	readonly bcc?: string
	readonly subject?: string
	readonly inReplyTo?: string
	readonly references?: string
	readonly text?: string
	readonly html?: string | false
	readonly date?: string
	readonly messageId?: string
}): string => {
	const lines: string[] = []
	if (args.from) lines.push(`From: ${args.from}`)
	if (args.to) lines.push(`To: ${args.to}`)
	if (args.cc) lines.push(`Cc: ${args.cc}`)
	if (args.bcc) lines.push(`Bcc: ${args.bcc}`)
	if (args.subject) lines.push(`Subject: ${args.subject}`)
	if (args.messageId) lines.push(`Message-ID: ${args.messageId}`)
	if (args.inReplyTo) lines.push(`In-Reply-To: ${args.inReplyTo}`)
	if (args.references) lines.push(`References: ${args.references}`)
	if (args.date) lines.push(`Date: ${args.date}`)
	lines.push('Content-Type: text/plain; charset=utf-8')
	lines.push('')
	lines.push(args.text ?? 'body')
	return lines.join('\r\n')
}

describe('fromParsedMail', () => {
	describe('when addresses are upper-case on the wire', () => {
		it('should lower-case the from / to / cc / bcc fields', async () => {
			const mail = await parse(
				rfc822({
					from: 'Pep <PEP@CalPepFonda.cat>',
					to: 'Alice <ALICE@TALLER.cat>',
					cc: 'Watcher <WATCH@External.com>',
					subject: 'hi',
					messageId: '<msg@x>',
				}),
			)
			const parsed = fromParsedMail(mail)
			expect(parsed.fromAddress).toBe('pep@calpepfonda.cat')
			expect(parsed.toAddresses).toEqual(['alice@taller.cat'])
			expect(parsed.ccAddresses).toEqual(['watch@external.com'])
			expect(parsed.bccAddresses).toEqual([])
		})
	})

	describe('when references arrives as a single string', () => {
		it('should normalise to a one-element array', async () => {
			const mail = await parse(
				rfc822({
					from: 'a@x',
					to: 'b@x',
					subject: 'r',
					messageId: '<2@x>',
					references: '<1@x>',
				}),
			)
			const parsed = fromParsedMail(mail)
			expect(parsed.references).toEqual(['<1@x>'])
		})
	})

	describe('when text body is longer than 200 characters', () => {
		it('should clamp the preview to 200 characters', async () => {
			const long = 'x'.repeat(500)
			const mail = await parse(
				rfc822({
					from: 'a@x',
					to: 'b@x',
					subject: 'p',
					messageId: '<3@x>',
					text: long,
				}),
			)
			const parsed = fromParsedMail(mail)
			expect(parsed.textPreview).toHaveLength(200)
			expect(parsed.textPreview).toBe(long.slice(0, 200))
		})
	})

	describe('when the html field is missing', () => {
		it('should leave htmlBody as null', async () => {
			const mail = await parse(
				rfc822({
					from: 'a@x',
					to: 'b@x',
					subject: 'no-html',
					messageId: '<4@x>',
					text: 'plain only',
				}),
			)
			const parsed = fromParsedMail(mail)
			expect(parsed.htmlBody).toBeNull()
		})
	})

	describe('when the message has no Date header', () => {
		it('should default receivedAt to now() so the row is sortable', async () => {
			const mail = await parse(
				rfc822({
					from: 'a@x',
					to: 'b@x',
					subject: 'd',
					messageId: '<5@x>',
				}),
			)
			const before = Date.now()
			const parsed = fromParsedMail(mail)
			const after = Date.now()
			expect(parsed.receivedAt.getTime()).toBeGreaterThanOrEqual(before - 1)
			expect(parsed.receivedAt.getTime()).toBeLessThanOrEqual(after + 1)
		})
	})
})
