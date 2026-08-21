import { describe, expect, it } from 'vitest'

import {
	coveragePassVerdict,
	coverRequestParts,
	MAX_COVERAGE_PASSES,
	MAX_KINDS_OF_COMPANY,
	MAX_PART_TERMS,
	MAX_REQUEST_PARTS,
	MAX_WORDING_CHARS,
	type RequestPart,
	readKindsOfCompany,
	readRequestParts,
	requestPartsDirective,
	requestPartsPrompt,
	searchedAndEmptyParts,
	uncoveredPartsDirective,
} from './request-parts'

// The five trades of the Spanish installations request, shortened to what the
// tests need: a label and enough wordings to place a row.
const ELECTRICAL: RequestPart = {
	label: 'instalaciones eléctricas',
	terms: ['electricista', 'electrical installation'],
}
const PLUMBING: RequestPart = {
	label: 'fontanería',
	terms: ['fontanero', 'lampisteria', 'plumbing'],
}
const LIFTS: RequestPart = { label: 'ascensores', terms: ['elevador'] }

describe('readRequestParts', () => {
	describe('when the splitter answers with the shape it was asked for', () => {
		it('should keep every part, in the order the request named them', () => {
			// GIVEN three kinds of company, each with its own wordings
			const parts = readRequestParts({
				parts: [
					{ label: 'instalaciones eléctricas', terms: ['electricista'] },
					{ label: 'fontanería', terms: ['fontanero'] },
					{ label: 'ascensores', terms: ['elevador'] },
				],
			})
			// THEN all three are held, in that order — the run works through them as
			// the request wrote them, not as the splitter felt like ranking them
			expect(parts.map(part => part.label)).toEqual([
				'instalaciones eléctricas',
				'fontanería',
				'ascensores',
			])
			expect(parts[0]?.terms).toEqual(['electricista'])
		})

		it('should take the surrounding space off a label and its wordings', () => {
			// GIVEN an answer padded with newlines and spaces
			const parts = readRequestParts({
				parts: [{ label: '  ascensores\n', terms: ['  elevador  '] }],
			})
			// THEN the padding is gone: it is neither part of the trade's name nor
			// part of a wording, and it would be shown back to a reader
			expect(parts[0]?.label).toBe('ascensores')
			expect(parts[0]?.terms).toEqual(['elevador'])
		})
	})

	describe('when the answer is not the shape it was asked for', () => {
		it('should come back with no list at all rather than a broken one', () => {
			// GIVEN answers that carry no readable list of parts
			// THEN each reads as no list, which turns coverage off for that run and
			// leaves the search to go ahead — better than refusing to start
			expect(readRequestParts(null)).toEqual([])
			expect(readRequestParts(undefined)).toEqual([])
			expect(readRequestParts('instalaciones eléctricas')).toEqual([])
			expect(readRequestParts({})).toEqual([])
			expect(readRequestParts({ parts: 'electricistas' })).toEqual([])
			expect(readRequestParts({ parts: null })).toEqual([])
		})

		it('should skip an entry that names no kind of company', () => {
			// GIVEN a list where only the middle entry carries a usable label
			const parts = readRequestParts({
				parts: [
					null,
					'fontanería',
					{ terms: ['electricista'] },
					{ label: 42, terms: [] },
					{ label: 'ascensores', terms: [] },
				],
			})
			// THEN only the entry that names something is held; the rest could never
			// be searched for, let alone reported as uncovered
			expect(parts.map(part => part.label)).toEqual(['ascensores'])
		})

		it('should skip a label made only of punctuation or space', () => {
			// GIVEN labels that fold to no words at all
			const parts = readRequestParts({
				parts: [
					{ label: '   ', terms: ['electricista'] },
					{ label: '— / —', terms: ['fontanero'] },
					{ label: 'ascensores', terms: [] },
				],
			})
			// THEN they are dropped: a label with no words can never be found in a
			// row, so keeping it would leave a part uncovered for the whole run
			expect(parts.map(part => part.label)).toEqual(['ascensores'])
		})
	})

	describe('when the splitter names the same kind of company twice', () => {
		it('should hold it once, however it was spelled the second time', () => {
			// GIVEN the same trade written three ways — accents, case, spacing
			const parts = readRequestParts({
				parts: [
					{ label: 'fontanería', terms: ['fontanero'] },
					{ label: 'Fontaneria', terms: ['lampista'] },
					{ label: 'fontanería  ', terms: ['plumbing'] },
				],
			})
			// THEN one part stands, the first as written — a trade counted twice
			// would read as two parts to cover and two shortfalls to report
			expect(parts).toHaveLength(1)
			expect(parts[0]?.label).toBe('fontanería')
			expect(parts[0]?.terms).toEqual(['fontanero'])
		})

		it('should drop a wording repeated inside one part', () => {
			// GIVEN one part listing the same wording three ways
			const parts = readRequestParts({
				parts: [
					{
						label: 'fontanería',
						terms: ['Fontanero', 'fontanero', 'FONTANERO ', 'lampista'],
					},
				],
			})
			// THEN it is listed once: the repeats place no row the first one does not
			expect(parts[0]?.terms).toEqual(['Fontanero', 'lampista'])
		})

		it('should drop a wording that only repeats its own label', () => {
			// GIVEN a part whose wordings include the label again
			const parts = readRequestParts({
				parts: [{ label: 'ascensores', terms: ['Ascensores', 'elevador'] }],
			})
			// THEN only the wording that adds something is kept — the label is always
			// read anyway, so listing it again buys nothing
			expect(parts[0]?.terms).toEqual(['elevador'])
		})
	})

	describe('when two parts claim the same wording', () => {
		it('should drop it from both — it places a row in neither', () => {
			// GIVEN two trades that both list the word every installer uses
			const parts = readRequestParts({
				parts: [
					{
						label: 'instalaciones eléctricas',
						terms: ['instalacion', 'electricista'],
					},
					{ label: 'fontanería', terms: ['instalacion', 'fontanero'] },
				],
			})
			// THEN the shared word is gone from both: left in, the first row to say
			// "instalación" would mark every trade covered at once
			expect(parts[0]?.terms).toEqual(['electricista'])
			expect(parts[1]?.terms).toEqual(['fontanero'])
		})

		it('should drop a wording that is another part in its own right', () => {
			// GIVEN a part listing the neighbouring part's own label as a wording
			const parts = readRequestParts({
				parts: [
					{ label: 'climatización', terms: ['hvac'] },
					{ label: 'fontanería', terms: ['climatizacion', 'fontanero'] },
				],
			})
			// THEN the borrowed wording goes and both labels stand: a part is never
			// left with no wording at all, which would read as uncovered for good
			expect(parts[0]?.label).toBe('climatización')
			expect(parts[0]?.terms).toEqual(['hvac'])
			expect(parts[1]?.terms).toEqual(['fontanero'])
		})

		it('should keep a part whose every wording was shared', () => {
			// GIVEN two parts listing nothing but the same two words
			const parts = readRequestParts({
				parts: [
					{ label: 'instalaciones eléctricas', terms: ['instalacion', 'obra'] },
					{ label: 'fontanería', terms: ['instalacion', 'obra'] },
				],
			})
			// THEN both stand with their labels alone — a part with nothing to match
			// on could only ever be reported as uncovered
			expect(parts.map(part => part.label)).toEqual([
				'instalaciones eléctricas',
				'fontanería',
			])
			expect(parts[0]?.terms).toEqual([])
			expect(parts[1]?.terms).toEqual([])
		})
	})

	describe('when the splitter shreds the request instead of splitting it', () => {
		it('should hold no more parts than a request plausibly names', () => {
			// GIVEN twice as many parts as a request would name
			const parts = readRequestParts({
				parts: Array.from({ length: MAX_REQUEST_PARTS * 2 }, (_, index) => ({
					label: `trade ${index}`,
					terms: [],
				})),
			})
			// THEN the first few are worked through and the rest let go: a split this
			// long is a broken split, and chasing all of it would spend the run
			expect(parts).toHaveLength(MAX_REQUEST_PARTS)
			expect(parts[0]?.label).toBe('trade 0')
		})

		it('should cut a label or wording longer than a name ever is', () => {
			// GIVEN a splitter that answered with a paragraph where a trade name was
			//   asked for
			const paragraph = `fontanería ${'y reformas de todo tipo '.repeat(20)}`
			const parts = readRequestParts({
				parts: [
					{ label: paragraph, terms: [paragraph] },
					{ label: 'ascensores', terms: [] },
				],
			})
			// THEN it is cut to a name's length, keeping the trade its first words
			// name. These words go into every searching pass's prompt, so one left
			// whole would fill the prompt on its own and stop the search after a
			// single round
			expect(parts[0]?.label.length).toBeLessThanOrEqual(MAX_WORDING_CHARS)
			expect(parts[0]?.label.startsWith('fontanería')).toBe(true)
			expect(
				parts[0]?.terms.every(term => term.length <= MAX_WORDING_CHARS),
			).toBe(true)
		})

		it('should hold no more wordings for one part than are worth matching', () => {
			// GIVEN a part listing every phrasing the model could think of
			const parts = readRequestParts({
				parts: [
					{
						label: 'fontanería',
						terms: Array.from(
							{ length: MAX_PART_TERMS * 2 },
							(_, index) => `wording ${index}`,
						),
					},
				],
			})
			// THEN the list is cut to what a part is actually matched on
			expect(parts[0]?.terms).toHaveLength(MAX_PART_TERMS)
		})
	})

	describe('when a part carries no wordings of its own', () => {
		it('should keep the part with its label alone', () => {
			// GIVEN parts whose wordings are missing, unusable, or say nothing
			const parts = readRequestParts({
				parts: [
					{ label: 'ascensores' },
					{ label: 'fontanería', terms: 'fontanero' },
					{ label: 'climatización', terms: [7, '', '  ', '///'] },
				],
			})
			// THEN all three stand: the label is a wording in itself, and the run has
			// something to search for and something to report
			expect(parts.map(part => part.label)).toEqual([
				'ascensores',
				'fontanería',
				'climatización',
			])
			expect(parts.every(part => part.terms.length === 0)).toBe(true)
		})
	})
})

