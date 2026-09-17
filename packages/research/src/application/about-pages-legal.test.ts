import { describe, expect, it } from 'vitest'

import { isLegalNoticePath } from './about-pages'

describe('isLegalNoticePath, over the addresses a run cites', () => {
	it('should read a legal notice in the spellings the markets use', () => {
		// GIVEN the legal notice of a French, a Spanish, a German and an English site
		for (const url of [
			'https://www.verpack.fr/mentions-legales',
			'https://curtidosbadia.com/aviso-legal',
			'https://acme.de/impressum',
			'https://www.verpack.fr/en/legal-notice-privacy-policy',
		]) {
			expect(isLegalNoticePath(url), url).toBe(true)
		}
	})

	it('should not read a team page or a homepage as one', () => {
		// GIVEN pages that name people as staff
		for (const url of [
			'https://solagrupo.com/en/c/equipo-69',
			'https://acme.es/',
			'https://acme.es/nosotros',
			'https://acme.es/equipo?ref=legal-notice',
			'https://impressum-pflicht.de/equipo',
		]) {
			expect(isLegalNoticePath(url), url).toBe(false)
		}
	})
})
