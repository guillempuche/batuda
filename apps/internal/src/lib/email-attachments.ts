/**
 * Staging upload for email attachments. The compose form uploads each
 * selected file individually and receives a `stagingId` back; when the
 * user hits Send, the IDs are forwarded to `email.send` / `email.reply`
 * so the server can stream the bytes to the mail provider without a
 * multipart send payload.
 */
export type StagedAttachment = {
	readonly stagingId: string
	readonly filename: string
	readonly contentType: string
	readonly size: number
}

const SERVER_URL =
	import.meta.env['VITE_SERVER_URL'] ?? 'https://api.batuda.localhost'

export async function uploadAttachment(
	file: File,
	options?: { readonly signal?: AbortSignal },
): Promise<StagedAttachment> {
	const body = new FormData()
	body.append('file', file, file.name)
	const response = await fetch(`${SERVER_URL}/v1/email/attachments/staging`, {
		method: 'POST',
		credentials: 'include',
		body,
		...(options?.signal !== undefined && { signal: options.signal }),
	})
	if (!response.ok) {
		const message = await extractError(response)
		throw new Error(message)
	}
	const json = (await response.json()) as unknown
	if (!isStagingResponse(json)) {
		throw new Error('Unexpected staging response shape')
	}
	return {
		stagingId: json.stagingId,
		filename: json.filename,
		contentType: json.contentType,
		size: json.size,
	}
}

export function downloadUrlFor(
	messageId: string,
	attachmentId: string,
): string {
	return `${SERVER_URL}/v1/email/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/download`
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function extractError(response: Response): Promise<string> {
	try {
		const data = (await response.json()) as { message?: string }
		return data.message ?? `Upload failed with status ${response.status}`
	} catch {
		return `Upload failed with status ${response.status}`
	}
}

function isStagingResponse(value: unknown): value is {
	stagingId: string
	filename: string
	contentType: string
	size: number
} {
	if (value === null || typeof value !== 'object') return false
	const r = value as Record<string, unknown>
	return (
		typeof r['stagingId'] === 'string' &&
		typeof r['filename'] === 'string' &&
		typeof r['contentType'] === 'string' &&
		typeof r['size'] === 'number'
	)
}
