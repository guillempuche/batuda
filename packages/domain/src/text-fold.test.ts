import { describe, expect, it } from 'vitest'

import { foldLabel, slugFromLabel } from './text-fold'

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
