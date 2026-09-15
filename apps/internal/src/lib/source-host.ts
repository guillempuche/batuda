// The host a page address points at, for a source shown as a short link.
export function sourceHost(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '')
	} catch {
		return url
	}
}
