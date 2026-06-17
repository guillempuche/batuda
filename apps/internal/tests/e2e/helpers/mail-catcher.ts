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
interface ParsedMessage {
	readonly Text: string
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

export async function clearCatcher(): Promise<void> {
	const res = await fetch(`${MAIL_CATCHER_HTTP_URL}/api/mail/purge`, {
		method: 'POST',
	})
	if (!res.ok) {
		throw new Error(`mail-catcher purge failed: ${res.status}`)
	}
}

export async function waitForMessage(
	recipient: string,
	{
		subject,
		timeoutMs = 5_000,
		pollMs = 250,
	}: { subject?: string; timeoutMs?: number; pollMs?: number } = {},
): Promise<CatcherMessage> {
	const deadline = Date.now() + timeoutMs
	let lastError: unknown = null
	while (Date.now() < deadline) {
		try {
			const messages = await listMessages(recipient)
			const match = subject
				? messages.find(m => m.Subject === subject)
				: messages[0]
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

export async function expectNoMessage(
	recipient: string,
	windowMs = 1_500,
): Promise<void> {
	await new Promise(resolve => setTimeout(resolve, windowMs))
	const messages = await listMessages(recipient)
	if (messages.length > 0) {
		throw new Error(
			`mail-catcher: expected no message for "${recipient}", got ${messages.length}`,
		)
	}
}

export async function getMessage(
	message: CatcherMessage,
): Promise<ParsedMessage> {
	const parsed = await simpleParser(message.mimeMessage)
	return {
		Text: parsed.text ?? '',
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
