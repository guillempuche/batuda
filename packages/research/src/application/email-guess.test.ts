import { describe, expect, it } from 'vitest'

import { guessEmails, splitPersonName } from './email-guess'
import { collapse } from './entity-guard'

describe('guessEmails', () => {
	describe('when given a full first and last name', () => {
		it('should lead with first.last and include the common variants', () => {
			// GIVEN a normal two-part name at a domain
			// WHEN candidates are generated
			// THEN the most common B2B pattern (first.last) comes first
			const result = guessEmails({
				firstName: 'Jane',
				lastName: 'Smith',
				domain: 'acme.com',
			})
			expect(result[0]).toBe('jane.smith@acme.com')
			// AND the standard alternates are present
			expect(result).toContain('jsmith@acme.com')
			expect(result).toContain('janesmith@acme.com')
			expect(result).toContain('jane@acme.com')
		})

		it('should never repeat a candidate', () => {
			// GIVEN any name
			// THEN every generated address is unique
			const result = guessEmails({
				firstName: 'Ann',
				lastName: 'Lee',
				domain: 'x.io',
			})
			expect(new Set(result).size).toBe(result.length)
		})
	})

	describe('when a vendor pattern is supplied', () => {
		it('should try the supplied pattern before the defaults', () => {
			// GIVEN a detected pattern that differs from the default head
			// WHEN candidates are generated
			// THEN the patterned address is produced first
			const result = guessEmails({
				firstName: 'Jane',
				lastName: 'Smith',
				domain: 'acme.com',
				pattern: '{f}.{last}',
			})
			expect(result[0]).toBe('j.smith@acme.com')
		})

		it('should skip a supplied pattern whose tokens are missing', () => {
			// GIVEN a vendor pattern that needs {last} but only a first name is known
			// WHEN candidates are generated
			// THEN that pattern is dropped (no dangling 'jane.@domain'), and the
			// fallback single-token address leads instead
			// [email-guess.ts — applyPattern returns null on a missing token]
			const result = guessEmails({
				firstName: 'Jane',
				lastName: '',
				domain: 'acme.com',
				pattern: '{first}.{last}',
			})
			expect(result).toEqual(['jane@acme.com'])
		})
	})

	describe('when the name carries accents or punctuation', () => {
		it('should fold diacritics and drop non-letters from the local part', () => {
			// GIVEN an accented first name and an apostrophe in the last name
			// THEN the local part is ascii-folded and symbol-free
			const result = guessEmails({
				firstName: 'José',
				lastName: "O'Néil",
				domain: 'corp.es',
			})
			expect(result[0]).toBe('jose.oneil@corp.es')
		})

		it('should build the local part the way the guards read a name', () => {
			// GIVEN a spread of names across the alphabets this product is asked about
			// WHEN each is guessed at
			// THEN the local part is exactly what the shared reading makes of the
			// name. Asserted against that reading rather than against addresses I
			// wrote out, because the way this broke before was somebody keeping a
			// second copy of the reading here that agreed on the names in the tests
			// and differed everywhere else
			for (const name of [
				'Straßer',
				'Þór',
				'Nørgaard',
				'Łukasz',
				'Işık',
				'Núñez',
				'Müller',
				'Smith',
			]) {
				expect(
					guessEmails({
						firstName: name,
						lastName: '',
						domain: 'corp.example',
					})[0],
				).toBe(`${collapse(name)}@corp.example`)
			}
		})

		it('should write out a letter that is not an accented a–z one', () => {
			// GIVEN people whose names carry a letter that taking an accent off
			// cannot turn into a plain one — the German ß, the Icelandic þ, the
			// Nordic ø, the Polish ł, the dotless Turkish ı
			// WHEN their work addresses are guessed
			// THEN each letter is written as the letters it stands for. Dropped
			// instead, these read "straer", "or", "nrgaard", "ukasz" and "isk" — and
			// an address a guess is wrong about is one somebody then sends to
			for (const [firstName, lastName, expected] of [
				['Anna', 'Straßer', 'anna.strasser@corp.de'],
				['Þór', 'Jónsson', 'thor.jonsson@corp.de'],
				['Lars', 'Nørgaard', 'lars.norgaard@corp.de'],
				['Łukasz', 'Nowak', 'lukasz.nowak@corp.de'],
				['Işık', 'Demir', 'isik.demir@corp.de'],
			] as const) {
				expect(guessEmails({ firstName, lastName, domain: 'corp.de' })[0]).toBe(
					expected,
				)
			}
		})
	})

	describe('when only one name token is known', () => {
		it('should emit only the single-token address, no dangling separators', () => {
			// GIVEN a first name but no last name
			// THEN patterns needing {last}/{l} are skipped, leaving first@domain
			const result = guessEmails({
				firstName: 'Madonna',
				lastName: '',
				domain: 'star.fm',
			})
			expect(result).toEqual(['madonna@star.fm'])
		})
	})

	describe('when the input is degenerate', () => {
		it('should return nothing without a domain', () => {
			// GIVEN an empty domain
			// THEN there is nothing to guess
			expect(
				guessEmails({ firstName: 'Jane', lastName: 'Smith', domain: '' }),
			).toEqual([])
		})

		it('should return nothing without any name', () => {
			// GIVEN neither first nor last name
			// THEN there is nothing to guess
			expect(
				guessEmails({ firstName: '', lastName: '', domain: 'acme.com' }),
			).toEqual([])
		})

		it('should return nothing when a non-latin name normalizes to empty', () => {
			// GIVEN a name written in a script with no latin letters (CJK here)
			// WHEN candidates are generated
			// THEN normalization strips every token to empty and nothing is
			// guessable from a pattern — the universal pipeline yields no address
			// for this name and must lean on a vendor-supplied email instead
			// [collapse drops anything outside a-z0-9; guard !first && !last]
			expect(
				guessEmails({ firstName: '李', lastName: '王', domain: 'acme.cn' }),
			).toEqual([])
		})

		it('should normalize away a leading @ on the domain', () => {
			// GIVEN a domain written with a leading @
			// THEN it is stripped before building the address
			const result = guessEmails({
				firstName: 'Jane',
				lastName: 'Smith',
				domain: '@acme.com',
			})
			expect(result[0]).toBe('jane.smith@acme.com')
		})

		it('should lowercase and trim a domain with stray case and whitespace', () => {
			// GIVEN a domain with surrounding whitespace and mixed case
			// THEN it is folded to a clean lowercase host before the @
			// [email-guess.ts — domain.trim().toLowerCase()]
			const result = guessEmails({
				firstName: 'Jane',
				lastName: 'Smith',
				domain: '  ACME.COM  ',
			})
			expect(result[0]).toBe('jane.smith@acme.com')
		})
	})
})

