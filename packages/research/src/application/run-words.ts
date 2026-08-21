/**
 * The words a run brings for what a company's name SAYS about it rather than
 * which company it is, so a check reading a name can tell those words from the
 * company.
 *
 * Two kinds, and a name usually carries one of each. "Fontanería García" is a
 * plumber called García; "Grup Puig" is a firm called Puig. A check that cannot
 * see which of the two words is the company treats both as its own, and then
 * fontaneria.es and grup.cat — which belong to whoever registered them, not to
 * every plumber in Spain or every Catalan firm called Grup something — read as
 * these firms' own sites.
 *
 * ## Why the words are not written down anywhere
 *
 * A list of words that identify nobody can only hold what somebody thought of, so
 * it carries one industry's vocabulary and one or two languages, and treats every
 * other industry's and every other language's as a company's own name. Filling it
 * in is not a matter of finishing the job: it needs every trade and every word for
 * a kind of company in every language a market answers in, and each word added
 * takes a real distinctive word away from the firms genuinely called that.
 *
 * A run does not need the list, because it already knows what market it was
 * launched for. Its request names the trades it wants outright, and the language
 * that request is written in says which language its companies name themselves in
 * — so the same reading of the request that splits it into trades is asked for
 * that language's words for a kind of company too (`request-parts.ts`). Both are
 * that market's own vocabulary, and nothing has to be kept up to date for a trade
 * or a language nobody has searched in yet.
 *
 * They are held as ONE set because every reading that asks who owns an address
 * asks one question of a word — does it identify anybody — and a word for a kind
 * of company answers it exactly as a trade does. Two sets would be two chances for
 * two callers to answer from different words. `term-match.ts` already reads these
 * wordings against a page; this reads them against a name.
 *
 * It is the reading `directory-sites.ts` takes for a different question — what a
 * site IS comes from watching what the run sees it do, never from a list of
 * hosts — and the one `eval-scoring-market.ts` takes for a third.
 *
 * ## How a word is read
 *
 * A name's word names a trade when one of the request's own words spells it. A
 * request word of some length is read as an OPENING, because Spanish, Catalan and
 * French put an ending on every word of a phrase: a request for "ascensor"
 * reaches a firm called "Ascensores", and one for "instalación eléctrica" reaches
 * "Instalaciones Eléctricas", without every ending of every trade being written
 * out.
 *
 * An opening may run at most `LONGEST_ENDING` letters short of the word it
 * reaches, because that is as long as one of those endings gets. A firm coins a
 * name by writing a trade word and carrying on — "Solarock", "Solartec" — and
 * without the cap the request's "solar" swallows both, leaving those firms with
 * no word of their own at all and no domain able to spell them. Over 159 rows
 * with a website that eight market searches returned, the uncapped reading took
 * exactly those two away and gave nothing back.
 *
 * The cap does not save a name coined only two letters past a trade word: a firm
 * called Solaris, met by a run asking about solar energy, has no word of its own
 * left and cannot establish solaris.es. That is the price of reading endings at
 * all, paid in the direction this package is allowed to be wrong in, and it is
 * why the cap is as tight as a real ending allows rather than looser.
 *
 * A short request word is matched whole instead, since three or four letters are
 * the opening of far too many unrelated ones. `term-match.ts` draws its own line
 * in the same place for the same reason; the two are set apart because that one
 * needs no cap, reading phrases against whole pages where a word that runs on is
 * another word of the page rather than the name a company chose for itself.
 *
 * ## What it does not answer
 *
 * A run that asked about one company on file names no trades, and hands back
 * nothing. Every word of that company's name then reads as its own, which is
 * where the shared list in `entity-guard.ts` is still the only thing standing —
 * see `own-site.ts` for what that costs and what would let the list go.
 */

import { foldTokens, nameSpellings } from './entity-guard'

/**
 * The words a run brings for what a name says rather than who it names, folded to
 * letters.
 *
 * Two readings, because the two are not equally sure of themselves. `words` is
 * everything the run brought. `asked` is only what the REQUEST itself wrote, which
 * is the half a person typed rather than the half a model supplied from its own
 * knowledge of a language — and that half alone is trusted to come off the front of
 * a domain. A word wrongly called a kind of company can then only withhold, which
 * this package is allowed to be wrong in; left in `asked` it would also cut
 * garciaacme.es down to "acme" and hand a stranger's domain to every firm called
 * Acme, which it is not.
 */
export interface RunWords {
	readonly words: ReadonlySet<string>
	readonly asked: ReadonlySet<string>
}

// Below this length a request's word has to spell a name's word exactly. Three or
// four letters open far too many unrelated words — "gas" opens "gasol" — while a
// longer one is long enough that mostly its own endings follow it.
const SHORTEST_WORD_READ_AS_AN_OPENING = 5

// How much longer than the request's word the name's word may run and still be
// the same word with an ending on it. Two letters covers what Spanish, Catalan
// and French add — "-s", "-es", "-as", "-os" — and stops there, so a coined name
// that merely starts with a trade word stays the company's own.
const LONGEST_ENDING = 2

/**
 * The words of a run, read off every wording its request used for the trades it
 * asked about and every word it gave for a kind of company.
 *
 * Wordings rather than the parts they came in, because the two callers hold them
 * in different shapes: a run has the parts its request was split into, and the
 * eval has the ones the golden file wrote down. Both hand over the same thing —
 * phrases naming a trade — and a caller with a part gives the label too, since
 * the trade in the words the request itself used is as much the market's
 * vocabulary as the wordings offered beside it.
 *
 * Folded the way a name is folded, and read in every spelling a name is read in
 * (`nameSpellings`, then `foldTokens`). Catalan writes a geminate l two ways and
 * a request may use either, while a company's name is read BOTH ways — so a
 * request written one way and matched against only that way leaves the other
 * spelling of the same word looking like a word of the company's own, and the
 * trade slips through under it. Folding it any other way here is also how two
 * checks start disagreeing about whether a piece of text spells a trade.
 */
export const runWordsOf = (
	wordings: ReadonlyArray<string>,
	kindsOfCompany: ReadonlyArray<string> = [],
): RunWords => {
	const fold = (given: ReadonlyArray<string>): Set<string> =>
		new Set(given.flatMap(nameSpellings).flatMap(foldTokens))
	const asked = fold(wordings)
	return { words: new Set([...asked, ...fold(kindsOfCompany)]), asked }
}

/**
 * Whether the request wrote this word, exactly as it stands.
 *
 * What a caller asks when it is reading a run of letters that MIGHT be a word
 * rather than a word it already has — the front of a domain, where nothing says
 * where the first word ends. The ending `namesNobody` reads past must not be
 * offered there: a request for "fontanería" would then also spell "fontaneriag",
 * the trade plus the first letter of the name after it, and a caller taking the
 * longest word a domain opens with would cut fontaneriagarcia.es one letter too
 * deep and never find García underneath.
 */
export const runWroteExactly = (word: string, runWords: RunWords): boolean =>
	runWords.asked.has(word)

/**
 * Whether this word of a name says what the company does or what kind of thing it
 * is, rather than who it is.
 *
 * The word arrives already folded and as a whole word, since every caller reads
 * it off a name that has been through the same fold.
 */
export const namesNobody = (word: string, runWords: RunWords): boolean => {
	if (runWords.words.has(word)) return true
	for (const asked of runWords.words) {
		if (
			asked.length >= SHORTEST_WORD_READ_AS_AN_OPENING &&
			word.startsWith(asked) &&
			word.length - asked.length <= LONGEST_ENDING
		)
			return true
	}
	return false
}