// What a run that never went back out for anything hands in. The cases below
// turn on which rows place which part, not on what was searched for.
const NOTHING_SEARCHED: ReadonlySet<string> = new Set()

describe('readKindsOfCompany', () => {
	describe('when the splitter answers with words for a kind of company', () => {
		it('should keep them as written', () => {
			// GIVEN a Catalan market's words for what a company calls itself
			// WHEN read — THEN kept, and it is these that tell "Grup Puig" is a firm
			// called Puig rather than a firm called Grup
			expect(
				readKindsOfCompany({ kindsOfCompany: ['grup', 'serveis', 'societat'] }),
			).toEqual(['grup', 'serveis', 'societat'])
		})

		it('should keep one of a word the splitter listed twice', () => {
			// GIVEN the same word back in two spellings of the same letters
			// WHEN read — THEN once, since a word repeated says nothing twice
			expect(
				readKindsOfCompany({ kindsOfCompany: ['Grupo', 'grupo', 'servicios'] }),
			).toEqual(['Grupo', 'servicios'])
		})

		it('should drop a word too short to spend on a name', () => {
			// GIVEN a two- and a three-letter word among the real ones
			// WHEN read
			// THEN only the words long enough to be words. These are spent saying a
			// name's word identifies nobody, and a short one reaches far more names
			// than it was meant to — "sa" would take the front off half a French list
			expect(
				readKindsOfCompany({ kindsOfCompany: ['sa', 'cie', 'groupe'] }),
			).toEqual(['groupe'])
		})

		it('should keep no more than a language actually uses', () => {
			// GIVEN a splitter listing every word it can think of
			// WHEN read — THEN cut, because past this it is reaching beyond what the
			// language uses and each word takes a real name away from somebody
			expect(
				readKindsOfCompany({
					kindsOfCompany: Array.from(
						{ length: MAX_KINDS_OF_COMPANY + 6 },
						(_, at) => `kindword${at}`,
					),
				}).length,
			).toBe(MAX_KINDS_OF_COMPANY)
		})
	})

	describe('when the answer carries no words for a kind of company', () => {
		it('should come back empty rather than refusing the answer', () => {
			// GIVEN answers with the list missing, wrongly shaped, or not an answer
			// WHEN each is read
			// THEN empty every time. A run that cannot read them still has its trades
			// and the shared list, which is a worse reading rather than no run at all
			for (const raw of [
				{ parts: [] },
				{ kindsOfCompany: 'grupo' },
				{ kindsOfCompany: null },
				null,
				'grupo',
			]) {
				expect(readKindsOfCompany(raw)).toEqual([])
			}
		})

		it('should drop an entry that is not a word', () => {
			// GIVEN a list carrying blanks and things that are not words at all
			// WHEN read — THEN only what a name could actually be written with
			expect(
				readKindsOfCompany({
					kindsOfCompany: ['grupo', '', '   ', 42, null, '...', 'servicios'],
				}),
			).toEqual(['grupo', 'servicios'])
		})
	})
})

