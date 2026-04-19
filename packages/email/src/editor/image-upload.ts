// Hooks the editor's Image Upload API into Batuda's staged-attachment
// pipeline. Exposed as a small uploader object — paste/drop/slash
// callbacks in the editor wrapper call `upload(file)`, which:
//   1. POSTs the file to /v1/email/attachments/staging
//   2. receives { stagingId, previewUrl } back
//   3. returns those to the editor for node-attr population
// And `discard(stagingId)` which fires on node-remove:
//   1. DELETE /v1/email/attachments/staging/:stagingId
// Errors surface to the caller; the editor wrapper is responsible for
// removing the partially-inserted node on failure.

export interface StagedAttachmentResponse {
	readonly stagingId: string
	readonly previewUrl: string
	readonly filename: string
	readonly contentType: string
	readonly size: number
}

export interface UploadInput {
	readonly file: File | Blob
	readonly filename: string
	readonly contentType: string
	readonly inline: boolean
	readonly signal?: AbortSignal | undefined
}

export interface ImageUploaderConfig {
	readonly inboxId: string
	readonly endpoint: string
	readonly fetchImpl?: typeof fetch | undefined
	readonly maxBytes?: number | undefined
}

export interface ImageUploader {
	upload(input: UploadInput): Promise<StagedAttachmentResponse>
	discard(stagingId: string): Promise<void>
}

// 25 MB ceiling — matches email-attachment-staging. The server re-checks;
// the client-side check is purely to fail fast before uploading megabytes.
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024

export const createImageUploader = (
	config: ImageUploaderConfig,
): ImageUploader => {
	const f = config.fetchImpl ?? fetch
	const max = config.maxBytes ?? DEFAULT_MAX_BYTES

	return {
		async upload(input) {
			if (input.file.size === 0) {
				throw new Error('Cannot upload empty file')
			}
			if (input.file.size > max) {
				throw new Error(
					`File too large: ${input.file.size} bytes exceeds ${max}`,
				)
			}
			const body = new FormData()
			body.set('inbox_id', config.inboxId)
			body.set('filename', input.filename)
			body.set('content_type', input.contentType)
			body.set('inline', input.inline ? 'true' : 'false')
			body.set('file', input.file, input.filename)

			const init: RequestInit = { method: 'POST', body }
			if (input.signal) init.signal = input.signal
			const res = await f(config.endpoint, init)
			if (!res.ok) {
				const detail = await safeReadText(res)
				throw new Error(
					`Stage upload failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`,
				)
			}
			const json = (await res.json()) as StagedAttachmentResponse
			if (typeof json.stagingId !== 'string' || json.stagingId.length === 0) {
				throw new Error('Stage upload returned no stagingId')
			}
			return json
		},

		async discard(stagingId) {
			if (stagingId.length === 0) return
			const url = `${config.endpoint}/${encodeURIComponent(stagingId)}`
			// Best-effort — if the server is unreachable the TTL sweep
			// handles eventual cleanup. We still raise so the caller can
			// surface the error if they want to retry.
			const res = await f(url, { method: 'DELETE' })
			if (!res.ok && res.status !== 404) {
				const detail = await safeReadText(res)
				throw new Error(
					`Stage discard failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`,
				)
			}
		},
	}
}

const safeReadText = async (res: Response): Promise<string> => {
	try {
		return await res.text()
	} catch {
		return ''
	}
}
