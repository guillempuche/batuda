import { describe, expect, it } from 'vitest'

import { LANG_CODES, type LangCode } from '@batuda/domain'

import {
	magicLinkEmail,
	memberAddedEmail,
	resetPasswordEmail,
	resolveLang,
} from './transactional-email-templates.js'

// Every system email is rendered from these records, keyed by the language
// stored on the recipient's account. Two things are worth pinning: that every
// language we claim to serve actually renders every message, and that a value
// which is not a language cannot turn a lookup into something that is not a
// template.

const SIGN_IN_URL = 'https://batuda.co/login'
const LINK_URL = 'https://api.batuda.co/auth/magic-link/verify?token=abc'
const EXPIRES_AT = new Date('2026-06-01T00:00:00Z')

describe('resolveLang', () => {
	describe('when the value is a language we serve', () => {
		it('should return it unchanged', () => {
			// GIVEN each supported code
			// WHEN resolved
			// THEN it comes back as itself
			for (const code of LANG_CODES) {
				expect(resolveLang(code)).toBe(code)
			}
		})
	})

	describe('when the value is absent', () => {
		it('should fall back to English', () => {
			// GIVEN an account that never had a language chosen
			// WHEN resolved
			// THEN English stands in
			expect(resolveLang(null)).toBe('en')
			expect(resolveLang(undefined)).toBe('en')
			expect(resolveLang('')).toBe('en')
		})
	})

	describe('when the value is a key that exists on every object', () => {
		it('should still fall back rather than resolve to a non-template', () => {
			// GIVEN values that index into an object literal's prototype chain —
			// the column is plain text, so anything can end up in it
			// WHEN resolved
			// THEN they are treated as "no language chosen"
			expect(resolveLang('__proto__')).toBe('en')
			expect(resolveLang('constructor')).toBe('en')
			expect(resolveLang('toString')).toBe('en')
			expect(resolveLang('es')).toBe('en')
		})
	})
})