describe('splitPersonName', () => {
	describe('when the name is "SURNAME, Forename" (registry shape)', () => {
		it('should map the part after the comma to the first name', () => {
			// GIVEN a Companies House style officer name
			// THEN surname/forename are un-swapped
			expect(splitPersonName('SMITH, Jane')).toEqual({
				firstName: 'Jane',
				lastName: 'SMITH',
			})
		})

		it('should take only the first given name when several follow', () => {
			// GIVEN multiple forenames after the comma
			// THEN only the first is used (best guess for an email local part)
			expect(splitPersonName('PATEL, Arjun Kumar')).toEqual({
				firstName: 'Arjun',
				lastName: 'PATEL',
			})
		})
	})

	describe('when the name is plain "First Last"', () => {
		it('should take the first and last tokens', () => {
			// GIVEN a normal display name
			expect(splitPersonName('Jane Smith')).toEqual({
				firstName: 'Jane',
				lastName: 'Smith',
			})
		})

		it('should treat the final token as the surname when a middle name exists', () => {
			// GIVEN a three-part name
			expect(splitPersonName('Jane Q Smith')).toEqual({
				firstName: 'Jane',
				lastName: 'Smith',
			})
		})
	})

	describe('when the name is degenerate', () => {
		it('should leave the surname empty for a single token', () => {
			// GIVEN one word
			expect(splitPersonName('Madonna')).toEqual({
				firstName: 'Madonna',
				lastName: '',
			})
		})

		it('should return empties for a blank name', () => {
			// GIVEN whitespace only
			expect(splitPersonName('   ')).toEqual({ firstName: '', lastName: '' })
		})
	})
})

