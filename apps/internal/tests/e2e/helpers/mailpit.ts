// Tiny client over mailpit's HTTP API. The dev compose service binds the
// API at :8025; tests poll it to assert what the server actually wrote
// to the SMTP socket. Override MAILPIT_HTTP_URL to point at a different
// host (e.g. when running specs from a CI runner against a remote dev
// stack).
const MAILPIT_HTTP_URL =
	process.env['MAILPIT_HTTP_URL'] ?? 'http://localhost:8025'

interface MailpitMessageSummary {
	readonly ID: string
	readonly Subject: string
	readonly To: ReadonlyArray<{
		readonly Address: string
		readonly Name: string
	}>
	readonly Cc: ReadonlyArray<{
		readonly Address: string
		readonly Name: string
	}>
	readonly Bcc: ReadonlyArray<{
		readonly Address: string
		readonly Name: string
	}>
}

interface MailpitSearchResponse {
	readonly messages: ReadonlyArray<MailpitMessageSummary>
}

interface MailpitMessageDetail {
	readonly ID: string
	readonly Subject: string
	readonly Text: string
	readonly HTML: string
	readonly Attachments: ReadonlyArray<{
		readonly FileName: string
		readonly ContentType: string
		readonly Size: number
	}>
	readonly To: ReadonlyArray<{
		readonly Address: string
		readonly Name: string
	}>
	readonly Cc: ReadonlyArray<{
		readonly Address: string
		readonly Name: string
	}>
	readonly Bcc: ReadonlyArray<{
		readonly Address: string
		readonly Name: string
	}>
}

export async function clearMailpit(): Promise<void> {
	const res = await fetch(`${MAILPIT_HTTP_URL}/api/v1/messages`, {
		method: 'DELETE',
	})
	if (!res.ok) {
		throw new Error(`mailpit clear failed: ${res.status}`)
	}
}

export async function searchMailpit(
	query: string,
): Promise<ReadonlyArray<MailpitMessageSummary>> {
	const url = `${MAILPIT_HTTP_URL}/api/v1/search?query=${encodeURIComponent(query)}`
	const res = await fetch(url)
	if (!res.ok) {
		throw new Error(`mailpit search failed: ${res.status}`)
	}
	const body = (await res.json()) as MailpitSearchResponse
	return body.messages
}

export async function waitForMessage(
	query: string,
	{
		timeoutMs = 5_000,
		pollMs = 250,
	}: { timeoutMs?: number; pollMs?: number } = {},
): Promise<MailpitMessageSummary> {
	const deadline = Date.now() + timeoutMs
	let lastError: unknown = null
	while (Date.now() < deadline) {
		try {
			const messages = await searchMailpit(query)
			if (messages.length > 0) return messages[0]!
		} catch (err) {
			lastError = err
		}
		await new Promise(resolve => setTimeout(resolve, pollMs))
	}
	throw new Error(
		`mailpit: no message matching "${query}" within ${timeoutMs}ms${
			lastError ? ` (last error: ${String(lastError)})` : ''
		}`,
	)
}

export async function expectNoMessage(
	query: string,
	windowMs = 1_500,
): Promise<void> {
	await new Promise(resolve => setTimeout(resolve, windowMs))
	const messages = await searchMailpit(query)
	if (messages.length > 0) {
		throw new Error(
			`mailpit: expected no message matching "${query}", got ${messages.length}`,
		)
	}
}

export async function getMessage(id: string): Promise<MailpitMessageDetail> {
	const res = await fetch(`${MAILPIT_HTTP_URL}/api/v1/message/${id}`)
	if (!res.ok) {
		throw new Error(`mailpit get message ${id} failed: ${res.status}`)
	}
	return (await res.json()) as MailpitMessageDetail
}

export async function getRawMessage(id: string): Promise<string> {
	const res = await fetch(`${MAILPIT_HTTP_URL}/api/v1/message/${id}/raw`)
	if (!res.ok) {
		throw new Error(`mailpit get raw ${id} failed: ${res.status}`)
	}
	return res.text()
}