describe('transactional email templates', () => {
	describe('when rendering in every language we serve', () => {
		it('should produce a complete sign-in message for each', () => {
			// GIVEN each supported language
			for (const lang of LANG_CODES) {
				// WHEN the sign-in message is rendered
				const rendered = magicLinkEmail[lang](LINK_URL)

				// THEN every part is present, carries the link, and says nothing
				// is left `undefined` by a missing interpolation
				expect(rendered.subject.length, `${lang} subject`).toBeGreaterThan(0)
				expect(rendered.text, `${lang} body`).toContain(LINK_URL)
				expect(rendered.html, `${lang} html`).toContain(LINK_URL)
				expect(rendered.subject).not.toContain('undefined')
				expect(rendered.text).not.toContain('undefined')
			}
		})

		it('should produce a complete password-reset message for each', () => {
			// GIVEN each supported language
			for (const lang of LANG_CODES) {
				// WHEN the reset message is rendered
				const rendered = resetPasswordEmail[lang](LINK_URL, EXPIRES_AT)

				// THEN it carries the link and the deadline the reader needs
				expect(rendered.subject.length, `${lang} subject`).toBeGreaterThan(0)
				expect(rendered.text, `${lang} body`).toContain(LINK_URL)
				expect(rendered.text, `${lang} expiry`).toContain(
					EXPIRES_AT.toISOString(),
				)
				expect(rendered.html).toContain(LINK_URL)
				expect(rendered.text).not.toContain('undefined')
			}
		})

		it('should produce a complete added-to-organization message for each', () => {
			// GIVEN each supported language
			for (const lang of LANG_CODES) {
				// WHEN the welcome message is rendered
				const rendered = memberAddedEmail[lang]({
					addedByName: 'Alice Admin',
					organizationName: 'Taller Demo',
					signInUrl: SIGN_IN_URL,
				})

				// THEN it names who added them and where to sign in
				expect(rendered.subject, `${lang} subject`).toContain('Taller Demo')
				expect(rendered.text, `${lang} body`).toContain('Alice Admin')
				expect(rendered.text, `${lang} sign-in link`).toContain(SIGN_IN_URL)
				expect(rendered.text).not.toContain('undefined')
			}
		})
	})

	describe('when the languages are compared to each other', () => {
		it('should not leave a translation identical to the English source', () => {
			// GIVEN the non-source languages
			const others = LANG_CODES.filter(
				(code): code is LangCode => code !== 'en',
			)

			// WHEN each is rendered alongside English
			for (const lang of others) {
				// THEN the wording actually differs — a copy-paste that forgot to
				// translate is otherwise invisible
				expect(magicLinkEmail[lang](LINK_URL).subject).not.toBe(
					magicLinkEmail.en(LINK_URL).subject,
				)
				expect(resetPasswordEmail[lang](LINK_URL, EXPIRES_AT).subject).not.toBe(
					resetPasswordEmail.en(LINK_URL, EXPIRES_AT).subject,
				)
			}
		})
	})

	describe('when the welcome message is rendered', () => {
		it('should carry no way into the account', () => {
			// GIVEN a rendered welcome message in each language
			for (const lang of LANG_CODES) {
				const rendered = memberAddedEmail[lang]({
					addedByName: 'Alice Admin',
					organizationName: 'Taller Demo',
					signInUrl: SIGN_IN_URL,
				})

				// WHEN it is inspected for anything credential-shaped
				// THEN there is none — this is what lets the message sit unread
				// indefinitely without becoming a way in for whoever finds it
				for (const part of [rendered.subject, rendered.text, rendered.html]) {
					expect(part).not.toMatch(/token=/)
					expect(part).not.toMatch(/magic-link\/verify/)
				}
			}
		})
	})

	describe('when a name contains ordinary punctuation', () => {
		it('should show it to the reader unchanged in the subject', () => {
			// GIVEN an organization whose real name has an apostrophe and an
			// ampersand — nothing hostile, just a normal name
			for (const lang of LANG_CODES) {
				const rendered = memberAddedEmail[lang]({
					addedByName: 'Alice',
					organizationName: "O'Brien & Co",
					signInUrl: SIGN_IN_URL,
				})

				// WHEN the subject is read
				// THEN it reads as written, not as entities
				expect(rendered.subject).toContain("O'Brien & Co")
			}
		})
	})

	describe('when a name contains a line break', () => {
		it('should not let it split the subject header', () => {
			// GIVEN a display name carrying CRLF, which in a raw header would let
			// the value add headers of its own
			for (const lang of LANG_CODES) {
				const rendered = memberAddedEmail[lang]({
					addedByName: 'Alice\r\nBcc: someone@evil.test',
					organizationName: 'Taller',
					signInUrl: SIGN_IN_URL,
				})

				// WHEN the subject is inspected
				// THEN it is a single line
				expect(rendered.subject).not.toMatch(/[\r\n]/)
			}
		})
	})

	describe('when a name contains markup', () => {
		it('should escape it in the subject and html but leave the text body raw', () => {
			// GIVEN an organization name carrying a tag — display names are
			// user-editable, and some clients render markup in a preview pane
			const hostile = '</p><img src=x onerror=alert(1)>'

			// WHEN the welcome message is rendered in each language
			for (const lang of LANG_CODES) {
				const rendered = memberAddedEmail[lang]({
					addedByName: 'Alice',
					organizationName: hostile,
					signInUrl: SIGN_IN_URL,
				})

				// THEN neither the subject nor the html carries it raw
				expect(rendered.subject).not.toContain('<img src=x onerror=')
				expect(rendered.html).not.toContain('<img src=x onerror=')
				expect(rendered.html).toContain('&lt;img src=x onerror=')

				// AND the subject is cleaned rather than HTML-escaped — a header is
				// not markup, so entities there would be shown to the reader
				expect(rendered.subject).not.toContain('&lt;')
				expect(rendered.subject).not.toContain('&amp;')

				// AND the plain-text body keeps it verbatim: it is never parsed as
				// markup, so escaping there would only show the reader entities
				expect(rendered.text).toContain(hostile)
			}
		})
	})
})