describe('splitting a name that may carry two surnames', () => {
	describe('when the company is in a Spanish-speaking country', () => {
		it('should use the surname the person is actually called by', () => {
			// GIVEN ordinary names from this market, where the father's surname comes
			// first and the mother's second
			// WHEN split
			// THEN the first of the two is what comes back. Taking the last word gives
			// the mother's surname, which is neither what the person is called nor how
			// their address is built
			expect(splitPersonName('María García López', 'ES')).toEqual({
				firstName: 'María',
				lastName: 'García',
			})
			expect(splitPersonName('Guillem Puche Sanz', 'ES')).toEqual({
				firstName: 'Guillem',
				lastName: 'Puche',
			})
			expect(splitPersonName('Carlos Ruiz Mendoza', 'MX')).toEqual({
				firstName: 'Carlos',
				lastName: 'Ruiz',
			})
		})

		it('should read a name whose two surnames are joined by a little word', () => {
			// GIVEN the Catalan shape, where "i" sits between the two surnames
			// WHEN split
			// THEN the joining word belongs to neither and the first surname stands
			expect(splitPersonName('Jordi Pujol i Soley', 'ES')).toEqual({
				firstName: 'Jordi',
				lastName: 'Pujol',
			})
		})

		it('should keep a surname whole when it opens with a little word', () => {
			// GIVEN a surname of several words, as many here are
			// WHEN split
			// THEN it comes back whole rather than cut at its first word
			expect(splitPersonName('Ana de la Torre Ruiz', 'ES')).toEqual({
				firstName: 'Ana',
				lastName: 'de la Torre',
			})
		})

		it('should not be fooled by a given name of two words', () => {
			// GIVEN a compound given name, which is ordinary here
			// WHEN split
			// THEN still the first surname. The two surnames sit at the end whatever
			// the given name is, so nothing has to count the words in front of them
			expect(splitPersonName('José María García López', 'ES')).toEqual({
				firstName: 'José',
				lastName: 'García',
			})
		})

		it('should leave a name carrying only one surname alone', () => {
			// GIVEN a two-word name
			// WHEN split
			// THEN the one surname it has. Two surnames is the norm, not a rule
			expect(splitPersonName('Ada Lovelace', 'ES')).toEqual({
				firstName: 'Ada',
				lastName: 'Lovelace',
			})
		})
	})

	describe('when the country reads its surnames the other way round', () => {
		it('should take the last word as the surname', () => {
			// GIVEN Portugal and Brazil, which also carry two surnames but put the
			// mother's first and the father's last, and a country with one surname
			// WHEN split
			// THEN the last word, which is right for all three
			expect(splitPersonName('João Silva Santos', 'PT')).toEqual({
				firstName: 'João',
				lastName: 'Santos',
			})
			expect(splitPersonName('Mary Jane Watson', 'US')).toEqual({
				firstName: 'Mary',
				lastName: 'Watson',
			})
		})
	})

	describe('when no country is known', () => {
		it('should fall back to the last word', () => {
			// GIVEN no country to settle it. "María García López" and "Mary Jane
			// Watson" are the same shape, and nothing in either says which it is
			// WHEN split
			// THEN the last word — a guess at the country would be a guess at the
			// answer
			expect(splitPersonName('María García López')).toEqual({
				firstName: 'María',
				lastName: 'López',
			})
			expect(splitPersonName('Mary Jane Watson')).toEqual({
				firstName: 'Mary',
				lastName: 'Watson',
			})
		})
	})

	describe('when the name arrives the way a register writes it', () => {
		it('should pick the same surname as it would from the plain shape', () => {
			// GIVEN the "SURNAME, Forename" shape a register hands back. It says which
			// words are surnames, but not which of them the person goes by
			const fromRegister = splitPersonName('GARCÍA LÓPEZ, María', 'ES')
			const fromPlain = splitPersonName('María García López', 'ES')

			// WHEN both are read
			// THEN the same woman comes back the same way. She was arriving as
			// garcialopez@ from the register and garcia@ from a page, and only one of
			// those reaches her
			expect(fromRegister.lastName).toBe('GARCÍA')
			expect(guessEmails({ ...fromRegister, domain: 'acme.es' })[0]).toBe(
				guessEmails({ ...fromPlain, domain: 'acme.es' })[0],
			)
		})

		it('should leave the surnames whole where they are read the other way', () => {
			// GIVEN the same shape from countries that do not put the father's
			// surname first
			// WHEN read
			// THEN what the register gave stands, as it always did
			expect(splitPersonName('SMITH, John', 'GB').lastName).toBe('SMITH')
			expect(splitPersonName('SILVA SANTOS, João', 'PT').lastName).toBe(
				'SILVA SANTOS',
			)
			expect(splitPersonName('VAN DEN BERG, Jan', 'NL').lastName).toBe(
				'VAN DEN BERG',
			)
		})
	})

	describe('when a little word carries a surname', () => {
		it('should keep the surname whole rather than cut off its opening', () => {
			// GIVEN names whose surname opens with a little word
			// WHEN split
			// THEN the whole surname. Taking the last word alone addressed Jan van den
			// Berg as jan.berg@, which is not his name
			expect(splitPersonName('Jan van den Berg').lastName).toBe('van den Berg')
			expect(splitPersonName('Ludwig von Mises').lastName).toBe('von Mises')
		})

		it('should treat the same word as a first name when it opens one', () => {
			// GIVEN people whose given name is spelled like one of those little words
			// WHEN split
			// THEN it is their first name. Carried onto what follows, Van Morrison
			// became one long first name with no surname at all, and no address could
			// be built for him
			expect(splitPersonName('Van Morrison')).toEqual({
				firstName: 'Van',
				lastName: 'Morrison',
			})
			expect(splitPersonName('Do Kim')).toEqual({
				firstName: 'Do',
				lastName: 'Kim',
			})
		})
	})

	describe('when the addresses are guessed from it', () => {
		it('should build them on the surname the person goes by', () => {
			// GIVEN a Spanish name at a Spanish company
			const name = splitPersonName('María García López', 'ES')

			// WHEN addresses are guessed
			// THEN they are built on García. Only the first guess is ever tried, and a
			// wrong one fails its check and leaves the person with no address at all
			expect(guessEmails({ ...name, domain: 'acme.es' })[0]).toBe(
				'maria.garcia@acme.es',
			)
		})
	})
})
