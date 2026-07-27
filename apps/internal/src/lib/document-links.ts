import { apiBaseUrl } from '#/lib/api-base'

/**
 * Where an HTML document opens: an address that never changes, checked on every
 * visit, which forwards to a storage link that expires.
 *
 * Relative in dev for the reason `downloadUrlFor` spells out: this goes into an
 * `<a href>` during SSR, and the dev value of `apiBaseUrl()` is a loopback
 * address the browser would not send the session cookie to.
 */
export function documentOpenUrl(documentId: string): string {
	const base =
		typeof import.meta !== 'undefined' && import.meta.env?.DEV
			? ''
			: apiBaseUrl()
	return `${base}/v1/documents/${encodeURIComponent(documentId)}/open`
}