describe('coverRequestParts', () => {
	describe('when the request named too few parts to work through', () => {
		it('should ask nothing about coverage at all', () => {
			// GIVEN a request for one kind of company, and one for none
			// THEN there is no question to answer: a request naming one kind is
			// answered by companies of that kind, which the other signals judge
			expect(coverRequestParts([ELECTRICAL], [], NOTHING_SEARCHED)).toBeNull()
			expect(
				coverRequestParts([], [{ name: 'Alfa SL' }], NOTHING_SEARCHED),
			).toBeNull()
		})
	})

	describe('when the rows answer every part', () => {
		it('should report them all covered and nothing missing', () => {
			// GIVEN a row for each of the two trades asked about
			const coverage = coverRequestParts(
				[ELECTRICAL, PLUMBING],
				[
					{ name: 'Alfa SL', why_relevant: 'Instalaciones eléctricas' },
					{ name: 'Beta SL', why_relevant: 'Fontanería industrial' },
				],
				NOTHING_SEARCHED,
			)
			// THEN the request is answered
			expect(coverage).toEqual({
				covered: ['instalaciones eléctricas', 'fontanería'],
				uncovered: [],
				unsearched: [],
			})
		})
	})

	describe('when a long list answers one of the trades asked about', () => {
		it('should name the ones nothing came back for', () => {
			// GIVEN sixty electricians and nobody else — the shape of the run this
			// exists to catch, where the count alone reads perfectly healthy
			const coverage = coverRequestParts(
				[ELECTRICAL, PLUMBING, LIFTS],
				Array.from({ length: 60 }, (_, index) => ({
					name: `Electro ${index}`,
					why_relevant: 'Instalaciones eléctricas industriales',
				})),
				NOTHING_SEARCHED,
			)
			// THEN the two trades nobody answered are named, in the order the request
			// named them, however long the list is
			expect(coverage?.covered).toEqual(['instalaciones eléctricas'])
			expect(coverage?.uncovered).toEqual(['fontanería', 'ascensores'])
		})
	})

	describe('when the search came back with no rows', () => {
		it('should read every part as uncovered', () => {
			// GIVEN nothing found
			const coverage = coverRequestParts(
				[ELECTRICAL, PLUMBING],
				[],
				NOTHING_SEARCHED,
			)
			// THEN nothing is covered — the honest reading of an empty list
			expect(coverage).toEqual({
				covered: [],
				uncovered: ['instalaciones eléctricas', 'fontanería'],
				unsearched: ['instalaciones eléctricas', 'fontanería'],
			})
		})
	})

	describe('where a row says what it does', () => {
		it('should read the name, the industry, the relevance note and the description', () => {
			// GIVEN four rows, each stating its trade in a different field — a company
			// named for its trade says it nowhere else at all
			const coverage = coverRequestParts(
				[ELECTRICAL, PLUMBING, LIFTS],
				[
					{ name: 'Ascensores Girona SL' },
					{ name: 'Alfa', industry: 'Instalaciones eléctricas' },
					{ name: 'Beta', why_relevant: 'Fontanero para obra nueva' },
				],
				NOTHING_SEARCHED,
			)
			// THEN all three are answered
			expect(coverage?.uncovered).toEqual([])
		})

		it('should read a field that arrives wrapped with its source', () => {
			// GIVEN an industry that came back as a value with its citation attached
			const coverage = coverRequestParts(
				[ELECTRICAL, LIFTS],
				[
					{
						name: 'Alfa',
						industry: { value: 'Instalaciones eléctricas', source_id: 'src' },
					},
					{ name: 'Beta', industry: { value: 'Ascensores', source_id: 'src' } },
				],
				NOTHING_SEARCHED,
			)
			// THEN both read the same as a bare string would
			expect(coverage?.uncovered).toEqual([])
		})

		it('should ignore a row that says nothing about itself', () => {
			// GIVEN rows with no name and nothing said about what they do
			const coverage = coverRequestParts(
				[ELECTRICAL, PLUMBING],
				[{}, { name: '' }, { industry: '   ' }],
				NOTHING_SEARCHED,
			)
			// THEN nothing is answered — an empty row places no trade
			expect(coverage?.covered).toEqual([])
		})
	})

	describe('how closely a wording has to match', () => {
		it('should look past accents and word endings', () => {
			// GIVEN a row writing the trade with accents and in the plural
			const coverage = coverRequestParts(
				[{ label: 'instalacion electrica', terms: [] }, LIFTS],
				[{ name: 'Alfa', industry: 'Instalaciones Eléctricas Industriales' }],
				NOTHING_SEARCHED,
			)
			// THEN it answers the part: Spanish and Catalan put an ending on every
			// word of a phrase, so a long wording matches as an opening
			expect(coverage?.covered).toEqual(['instalacion electrica'])
		})

		it('should hold a short wording to the whole word', () => {
			// GIVEN a three-letter trade word and a row that merely starts with it
			const coverage = coverRequestParts(
				[{ label: 'gas', terms: [] }, LIFTS],
				[{ name: 'Alfa', why_relevant: 'Control del gasto energético' }],
				NOTHING_SEARCHED,
			)
			// THEN it does not answer: a short word opens far too many unrelated ones
			expect(coverage?.uncovered).toContain('gas')
		})

		it('should need a two-word wording to appear as those two words', () => {
			// GIVEN a row using both words of the wording, but apart and reversed
			const coverage = coverRequestParts(
				[ELECTRICAL, LIFTS],
				[
					{
						name: 'Alfa',
						why_relevant: 'Electricidad para instalaciones de riego',
					},
				],
				NOTHING_SEARCHED,
			)
			// THEN it does not answer: the words of a trade's name are the ordinary
			// words of half the sector, and any-order matching reads them everywhere
			expect(coverage?.uncovered).toContain('instalaciones eléctricas')
		})

		it('should let any one of a part’s wordings answer it', () => {
			// GIVEN a row that uses the English wording rather than the request's own
			const coverage = coverRequestParts(
				[PLUMBING, LIFTS],
				[{ name: 'Alfa', description: 'Plumbing contractor' }],
				NOTHING_SEARCHED,
			)
			// THEN the part is answered — the market answers in its own languages,
			// which is what the wordings are for
			expect(coverage?.covered).toEqual(['fontanería'])
		})
	})
})

