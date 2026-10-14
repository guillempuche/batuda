import { describe, expect, it, vi } from 'vitest'

// The app server-renders on Cloudflare Workers, where there is no DOM.
// DOMPurify built without a window hands back an object that says it is not
// supported and has none of its methods — calling `addHook` on it threw and
// took the whole thread page's server render down. This stands in for that
// object.
vi.mock('isomorphic-dompurify', () => ({
	default: { isSupported: false },
}))

const { sanitizeEmailHtml } = await import('./sanitize-email')

describe('sanitizeEmailHtml', () => {
	describe('when there is no DOM to sanitize with', () => {
		it('should return nothing rather than throw or pass the HTML through', () => {
			// GIVEN mail HTML carrying a script
			const dirty = '<p>Hello</p><script>alert(1)</script>'

			// WHEN it is sanitized where DOMPurify cannot run
			const clean = sanitizeEmailHtml(dirty)

			// THEN nothing unsanitized comes back, so the caller shows the text body
			expect(clean).toBe('')
		})
	})
})
