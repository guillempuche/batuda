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