describe('coverRequestParts — which missing parts were ever searched for', () => {
	describe('when a pass went back out for a part and still found nobody', () => {
		it('should report it missing without saying nothing looked for it', () => {
			// GIVEN lifts nothing answers, after a pass went out for lifts alone
			const coverage = coverRequestParts(
				[ELECTRICAL, LIFTS],
				[{ name: 'Alfa', industry: 'Instalaciones eléctricas' }],
				new Set(['ascensores']),
			)
			// THEN the shortfall stands — but it is a search that came back empty,
			// which is the one reading that says something about the market
			expect(coverage?.uncovered).toEqual(['ascensores'])
			expect(coverage?.unsearched).toEqual([])
		})
	})

	describe('when no pass ever went out for a part', () => {
		it('should name it as one nothing looked for', () => {
			// GIVEN the same missing trade, with no pass ever spent on it — the
			// anchored run this exists to catch, which read the trade as answered
			// over its first extraction and reports over its second
			const coverage = coverRequestParts(
				[ELECTRICAL, LIFTS],
				[{ name: 'Alfa', industry: 'Instalaciones eléctricas' }],
				NOTHING_SEARCHED,
			)
			// THEN it is still missing from the list, and named as never looked for,
			// so the shortfall cannot be read as a market with no lift installers
			expect(coverage?.uncovered).toEqual(['ascensores'])
			expect(coverage?.unsearched).toEqual(['ascensores'])
		})
	})

	describe('when one missing part was searched for and another was not', () => {
		it('should tell the two apart, in the order the request named them', () => {
			// GIVEN three trades with only electricians in the list, a pass having
			// gone out for plumbing alone
			const coverage = coverRequestParts(
				[ELECTRICAL, PLUMBING, LIFTS],
				[{ name: 'Alfa', industry: 'Instalaciones eléctricas' }],
				new Set(['fontanería']),
			)
			// THEN both are reported missing, and only the one nothing looked for is
			// named as such
			expect(coverage?.uncovered).toEqual(['fontanería', 'ascensores'])
			expect(coverage?.unsearched).toEqual(['ascensores'])
		})
	})

	describe('when every part came back with companies', () => {
		it('should name none of them, however little was searched for', () => {
			// GIVEN a list answering both trades and no pass ever spent
			const coverage = coverRequestParts(
				[ELECTRICAL, PLUMBING],
				[
					{ name: 'Alfa SL', why_relevant: 'Instalaciones eléctricas' },
					{ name: 'Beta SL', why_relevant: 'Fontanería industrial' },
				],
				NOTHING_SEARCHED,
			)
			// THEN nothing is named: a part that came back with companies is
			// answered, and how it was reached says nothing more about it
			expect(coverage?.uncovered).toEqual([])
			expect(coverage?.unsearched).toEqual([])
		})
	})

	describe('when the search came back with nothing at all', () => {
		it('should name every part it never went out for', () => {
			// GIVEN an empty list, with a pass spent on electrical work alone
			const coverage = coverRequestParts(
				[ELECTRICAL, PLUMBING, LIFTS],
				[],
				new Set(['instalaciones eléctricas']),
			)
			// THEN all three are missing, and the two nothing looked for are named
			expect(coverage?.uncovered).toEqual([
				'instalaciones eléctricas',
				'fontanería',
				'ascensores',
			])
			expect(coverage?.unsearched).toEqual(['fontanería', 'ascensores'])
		})
	})

	describe('when what was searched for names something the request did not', () => {
		it('should leave the reading untouched', () => {
			// GIVEN a searched label matching no part of this request, and one that
			// matches a part the list already answers
			const coverage = coverRequestParts(
				[ELECTRICAL, LIFTS],
				[{ name: 'Alfa', industry: 'Instalaciones eléctricas' }],
				new Set(['instalaciones eléctricas', 'carpintería']),
			)
			// THEN neither says anything: only a part nothing answered can be named
			// as one nothing looked for
			expect(coverage?.uncovered).toEqual(['ascensores'])
			expect(coverage?.unsearched).toEqual(['ascensores'])
		})
	})

	describe('when the request named too few parts to work through', () => {
		it('should still ask nothing about coverage', () => {
			// GIVEN one kind of company, and a pass recorded against it
			// THEN there is no question to answer, whatever was searched for
			expect(coverRequestParts([LIFTS], [], new Set(['ascensores']))).toBeNull()
		})
	})
})

