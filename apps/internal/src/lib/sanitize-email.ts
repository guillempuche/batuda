import DOMPurify from 'isomorphic-dompurify'

/**
 * Sanitizes inbound email HTML for display. Uses DOMPurify with the
 * default HTML profile (strips <script>, inline event handlers,
 * `javascript:` URIs, etc.) and forces every surviving <a> to open
 * in a new tab with `rel="noopener noreferrer"`.
 *
 * Browser only. The app server-renders on Cloudflare Workers, where there is
 * no DOM and DOMPurify comes back without its methods; there this returns an
 * empty string rather than anything unsanitized, and the caller falls back to
 * the plain-text body.
 */

let hooksRegistered = false

function registerHooks(): void {
	if (hooksRegistered) return
	hooksRegistered = true
	DOMPurify.addHook('afterSanitizeAttributes', node => {
		if (!(node instanceof Element)) return
		if (node.tagName === 'A') {
			node.setAttribute('target', '_blank')
			node.setAttribute('rel', 'noopener noreferrer')
		}
	})
}

const ALLOWED_TAGS = [
	'a',
	'b',
	'blockquote',
	'br',
	'code',
	'div',
	'em',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'hr',
	'i',
	'img',
	'li',
	'ol',
	'p',
	'pre',
	'q',
	's',
	'span',
	'strike',
	'strong',
	'sub',
	'sup',
	'table',
	'tbody',
	'td',
	'th',
	'thead',
	'tr',
	'u',
	'ul',
]

const ALLOWED_ATTR = [
	'alt',
	'cite',
	'colspan',
	'href',
	'rel',
	'rowspan',
	'src',
	'style',
	'target',
	'title',
]

export function sanitizeEmailHtml(dirty: string): string {
	if (!DOMPurify.isSupported) return ''
	registerHooks()
	return DOMPurify.sanitize(dirty, {
		ALLOWED_TAGS,
		ALLOWED_ATTR,
		ALLOW_DATA_ATTR: false,
		FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
		FORBID_ATTR: ['srcset'],
	})
}
