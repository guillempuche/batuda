// Tiny client over the dev mail-catcher's REST API (GreenMail). The dev
// compose service exposes it at host :8025; specs poll it to assert what the
// server actually wrote to the SMTP socket, and purge it between tests.
// Override MAIL_CATCHER_HTTP_URL to point at a remote dev stack.

import { simpleParser } from 'mailparser'

const MAIL_CATCHER_HTTP_URL =
	process.env['MAIL_CATCHER_HTTP_URL'] ?? 'http://localhost:8025'

// One message as the catcher returns it: `mimeMessage` is the full raw RFC822,
// `Subject` the parsed header. Carried whole so callers don't re-fetch.
export interface CatcherMessage {
	readonly Subject: string
	readonly mimeMessage: string
}

// Decoded view for the few assertions that need the parsed body/attachments.
// `Html` is the decoded text/html part — assert formatting against this, not
// the raw RFC822, whose quoted-printable soft-wraps split long style tags.
interface ParsedMessage {
	readonly Text: string
	readonly Html: string
	readonly Attachments: ReadonlyArray<{
		readonly FileName: string
		readonly ContentType: string
		readonly Size: number
	}>
}

interface CatcherListItem {
	readonly subject: string
	readonly mimeMessage: string
}

// The catcher creates a recipient's mailbox on first delivery, so a recipient
// that never received mail answers 400/404 here — treat that as "no messages".
async function listMessages(
	recipient: string,
): Promise<ReadonlyArray<CatcherMessage>> {
	const url = `${MAIL_CATCHER_HTTP_URL}/api/user/${encodeURIComponent(
		recipient,
	)}/messages/INBOX/`
	const res = await fetch(url)
	if (res.status === 400 || res.status === 404) return []
	if (!res.ok) {
		throw new Error(`mail-catcher list failed for ${recipient}: ${res.status}`)
	}
	const body = (await res.json()) as ReadonlyArray<CatcherListItem>
	return body.map(m => ({ Subject: m.subject, mimeMessage: m.mimeMessage }))
}

// Wait for a message this test can prove is its own.
//
// Say which one with `subject`, or with `bodyContains` where the subject is not
// the test's to choose — a reply inherits its parent's. Say nothing and you get
// whichever message happens to be first, which on a machine running more than
// one checkout may belong to somebody else: the catcher is shared, and a
// mailbox keeps what earlier runs delivered to it.
export async function waitForMessage(
	recipient: string,
	{
		subject,
		bodyContains,
		timeoutMs = 5_000,
		pollMs = 250,
	}: {
		subject?: string
		bodyContains?: string
		timeoutMs?: number
		pollMs?: number
	} = {},
): Promise<CatcherMessage> {
	const deadline = Date.now() + timeoutMs
	let lastError: unknown = null
	const isWanted = (m: CatcherMessage) =>
		(subject === undefined || m.Subject === subject) &&
		(bodyContains === undefined || m.mimeMessage.includes(bodyContains))
	while (Date.now() < deadline) {
		try {
			const messages = await listMessages(recipient)
			const match =
				subject === undefined && bodyContains === undefined
					? messages[0]
					: messages.find(isWanted)
			if (match) return match
		} catch (err) {
			lastError = err
		}
		await new Promise(resolve => setTimeout(resolve, pollMs))
	}
	throw new Error(
		`mail-catcher: no message for "${recipient}" within ${timeoutMs}ms${
			lastError ? ` (last error: ${String(lastError)})` : ''
		}`,
	)
}

// Prove this test's message never arrived. Named by subject rather than by an
// empty mailbox, because the mailbox holds whatever earlier runs — and other
// checkouts on this machine — delivered to it.
export async function expectNoMessage(
	recipient: string,
	subject: string,
	windowMs = 1_500,
): Promise<void> {
	await new Promise(resolve => setTimeout(resolve, windowMs))
	const messages = await listMessages(recipient)
	const arrived = messages.filter(m => m.Subject === subject)
	if (arrived.length > 0) {
		throw new Error(
			`mail-catcher: expected no "${subject}" for "${recipient}", got ${arrived.length}`,
		)
	}
}

export async function getMessage(
	message: CatcherMessage,
): Promise<ParsedMessage> {
	const parsed = await simpleParser(message.mimeMessage)
	return {
		Text: parsed.text ?? '',
		Html: parsed.html || '',
		Attachments: parsed.attachments.map(a => ({
			FileName: a.filename ?? '',
			ContentType: a.contentType,
			Size: a.size,
		})),
	}
}

export function getRawMessage(message: CatcherMessage): string {
	return message.mimeMessage
}