describe('searchedAndEmptyParts', () => {
	describe('when nothing was ever looked for', () => {
		it('should offer no part as one a search came back empty on', () => {
			// GIVEN two missing trades, neither of them searched for
			const parts = searchedAndEmptyParts(
				['fontanería', 'ascensores'],
				['fontanería', 'ascensores'],
			)
			// THEN none can be reported as found-nobody: saying so asserts a search
			// that never happened
			expect(parts).toEqual([])
		})
	})

	describe('when every missing part was searched for', () => {
		it('should offer all of them', () => {
			// GIVEN two missing trades, both gone out for
			const parts = searchedAndEmptyParts(['fontanería', 'ascensores'], [])
			// THEN both are honest shortfalls, in the request's order
			expect(parts).toEqual(['fontanería', 'ascensores'])
		})
	})

	describe('when only some of the missing parts were searched for', () => {
		it('should offer those alone, keeping the request’s order', () => {
			// GIVEN three missing trades, the middle one never looked for
			const parts = searchedAndEmptyParts(
				['fontanería', 'ascensores', 'solar'],
				['ascensores'],
			)
			// THEN only the two a search actually went out for are offered
			expect(parts).toEqual(['fontanería', 'solar'])
		})
	})

	describe('when the run reported no shortfall at all', () => {
		it('should offer nothing', () => {
			// GIVEN a run with nothing missing — a scan that answered every trade,
			// and one that never asked the question
			// THEN there is no shortfall to report
			expect(searchedAndEmptyParts([], [])).toEqual([])
		})
	})
})

