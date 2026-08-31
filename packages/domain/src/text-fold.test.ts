import { describe, expect, it } from 'vitest'

import { companySlugFromName, foldLabel, slugFromLabel } from './text-fold'

describe('foldLabel', () => {
	describe('when the same trade is written several ways', () => {
		it('should fold the spellings onto one another', () => {
			// GIVEN one trade typed by three people
			for (const written of [
				'Metal fabrication',
				'metal Fabrication',
				'  METAL   FABRICATION  ',
				'Metal-fabrication',
			]) {
				// THEN they all compare as the same trade
				expect(foldLabel(written), written).toBe('metal fabrication')
			}
		})

		it('should ignore accents', () => {
			// GIVEN the Catalan and the plain spelling of one word
			expect(foldLabel('Fabricació')).toBe(foldLabel('Fabricacio'))
		})

		it('should turn punctuation into a single space', () => {
			expect(foldLabel('Import / Export, S.L.')).toBe('import export s l')
		})

		it('should read the Catalan geminate as one word', () => {
			// GIVEN "metal·lúrgia", where l·l is a single letter rather than two words
			// WHEN it is folded
			// THEN the middle dot goes without leaving a gap, so it compares equal to
			//      the same trade typed without it
			expect(foldLabel('Metal·lúrgia')).toBe('metallurgia')
			expect(foldLabel('Metal·lúrgia')).toBe(foldLabel('metallurgia'))
			expect(foldLabel('Instal·lacions elèctriques')).toBe(
				'installacions electriques',
			)
		})
	})

	describe('when the trade is not written in Latin letters', () => {
		// A narrower fold that keeps only a-z drops these to nothing. Stored under a
		// uniqueness rule, the first of them would claim the empty key and every one
		// after it would silently resolve to that same trade.
		it('should keep the letters rather than emptying the name', () => {
			// GIVEN trades in Japanese, Cyrillic, Greek and Arabic
			for (const written of ['物流', 'Логистика', 'Μεταφορές', 'حدادة']) {
				expect(foldLabel(written), written).not.toBe('')
			}
		})

		it('should still tell two of them apart', () => {
			expect(foldLabel('物流')).not.toBe(foldLabel('建設'))
		})
	})

	describe('when a letter is not an accented Latin one', () => {
		// ø, ß, ł and đ are single letters, not a letter with a mark added, so
		// stripping marks never reaches them and a a-z-only rule deletes them.
		it('should keep it', () => {
			expect(foldLabel('Tømrer')).toBe('tømrer')
			expect(foldLabel('Straßenbau')).toBe('straßenbau')
			expect(foldLabel('Stolarstwo drzwi łukowych')).toContain('łukowych')
		})
	})

	describe('when the name carries no letters or digits', () => {
		it('should fold to nothing, which a caller must refuse', () => {
			// GIVEN a name that is only punctuation — an empty fold would match every
			// other empty fold, so this is the value the write path has to turn away
			for (const written of ['...', '   ', '-', '/']) {
				expect(foldLabel(written), written).toBe('')
			}
		})
	})

	describe('when a mark over a letter is a letter of its own', () => {
		it('should keep two different words apart', () => {
			// GIVEN pairs that differ only by a mark, in writing systems where that
			// mark makes a DIFFERENT letter rather than decorating one
			// WHEN each pair is folded
			// THEN the two stay apart. Folding them together is not an untidy list: it
			// is a uniqueness rule handing back the wrong trade and reporting success
			for (const [one, other] of [
				['バス', 'ハス'], // bus, lotus — the Japanese voicing mark
				['がっこう', 'かっこう'], // school, cuckoo
				['мой', 'мои'], // my, my-plural — Russian й is its own letter
				['Йод', 'Иод'],
				['เขา', 'เข่า'], // he, knee — a Thai tone
				['सड़क', 'सडक'], // road — the Devanagari nukta
			] as const) {
				expect(foldLabel(one)).not.toBe(foldLabel(other))
			}
		})

		it('should read the letter underneath rather than the mark itself', () => {
			// GIVEN the same character, U+0306, over a Romanian letter and a Russian one
			// WHEN each is folded
			// THEN it comes off the Romanian letter and stays on the Russian one, which
			// is why the writing system is read off the letter and never off the mark
			expect(foldLabel('Comerț ă')).toBe(foldLabel('Comert a'))
			expect(foldLabel('й')).not.toBe(foldLabel('и'))
		})
	})

	describe('when a mark is decoration a reader could leave off', () => {
		it('should fold it away so either spelling finds the trade', () => {
			// GIVEN a Greek trade written with its accent, without it, and in the
			// capitals a shopfront uses, which carry no accent at all; and Arabic and
			// Hebrew written with the pointing that is normally left out
			// WHEN each group is folded
			// THEN one key per group
			for (const spellings of [
				['Μεταφορές', 'Μεταφορες', 'ΜΕΤΑΦΟΡΕΣ'],
				['مُحاسبة', 'محاسبة'],
				['שָׁלוֹם', 'שלום'],
				['أثاث', 'اثاث'],
			] as const) {
				expect(new Set(spellings.map(foldLabel)).size).toBe(1)
			}
		})
	})

	describe('when a mark is part of the word rather than over a letter', () => {
		it('should leave the word whole instead of cutting it into pieces', () => {
			// GIVEN trades written in scripts where a vowel is written as its own mark
			// WHEN each is folded
			// THEN each is still one word. Treating those marks as punctuation put a
			// space where the vowel stood, and a trade was stored as a handful of
			// consonant fragments no reader would ever type
			for (const trade of [
				'أثاث',
				'إنشاءات',
				'निर्माण',
				'परिवहन',
				'काम',
				'กัน',
			] as const) {
				expect(foldLabel(trade).split(' ')).toHaveLength(1)
			}
		})

		it('should ignore a mark left sitting in no word at all', () => {
			// GIVEN one trade typed with a stray mark between two of its words, which
			// is what a slipped keystroke leaves behind
			// WHEN folded
			// THEN the same key as the trade typed without it. A mark that sits ON a
			// letter is part of that letter and stays, but one sitting in no word is
			// part of no name — left in it becomes a word of its own, and the trade
			// typed cleanly is filed as a second one
			expect(foldLabel('Metal \u0e48 fabrication')).toBe(
				foldLabel('Metal fabrication'),
			)
			expect(foldLabel('\u0301Metal')).toBe(foldLabel('Metal'))
		})

		it('should fold a mark standing on its own to nothing', () => {
			// GIVEN marks with no letter underneath them
			// WHEN folded — THEN nothing, since a key naming nothing would match every
			// other key naming nothing
			for (const written of ['\u0E48', '\u0301', '\u3099', '\u0E48\u0E49'])
				expect(foldLabel(written)).toBe('')
		})
	})

	describe('when a name is written in Korean', () => {
		it('should put the letters back together rather than store their pieces', () => {
			// GIVEN a Korean name, whose letters come apart into the strokes they are
			// built from on the way through the fold
			// WHEN folded
			// THEN the letters are whole again, because a key written as those pieces
			// is one nobody typing the name would ever produce
			expect(foldLabel('서울')).toBe('서울')
			expect(foldLabel('김민준')).toBe('김민준')
		})
	})

	describe('when the name is written in Latin or Greek letters', () => {
		it('should fold every one of them exactly as it always has', () => {
			// GIVEN every Latin and Greek character there is, each inside a word
			// WHEN folded
			// THEN none of them folds differently than before. What this produces is
			// stored under a uniqueness rule, so this is the promise that lets the keys
			// already written go on meaning what they meant
			const latinOrGreek = /[\p{Script=Latin}\p{Script=Greek}]/u
			for (let point = 0x20; point <= 0x2fff; point++) {
				const letter = String.fromCodePoint(point)
				if (!latinOrGreek.test(letter)) continue
				expect(foldLabel(`a${letter}z`)).toBe(
					`a${letter}z`
						.normalize('NFD')
						.replace(/\p{Diacritic}/gu, '')
						.toLowerCase()
						.replace(/[^\p{L}\p{N}]+/gu, ' ')
						.trim(),
				)
			}
		})
	})

	describe('when folding something already folded', () => {
		it('should leave it alone', () => {
			// GIVEN the stored form is itself folded, and the backfill folds again
			for (const written of ['Metal fabrication', 'Fabricació', '物流']) {
				expect(foldLabel(foldLabel(written)), written).toBe(foldLabel(written))
			}
		})
	})
})

