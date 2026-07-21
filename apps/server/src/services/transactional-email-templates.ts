import { isLangCode, type LangCode } from '@batuda/domain'

// Wording for every system email, in each language Batuda serves. Kept apart
// from the sending code so the two providers — real delivery, and the local
// folder a developer reads — always say the same thing. Plain records rather
// than a translation library: three messages do not justify an extraction and
// build step on the server.

const FALLBACK_LANG: LangCode = 'en'

/**
 * Picks the language to write in. The stored value is an ordinary text column
 * that can hold anything, and reaching into the records below with an
 * unchecked key lands on things that are not templates at all (`__proto__`),
 * which sends a broken email rather than none. Anything unrecognised reads as
 * "no preference".
 */
export const resolveLang = (value: string | null | undefined): LangCode =>
	isLangCode(value) ? value : FALLBACK_LANG

/**
 * Cleans a value going into the Subject line. A subject is a mail header, not
 * markup, so escaping it the way the HTML body is escaped would show readers
 * `O&#39;Brien &amp; Co` instead of their own organization's name. What a
 * header genuinely must not carry is a line break — that would let a display
 * name add headers of its own — or a tag that a preview pane might render.
 */
export const sanitizeSubject = (value: string): string =>
	value.replace(/[\r\n]+/g, ' ').replace(/[<>]/g, '')

/** Escapes the fields a mail client parses as markup. */
export const escapeHtml = (value: string): string =>
	value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')

export interface RenderedEmail {
	readonly subject: string
	readonly text: string
	readonly html: string
}

// ── Sign-in link ──

// The five minutes is Better Auth's magic-link lifetime. Saying it plainly
// matters: someone who opens their mail an hour later needs to know the link
// is dead because it aged out, not because something is broken.
export const magicLinkEmail: Record<LangCode, (url: string) => RenderedEmail> =
	{
		en: url => ({
			subject: 'Sign in to Batuda',
			text: [
				'Click the link below to sign in:',
				'',
				url,
				'',
				'The link works for 5 minutes. If it has expired, ask for a new one from the sign-in page.',
			].join('\n'),
			html: [
				'<p>Click the link below to sign in:</p>',
				`<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`,
				'<p style="color:#666">The link works for 5 minutes. If it has expired, ask for a new one from the sign-in page.</p>',
			].join(''),
		}),
		ca: url => ({
			subject: 'Inicia la sessió a Batuda',
			text: [
				'Fes clic a l’enllaç per iniciar la sessió:',
				'',
				url,
				'',
				'L’enllaç funciona durant 5 minuts. Si ha caducat, demana’n un de nou des de la pàgina d’inici de sessió.',
			].join('\n'),
			html: [
				'<p>Fes clic a l’enllaç per iniciar la sessió:</p>',
				`<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`,
				'<p style="color:#666">L’enllaç funciona durant 5 minuts. Si ha caducat, demana’n un de nou des de la pàgina d’inici de sessió.</p>',
			].join(''),
		}),
	}

// ── Password reset ──

export const resetPasswordEmail: Record<
	LangCode,
	(url: string, expiresAt: Date) => RenderedEmail
> = {
	en: (url, expiresAt) => ({
		subject: 'Reset your Batuda password',
		text: [
			'Click the link below to choose a new password:',
			'',
			url,
			'',
			`This link expires at ${expiresAt.toISOString()}. If you didn’t ask for a reset, you can ignore this email.`,
		].join('\n'),
		html: [
			'<p>Click the link below to choose a new password:</p>',
			`<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`,
			`<p style="color:#666">This link expires at ${escapeHtml(expiresAt.toISOString())}. If you didn’t ask for a reset, you can ignore this email.</p>`,
		].join(''),
	}),
	ca: (url, expiresAt) => ({
		subject: 'Restableix la contrasenya de Batuda',
		text: [
			'Fes clic a l’enllaç per triar una contrasenya nova:',
			'',
			url,
			'',
			`Aquest enllaç caduca a les ${expiresAt.toISOString()}. Si no has demanat cap canvi, pots ignorar aquest correu.`,
		].join('\n'),
		html: [
			'<p>Fes clic a l’enllaç per triar una contrasenya nova:</p>',
			`<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`,
			`<p style="color:#666">Aquest enllaç caduca a les ${escapeHtml(expiresAt.toISOString())}. Si no has demanat cap canvi, pots ignorar aquest correu.</p>`,
		].join(''),
	}),
}

// ── Added to an organization ──

export interface MemberAddedCopy {
	readonly addedByName: string
	readonly organizationName: string
	readonly signInUrl: string
}

// Carries no way into the account on purpose. The reader signs in themselves
// and asks for their own link, so this message can sit unread for a month and
// still be true. Both names are whatever people typed, so the subject is
// cleaned and the HTML body escaped; the plain-text body keeps them verbatim
// because nothing parses it as markup.
export const memberAddedEmail: Record<
	LangCode,
	(copy: MemberAddedCopy) => RenderedEmail
> = {
	en: ({ addedByName, organizationName, signInUrl }) => ({
		subject: `${sanitizeSubject(addedByName)} added you to ${sanitizeSubject(organizationName)} on Batuda`,
		text: [
			`${addedByName} added you to ${organizationName} on Batuda.`,
			'',
			'Sign in with this email address to get started:',
			'',
			signInUrl,
			'',
			'There is nothing to accept and no link that expires — sign in whenever you are ready.',
		].join('\n'),
		html: [
			`<p>${escapeHtml(addedByName)} added you to <strong>${escapeHtml(organizationName)}</strong> on Batuda.</p>`,
			'<p>Sign in with this email address to get started.</p>',
			`<p><a href="${escapeHtml(signInUrl)}">${escapeHtml(signInUrl)}</a></p>`,
			'<p style="color:#666">There is nothing to accept and no link that expires — sign in whenever you are ready.</p>',
		].join(''),
	}),
	ca: ({ addedByName, organizationName, signInUrl }) => ({
		subject: `${sanitizeSubject(addedByName)} t’ha afegit a ${sanitizeSubject(organizationName)} a Batuda`,
		text: [
			`${addedByName} t’ha afegit a ${organizationName} a Batuda.`,
			'',
			'Inicia la sessió amb aquesta adreça per començar:',
			'',
			signInUrl,
			'',
			'No hi ha res a acceptar ni cap enllaç que caduqui: inicia la sessió quan vulguis.',
		].join('\n'),
		html: [
			`<p>${escapeHtml(addedByName)} t’ha afegit a <strong>${escapeHtml(organizationName)}</strong> a Batuda.</p>`,
			'<p>Inicia la sessió amb aquesta adreça per començar.</p>',
			`<p><a href="${escapeHtml(signInUrl)}">${escapeHtml(signInUrl)}</a></p>`,
			'<p style="color:#666">No hi ha res a acceptar ni cap enllaç que caduqui: inicia la sessió quan vulguis.</p>',
		].join(''),
	}),
}