describe('requestPartsPrompt', () => {
	describe('when the request is handed over to be split', () => {
		it('should carry the request and the shape the answer must take', () => {
			// GIVEN a request naming several trades
			const prompt = requestPartsPrompt('Instaladoras: eléctricas y fontanería')
			// THEN the request is in the prompt, and so is the shape asked for —
			// the extract tier is given the schema in both places
			expect(prompt).toContain('Instaladoras: eléctricas y fontanería')
			expect(prompt).toContain('"parts"')
			expect(prompt).toContain('label')
			expect(prompt).toContain('terms')
		})

		it('should tell the splitter that a place is not a kind of company', () => {
			// GIVEN any request
			const prompt = requestPartsPrompt('Empresas instaladoras en España')
			// THEN it is told to leave places out: a province is answered in a field
			// of its own, so a place held as a part would read uncovered on every row
			expect(prompt).toContain('A place is not a part')
		})

		it('should tell the splitter how to read an "and" between two trades', () => {
			// GIVEN any request
			const prompt = requestPartsPrompt('Empresas instaladoras en España')

			// THEN the first question is whether the two wordings name the same work,
			// which settles a trade named twice and a trade whose own name carries the
			// word — asked second instead, it loses to the rule below about half the
			// time
			expect(prompt).toContain('settle this before anything else')
			expect(prompt).toContain('health and safety is one line of work')

			// AND only then does where the word sits come into it: the one closing a
			// list separates the final trade, so a request naming five trades cannot
			// come back split into four with the folded-away trade never searched for
			// and never reported missing
			expect(prompt).toContain('Only where the two really are different work')
			expect(prompt).toContain("the list's own punctuation")
		})
	})
})