describe('slugFromLabel', () => {
	describe('when a trade is written for a web address', () => {
		it('should join the words with dashes', () => {
			expect(slugFromLabel('Metal fabrication')).toBe('metal-fabrication')
		})

		it('should read back as the same trade', () => {
			// GIVEN an assistant that reads a slug and writes the label back, the two
			// have to compare equal or it creates a second trade for the same thing
			expect(foldLabel('metal-fabrication')).toBe(
				foldLabel('Metal fabrication'),
			)
		})
	})
})

describe('companySlugFromName', () => {
	// A slug goes into a web address, so it holds plain a-z, digits and single
	// hyphens and nothing else. What a caller cannot do is work that out from a name
	// itself: writing the accent straight in has the whole batch refused, and
	// stripping what cannot be used leaves nothing at all for some names.
	const A_VALID_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

	// Characters chosen to attack a slug: path separators, web-address
	// punctuation, whitespace, a right-to-left override, a zero-width joiner, a
	// byte-order mark, an emoji, and letters from scripts that fold differently.
	const SLUG_HOSTILE_CHARACTERS = [
		...'../\\<>&"\'`;|%#?=:@ {}[]()*+~^$!.-_0123456789abzAZ',
		'\t',
		'\n',
		'\r',
		'\u202e',
		'\u200d',
		'\ufeff',
		'\u{1f600}',
		'中',
		'ß',
		'ø',
		'ł',
		'ي',
		'א',
		'ก',
		'서',
		'\u0301',
		'\u0655',
		'\u1173',
	]

	describe('when the name carries accents', () => {
		it('should take them off rather than have the name refused', () => {
			// GIVEN names of the kind that are ordinary in Catalan and Spanish
			// WHEN a slug is worked out
			// THEN the accents are gone and the name is still readable. Sent as typed,
			// one of these failed the whole call it arrived in
			expect(companySlugFromName('Calderería Sentmenat')).toBe(
				'caldereria-sentmenat',
			)
			expect(companySlugFromName('Ñandú')).toBe('nandu')
		})
	})

	describe('when a letter stands for plain letters the company writes itself', () => {
		it('should write those, rather than cut the word in half', () => {
			// GIVEN names carrying a letter that is not a-z and is not a marked a-z
			// WHEN a slug is worked out
			// THEN the letter is spelled the way the company registers its own
			// address. Dropped as unusable instead, "strasse" came out "stra-e"
			expect(companySlugFromName('Straße & Co. GmbH')).toBe('strasse-co-gmbh')
			expect(companySlugFromName('Bjørn Larsen AS')).toBe('bjorn-larsen-as')
			expect(companySlugFromName('Łukasz Sp. z o.o.')).toBe('lukasz-sp-z-o-o')
		})
	})

	describe('when the name has no a-z letters at all', () => {
		it('should give the same slug every time that name is written', () => {
			// GIVEN a Chinese name, which leaves nothing to build an address from
			const once = companySlugFromName('北京科技有限公司')
			const again = companySlugFromName('北京科技有限公司')

			// WHEN a slug is worked out twice
			// THEN both are the same. A random one made every resend a new row, so the
			// same company arrived again and again instead of being recognised
			expect(once).toBe(again)
			expect(once).toMatch(A_VALID_SLUG)
		})

		it('should give different names different slugs', () => {
			// GIVEN two different Chinese companies
			// WHEN slugs are worked out
			// THEN they differ, so one cannot be mistaken for the other
			expect(companySlugFromName('北京科技有限公司')).not.toBe(
				companySlugFromName('上海科技有限公司'),
			)
		})
	})

	describe('whatever name it is handed', () => {
		it('should always produce something a slug is allowed to be', () => {
			// GIVEN thousands of names built from path separators, web-address
			// punctuation, whitespace, a right-to-left override, a zero-width joiner,
			// a byte-order mark, an emoji, and letters from scripts that fold in
			// different ways
			// WHEN a slug is worked out for each
			// THEN every one of them is a slug the schema would accept. Nothing checks
			// this at runtime — a slug worked out from a name is produced after the
			// call has been parsed — so it has to hold by construction
			for (let seed = 0; seed < 4000; seed++) {
				let name = ''
				const length = seed % 25
				for (let at = 0; at <= length; at++) {
					name +=
						SLUG_HOSTILE_CHARACTERS[
							(seed * 7 + at * 13) % SLUG_HOSTILE_CHARACTERS.length
						]
				}
				const slug = companySlugFromName(name)
				expect(
					slug,
					`name=${JSON.stringify(name)} slug=${JSON.stringify(slug)}`,
				).toMatch(A_VALID_SLUG)
			}
		})

		it('should hold for names written to break it', () => {
			// GIVEN names shaped like an attack on a web address
			// WHEN a slug is worked out
			// THEN each is still a plain, legal slug
			for (const name of [
				'../../etc/passwd',
				'<script>alert(1)</script>',
				'%2e%2e%2f',
				'javascript:alert(1)',
				'?q=1&x=2',
				'#frag',
				'\u202eevil',
				'..',
				'---',
				'   ',
				'',
				'A'.repeat(5000),
			]) {
				expect(companySlugFromName(name), name).toMatch(A_VALID_SLUG)
			}
		})
	})
})
