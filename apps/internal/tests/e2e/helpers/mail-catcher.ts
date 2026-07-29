// Tiny client over the dev mail-catcher's REST API (GreenMail). The dev
// compose service exposes it at host :8025; specs poll it to assert what the
// server actually wrote to the SMTP socket. Nothing here empties it: one
// catcher serves every checkout on this machine, and it can only be emptied
// whole. `pnpm cli email clear` does that when you mean to.
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

// How a caller names the message it is waiting for: one of the two is required.
// A mailbox keeps what earlier runs delivered to it, and the catcher is shared
// with every other checkout on this machine, so "the first message" is easily
// somebody else's.
type MessageIdentifier =
	| { subject: string; bodyContains?: string }
	| { subject?: string; bodyContains: string }

// Wait for a message this test can prove is its own.
//
// Name it by `subject`, or by `bodyContains` where the subject is not the
// test's to choose — a reply inherits its parent's.
export async function waitForMessage(
	recipient: string,
	options: MessageIdentifier & { timeoutMs?: number; pollMs?: number },
): Promise<CatcherMessage>
// Both names stay optional in the implementation, so a call that skips them
// reaches the explanation below instead of failing on a missing argument.
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
	// Checked at run time as well: nothing type-checks this folder, so the
	// signature above only guides the editor.
	if (!subject && !bodyContains) {
		throw new Error(
			`mail-catcher: say which message you are waiting for on "${recipient}" — pass a subject, or bodyContains where the subject is not yours to choose. The mailbox also holds what earlier runs, and other checkouts on this machine, delivered to it.`,
		)
	}

	const deadline = Date.now() + timeoutMs
	let lastError: unknown = null
	// Read the same way the check above reads them, so a name given as an empty
	// string is ignored rather than matched against — which would find nothing
	// and time out instead of saying what was wrong.
	const isWanted = (m: CatcherMessage) =>
		(!subject || m.Subject === subject) &&
		(!bodyContains || m.mimeMessage.includes(bodyContains))
	while (Date.now() < deadline) {
		try {
			const messages = await listMessages(recipient)
			const match = messages.find(isWanted)
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
	// An empty subject matches nothing, so the check would pass without having
	// proved anything.
	if (!subject) {
		throw new Error(
			`mail-catcher: name the message that must not arrive for "${recipient}" — an unnamed check on a shared mailbox proves nothing.`,
		)
	}

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