describe('requestPartsDirective', () => {
	describe('when the search is told what it is working through', () => {
		it('should name every part and how many there are', () => {
			// GIVEN the three trades the request named
			const directive = requestPartsDirective([ELECTRICAL, PLUMBING, LIFTS])
			// THEN the list is on the page in front of the search rather than
			// something it was asked to keep in mind
			expect(directive).toContain('3 kinds of company')
			expect(directive).toContain('"instalaciones eléctricas"')
			expect(directive).toContain('"fontanería"')
			expect(directive).toContain('"ascensores"')
		})
	})

	describe('when the request named one kind of company, or none', () => {
		it('should say nothing at all', () => {
			// GIVEN a request that names a single trade, and one that names none
			// THEN neither is given a list to work through: there is nothing to work
			// through, and coverage reads the same threshold, so the search is never
			// told to work through a list nothing will hold it to
			expect(requestPartsDirective([ELECTRICAL])).toBe('')
			expect(requestPartsDirective([])).toBe('')
		})
	})
})

describe('coveragePassVerdict', () => {
	// A pass is affordable, early in the run, with parts still unanswered.
	const spare = {
		uncovered: 2,
		passesSpent: 0,
		elapsedMs: 60_000,
		deadlineMs: 2_400_000,
		canAfford: true,
	}

	describe('when parts are unanswered and there is room to look', () => {
		it('should go back out', () => {
			// GIVEN two trades nothing came back for, a minute into a forty-minute run
			// THEN the search goes back out for them
			expect(coveragePassVerdict(spare)).toBe('go')
		})
	})

	describe('when every part came back with companies', () => {
		it('should stop, whatever room is left', () => {
			// GIVEN nothing missing
			// THEN there is nothing to search for, so no pass is spent
			expect(coveragePassVerdict({ ...spare, uncovered: 0 })).toBe('answered')
		})
	})

	describe('when the passes are spent', () => {
		it('should stop rather than keep going', () => {
			// GIVEN a part still unanswered after every pass it is worth
			// THEN it is far more likely a trade this market has nobody for online
			// than one more pass would turn up, and the run reports it instead
			expect(
				coveragePassVerdict({ ...spare, passesSpent: MAX_COVERAGE_PASSES }),
			).toBe('passes_spent')
		})

		it('should still allow the last pass it is owed', () => {
			// GIVEN one pass short of the limit
			// THEN it is spent — the check is on passes already made, not on the one
			// about to be
			expect(
				coveragePassVerdict({ ...spare, passesSpent: MAX_COVERAGE_PASSES - 1 }),
			).toBe('go')
		})
	})

	describe('when most of the run’s clock is gone', () => {
		it('should stop rather than risk the whole run', () => {
			// GIVEN a whole-market search 25 minutes into its 40-minute deadline —
			// another full pass would overrun it
			const verdict = coveragePassVerdict({
				...spare,
				elapsedMs: 1_500_000,
				deadlineMs: 2_400_000,
			})
			// THEN it stops: overrunning marks the run failed, which loses the
			// companies it did find, where stopping only reports the part as
			// unanswered — which it would be reported as either way
			expect(verdict).toBe('deadline_margin')
		})

		it('should still go with half the clock left', () => {
			// GIVEN a run exactly at half its deadline
			// THEN there is still the room another pass plus everything after it
			// needs, so it goes
			expect(
				coveragePassVerdict({
					...spare,
					elapsedMs: 1_200_000,
					deadlineMs: 2_400_000,
				}),
			).toBe('go')
		})
	})

	describe('when the run cannot afford another pass', () => {
		it('should stop', () => {
			// GIVEN a run with the money gone but the clock in hand
			// THEN it stops for the money, and says so — the two stops are worth
			// telling apart when reading why a market went uncovered
			expect(coveragePassVerdict({ ...spare, canAfford: false })).toBe(
				'budget_margin',
			)
		})
	})
})

describe('uncoveredPartsDirective', () => {
	describe('when the search is sent back out for what is missing', () => {
		it('should name only what is missing and ask for companies', () => {
			// GIVEN two trades nothing came back for
			const directive = uncoveredPartsDirective(['fontanería', 'ascensores'])
			// THEN both are named, and the ask is for companies that do the work —
			// telling a model which trades look unanswered is also telling it how to
			// look answered by re-describing the rows it already has
			expect(directive).toContain('"fontanería"')
			expect(directive).toContain('"ascensores"')
			expect(directive).toContain('answers nothing')
			expect(directive).not.toContain('"instalaciones eléctricas"')
		})
	})
})
