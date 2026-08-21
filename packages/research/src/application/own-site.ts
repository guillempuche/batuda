/**
 * Whether a website is established as the company's OWN — the positive claim,
 * which nothing else in this package makes.
 *
 * `website-guard.ts` answers the opposite question: is this address clearly NOT
 * the company's? Its rules only ever blank, and a blank costs a real website, so
 * its bar is deliberately high and it keeps whatever it cannot condemn. That
 * makes "kept" mean "not condemned", which is not the same statement as "the
 * company owns it" — and a caller asking "is at least one of this company's
 * sources not a directory, its own site included?" reads the first and hears the
 * second. It then answers yes out of silence, which is exactly the fail-open the
 * directory watch refuses to allow itself (see `directory-sites.ts`).
 *
 * So this asks the question the other way round, with the same two-valued shape
 * the directory watch gives itself: `established`, or `unknown` — and `unknown`
 * is not a clearance. There is no third value meaning cleared, because there is
 * nothing here to answer yes with when the evidence is thin.
 *
 * ## What establishes it
 *
 * One thing, read off the address: THE DOMAIN SPELLS THE COMPANY. A firm
 * registers its own name, or the front of it, or the one word of it people use —
 * "Fusteria Miquel" at fusteriamiquel.cat, "XPO Logistics" at xpo.com,
 * "Transportes García" at garcia.es. The label has to BE one of those, never
 * merely contain it: "acme-directory.com" contains "acme" and belongs to
 * somebody else, and a listing whose own domain happens to carry a word of the
 * name would otherwise clear itself.
 *
 * Two ways of writing a domain are read for what they are on the way there, and
 * neither of them is a way of naming a company. A firm often puts what it does
 * in front of what it is called — "Cobra Instalaciones y Servicios" at
 * grupocobra.com — so one word for a trade comes off the front of the label, on
 * the terms `withoutLeadingTradeWord` sets. And a domain registered with an accent
 * travels in a code that spells nothing, which `hostLabel` puts back into the
 * letters its owner registered before any of this reads it.
 *
 * ## Which words identify nobody
 *
 * A company named after its trade is not identified by the trade: fontaneria.es
 * belongs to whoever registered it, not to every firm called Fontanería
 * something. So a word that names a trade is worth nothing here, whichever end
 * of the name it sits at, and everything below turns on which words those are.
 *
 * Two answers, asked in that order. A word that names a KIND of company — group,
 * holding, servicios — comes from the short list `entity-guard.ts` shares; those
 * work for anybody in any market, so no run has to bring them. A word that names
 * a TRADE comes from the run itself: it was launched for a market and its
 * request names the trades it wants, which is that market's own vocabulary in
 * the languages that market answers in (`trade-words.ts`).
 *
 * Reading the run is what makes this sector-agnostic. A list can only ever do
 * the first job: whichever trades somebody writes down are identified, and every
 * other trade in every other language reads as a word of a company's own name.
 * The shared one carries freight's vocabulary, so on its own it would hand the
 * bare trade domain of plumbers, builders, bakers, lawyers, clinics, shops and
 * workshops to whichever firm is named after it. No amount of filling in
 * finishes that, and each word filled in takes a real distinctive word away from
 * the firms genuinely called it.
 *
 * What the list still carries is one industry's words, which the run answers for
 * as well. They stay because a run about ONE COMPANY ON FILE names no trades at
 * all: there is nothing to read, and dropping them would hand transportes.com
 * back to every firm called Transportes something — the failure this file exists
 * to prevent, reappearing in the one market the list is right about. They go
 * when a run with no market behind it has some other way to say what a company
 * does, and not before.
 *
 * ## What deliberately does NOT establish it
 *
 * **The path.** "facebook.com/Some-Company" and "xpo.com/about-xpo-logistics"
 * are the same shape — a page naming the company on a host that does not — and
 * from the address alone nothing separates them. A directory files a company at
 * a path; so does a social platform; so, sometimes, does the company itself. A
 * path names a PAGE about the company, and who publishes a page about a company
 * is the very thing in question. `website-guard.ts` reads paths, and must: a
 * name in a deeper segment is the listing signature, and the first segment is
 * exempted there so an "about us" page is not mistaken for one. Those are
 * reasons to withhold a blank. None of them is a reason to claim ownership.
 *
 * **Where the claim was read from.** A row's citations say which pages the run
 * opened, never who owns a domain. Settling ownership on provenance opens a hole
 * for every way a row can cite: one citing nothing, one whose citations a guard
 * ahead has already dropped, one with a second citation about the COMPANY but
 * not about the address, one citing by an opaque `src_…` id with no host in it,
 * and the target's own `website` field, which carries exactly one source and so
 * can never have a second. Reading no citations at all closes every one of them
 * together. It also holds a scanned row and the run's own answer to one bar,
 * and the run's own answer is where a rule that reads citations has the least
 * to go on.
 *
 * **A second page that prints the address.** Tempting, and the one clause
 * considered and dropped: a footer or a link roll prints "facebook.com" on
 * pages that have nothing to do with whose site it is, so a mention on another
 * page manufactures `established` out of ordinary web furniture — the failure
 * this verdict exists to prevent, arriving by a different door.
 *
 * ## What it costs, on purpose
 *
 * A company at a domain that puts something in front of its name which names no
 * trade — "Penske Logistics" at gopenske.com — reads `unknown`, as does one at
 * an initialism its own name never spells: "Sociedad Ibérica de Construcciones
 * Eléctricas" at sice.com.
 *
 * In both the website is still kept, since keeping is not this verdict's
 * decision; what it loses is standing as the source that vouches for the
 * company. That is a withholding, and withholding is the direction this file is
 * allowed to be wrong in.
 *
 * Reading the run's trades costs the same way, and was measured before it was
 * paid for: over 159 rows with a website that eight market searches returned, it
 * changed exactly one answer, and that one was a domain spelling nothing but a
 * trade being taken away from a company named after it. A firm that really did
 * register its trade's bare domain reads `unknown` — it is refused with the rest
 * of its trade, since no reading of the address can tell it apart from them.
 *
 * The same measurement prices the reading in the other direction. A word the
 * request wrote comes off the front of a domain as a word for a kind of company
 * does, which is one more way to reach a name and so one more way to reach the
 * wrong one; over those 159 rows it cleared nothing the rest of the reading did
 * not already clear.
 *
 * ## The shortening that was measured and refused
 *
 * Five market searches turned up four real companies whose domain shortens
 * their name, and there is no single way they shorten it: sice.com and semi.es
 * take the first letter of each word; ppvs-fm.com writes the first word whole
 * and then the initials of the rest; esanit.fr takes one letter of the first
 * word and part of the second. Four rows, three shapes, and the last of them
 * cuts a word wherever it pleases.
 *
 * They stay `unknown`, and that is the answer rather than a gap left for later.
 * What the reading above matches on is letters the company itself wrote, in the
 * order it wrote them, which is why a longer name is HARDER to land on by
 * accident. Initials turn that around: the name is spent down to one letter a
 * word, so the more words a firm has the fewer letters it is judged on, and
 * every other firm whose words open the same way spells the same domain.
 * Take a firm called "Servicios Eléctricos y Montajes Industriales", invented
 * here to make the point where the four above were met in a run: it spells
 * semi.es exactly as well as the owner of that domain does, and would be handed
 * a stranger's site to vouch for it — the failure this file exists to prevent,
 * walking in through the door that letting those four rows in would open.
 *
 * The floor `SHORTEST_NAME_A_DOMAIN_SPELLS` sets below already says this about
 * the same letters: one or two letters is an initial rather than a name. Reading
 * initials would leave that floor standing and make it mean nothing.
 *
 * ## What reading past a trade word still gets wrong
 *
 * A domain that writes a trade word and then the front of a name answers for
 * every company whose name starts the same way, and one of them registered it.
 * "Cobra Formación" is at home on grupocobra.com by this reading, and the group
 * that owns it is not that company. Reading only the FRONT of a name is what
 * keeps this to companies that genuinely start alike rather than to every
 * company sharing any word — a market pass over 138 companies with a website
 * cleared no stranger under this reading, and one under the looser one.
 *
 * The other half of the price is a firm whose domain writes a trade word and
 * then a word from the MIDDLE of its name, which is refused with them: an
 * acronym a name carries in brackets, "Electronic Trafic (ETRA)" at
 * grupoetra.com, reads `unknown` though the domain is the company's own.
 *
 * ## What is left to close, and the rule for closing it
 *
 * Every rule here that lets more addresses through is a new way to clear a
 * stranger's address, so each is bought one at a time against rows a run
 * actually met, and each keeps its own list of what it still cannot clear.
 * A trade word may be read past because the words come from what the run asked
 * for and the list it shares, neither of which can be invented for a case; an
 * initialism may not, because nothing bounds who else spells it. Measure the
 * cost before paying it, and take the withholding when the measurement does not
 * settle it.
 *
 * Whether the host is a business directory is a separate question with a
 * separate answer (`directory-sites.ts`), and a caller weighing a company's
 * sources asks both.
 *
 * ## The one reading that stays apart
 *
 * `isOwnSiteHost` in `entity-guard.ts` asks something that sounds the same and
 * is not: which single site a run should GO AND READ as the company's. A wrong
 * yes there sends the run off to read a stranger's pages and then writes that
 * stranger's revenue, chief executive and telephone number onto the row, so it
 * wants the name to BE the domain — the whole of it, or one word of it standing
 * alone, with nothing in front of either — so "Grupo Cobra Instalaciones" must
 * not be handed grupocobra.com, a large unrelated group. This file is asked
 * about an address a run already holds, where a wrong yes cannot send a run off
 * to read anything, so the front of a name is enough and so is a trade word
 * ahead of it.
 *
 * What a wrong yes DOES cost here is worth naming, because it is more than the
 * field: an established site is the one thing that vouches for a company's
 * existence, it exempts its host from the directory watch, and it becomes a key
 * that folds two rows into one company. Cheaper than sending a run off to write
 * a stranger's revenue onto a row, which is what buys the asymmetry — but not
 * one field, and the loosenings above were weighed against the larger figure.
 *
 * Reading the accented spelling is the one thing they do share, because it is
 * not a rule about names at all: it is what the domain says, and a check that
 * read the code instead would be reading a different address from the one
 * somebody registered. It sits in `hostLabel`, which both go through.
 *
 * The difference in what each answer is spent on is what sets how far each may
 * read, and both halves are written down at both definitions so neither drifts.
 * Every caller weighing an address the run already has asks THIS file — the
 * directory watch included, where asking the stricter one brands a group's own
 * domain a listing for carrying a page for the group and a page for its
 * subsidiary, and costs the group its website.
 */

import {
	collapse,
	DISTINCTIVE_NAME_LENGTH,
	distinctiveWords,
	hostLabel,
	isGenericWord,
	labelSpellsOneOf,
	nameSpellings,
	nameWordsWithoutForms,
	withoutFormDots,
} from './entity-guard'
import { hostOf, isBareWebAddress } from './source-key'
import { namesATrade, type TradeWords, wasAskedForExactly } from './trade-words'

/**
 * What is known about a company's website. `unknown` is not "cleared". Spelled
 * as a value rather than left as the absence of one, so a caller has to name it
 * before acting on it.
 */
export type OwnSiteVerdict = 'established' | 'unknown'

// How many words a company's name runs to before what came in is a brief rather
// than a name. A run started from free text with no company on file passes its
// whole question down as the name, and every long word of a question would then
// be a word a domain could be cleared by — "Acme Corp Barcelona" clearing
// barcelona.cat. A run that does not know the company's name cannot say whose
// site anything is. Set well clear of the longest real names, which run to five
// ("Sociedad Española de Montajes Industriales"), because what sits on the other
// side of this is a paragraph rather than a sixth word.
const MOST_WORDS_A_NAME_RUNS_TO = 8

// The shortest front part a domain may be read as spelling. The large carriers
// register three letters — dsv.com, xpo.com — so the floor cannot be four; but
// one or two letters is an initial rather than a name, and a domain that short
// belongs to whoever paid for it regardless of whose initials it matches.
const SHORTEST_NAME_A_DOMAIN_SPELLS = 3

// The words that join two halves of a name rather than being any of it — "Cobra
// Instalaciones Y Servicios", "Services ET installations électriques". Written
// out because a name made of nothing but its trade still carries one of these,
// and a joining word left standing as the company's own hands that firm the bare
// domain of its own trade: the failure this reading exists to prevent, walking in
// behind a word nobody would call a name.
//
// Safe to write down where a trade is not, because these are the whole of a
// closed class a language barely adds to, and no company is identified by one —
// unlike the two letters a firm really does call itself by ("VS Energy" at
// vsenergy.fr), which is why the length of a word settles nothing here.
const JOINS_TWO_HALVES_OF_A_NAME = new Set([
	'de',
	'del',
	'y',
	'i',
	'e',
	'et',
	'and',
	'und',
])

// Every name a company's own domain could plausibly be registered under: the
// whole name and each shorter run of its words from the front — "XPO Logistics"
// gives "xpo" and "xpologistics". Front-anchored, because a firm shortens its
// name by dropping the end ("Acme Logistics" at acme.com) and not by dropping
// the start, and a run taken from anywhere would let a listing filed under any
// word of the name clear itself.
const namesTheDomainCouldCarry = (
	words: ReadonlyArray<string>,
	identifiesNobody: (word: string) => boolean,
): ReadonlyArray<string> => {
	const runs: Array<string> = []
	let run = ''
	let identifiesSomebody = false
	for (const word of words) {
		run += word
		// A front part made of nothing but trade words identifies nobody, so
		// "Grupo Ferré" must not be at home on grupo.es and "Transportes García"
		// not on transportes.com. Once a word of the company's own has arrived,
		// every longer run carries it.
		identifiesSomebody =
			identifiesSomebody ||
			(!identifiesNobody(word) && !JOINS_TWO_HALVES_OF_A_NAME.has(word))
		if (identifiesSomebody && run.length >= SHORTEST_NAME_A_DOMAIN_SPELLS) {
			runs.push(run)
		}
	}
	return runs
}

// What is left of a label once the trade word it opens with is taken off, or null
// when it opens with none. A firm often writes what it does in front of what it
// is called, and grupocobra.com is Cobra's.
//
// One word, and only a word already known to identify nobody, so a run may not
// invent one to reach a name with — "gopenske.com" keeps its "go", because "go"
// names no trade. A label keeps no spaces to say where its first word ends, so
// the LONGEST such word it opens with is the one taken off: one of them is often
// the stem of another — "transporte" of "transportes" — and cutting at every one
// of them would read "transportesacme" from after the stem as well, handing a
// firm called Sacme a domain that says Acme. The price is that a label whose
// longest such word leaves too little behind gives up rather than trying the
// shorter one underneath, and a run brings far more of these words than the
// shared list holds — so it is a withholding that grows with the vocabulary.
//
// What is left has to be long enough to stand for somebody. Three letters are a
// whole label's worth of evidence when a firm registered exactly them
// ("dsv.com"), but here they are a fragment inside a longer label, which is the
// coincidence `DISTINCTIVE_NAME_LENGTH` exists to price: without the floor
// "grupoacs.com" answers for every firm called ACS and groupama.fr for every one
// called AMA.
//
// The word taken off needs a floor of its own, because a request names its trades
// in phrases and a phrase carries the little words that join it — "fontanería Y
// climatización", "instalación DE gas" — which are then words the run asked for
// like any other. One of those in front of a domain says nothing about what a
// firm does, and letting it come off cuts a stranger's label one or two letters
// in: detalia.com would be Talia's and yacme.com would be Acme's.
//
// Set above them rather than at the shortest word for a trade, which costs a
// three-letter one: a run asking about "gas" never reads past the "gas" in
// gasgarcia.es. That is a withholding, and it buys a floor no joining word in
// the languages these markets answer in can reach over.
const SHORTEST_WORD_A_DOMAIN_WRITES_IN_FRONT = 4

const withoutLeadingTradeWord = (
	label: string,
	identifiesNobody: (word: string) => boolean,
): string | null => {
	for (
		let taken = label.length - 1;
		taken >= SHORTEST_WORD_A_DOMAIN_WRITES_IN_FRONT;
		taken--
	) {
		if (!identifiesNobody(label.slice(0, taken))) continue
		const rest = label.slice(taken)
		return rest.length >= DISTINCTIVE_NAME_LENGTH ? rest : null
	}
	return null
}

/**
 * Whether a host is this company's own domain.
 *
 * The label has to spell the company: one of the names a domain could carry, or
 * one distinctive word of the name on its own — which is how most small firms
 * register. Either may have the legal form after it, and nothing else:
 * "fusteriamiquelsl.cat" is the workshop, "fusteriamiquelreviews.com" is
 * somebody writing about it. A trade word in front of the name is read past, on
 * the terms `withoutLeadingTradeWord` sets.
 */
const hostSpellsTheCompany = (
	name: string,
	host: string,
	tradeWords: TradeWords,
): boolean => {
	// A word identifies nobody when it names a kind of company — the shared list —
	// or a trade this run went looking for.
	const identifiesNobody = (word: string): boolean =>
		isGenericWord(word) || namesATrade(word, tradeWords)
	// The word in front of a domain is judged more strictly than a word of a name:
	// the request has to have written it exactly. A label says nowhere where its
	// first word ends, so a reading that allowed an ending would cut into the name
	// behind it — see `wasAskedForExactly`.
	const identifiesNobodyAsWritten = (word: string): boolean =>
		isGenericWord(word) || wasAskedForExactly(word, tradeWords)

	const label = collapse(hostLabel(host))
	const pastTheTrade = withoutLeadingTradeWord(label, identifiesNobodyAsWritten)
	// The distinctive words are read off the name itself, which already offers
	// each of them in every spelling. The trade the run asked about comes out of
	// them here rather than in `entity-guard.ts`, because a word that identifies
	// nobody is still a word a page naming the company may write, and the guard
	// that reads pages needs it — this is the one reading where a word standing
	// alone is spent claiming a domain.
	const words = distinctiveWords(name).filter(
		word => !namesATrade(word, tradeWords),
	)
	// Every spelling of the name, since a domain writes a Catalan geminate l
	// whichever way its owner chose and both are the same company's. The dots of a
	// legal form come out after the spellings are read, never before, or a name
	// written "Instal.lacions" would lose its second reading to them.
	return nameSpellings(name).some(spelling => {
		const spelled = nameWordsWithoutForms(withoutFormDots(spelling))
		// A brief rather than a name, which no spelling of it can rescue.
		if (spelled.length > MOST_WORDS_A_NAME_RUNS_TO) return false
		const couldCarry = namesTheDomainCouldCarry(spelled, identifiesNobody)
		if (labelSpellsOneOf(label, [...couldCarry, ...words])) return true
		// Past a trade word, only the front of the name is read, never one word
		// taken from the middle of it. The label has already spent its own front on
		// the trade word, so a word matched here is a word the domain CONTAINS
		// rather than one it spells — and "grupofire.com" is Grupo FIRE's, not the
		// site of every firm with "fire" somewhere in its name.
		return pastTheTrade !== null && labelSpellsOneOf(pastTheTrade, couldCarry)
	})
}

/**
 * Whether this host is established as the company's own site.
 *
 * The same question as `ownSiteVerdict`, asked of a host already read off an
 * address. A caller weighing many addresses that share a host asks it once for
 * the host rather than once per address, and gets the same answer either way,
 * since the path is deliberately never read.
 */
export const ownSiteHostVerdict = (args: {
	readonly name: string
	readonly host: string
	readonly tradeWords: TradeWords
}): OwnSiteVerdict =>
	hostSpellsTheCompany(args.name, args.host, args.tradeWords)
		? 'established'
		: 'unknown'

/**
 * Whether this website is established as the company's own site.
 *
 * `name` is the company the address is claimed for — the row's own name on a
 * scanned company, and the company the run is about for the one `website` field
 * that arrives with no name beside it. A run with no name to compare establishes
 * nothing, which is the right answer rather than a missing one.
 *
 * `tradeWords` is what the run itself went looking for (`trade-words.ts`). Asked
 * for rather than reached from here, and asked for on every call rather than
 * defaulted to none, because a caller that quietly left it out would judge the
 * same address by a different reading from the rest of the run — and would clear
 * the addresses this exists to refuse.
 */
export const ownSiteVerdict = (args: {
	readonly name: string
	readonly website: string
	readonly tradeWords: TradeWords
}): OwnSiteVerdict => {
	const { name, website, tradeWords } = args
	// A value with words written next to it is not one address, so there is no
	// domain to read — and a reader cannot open it either.
	if (!isBareWebAddress(website)) return 'unknown'
	const host = hostOf(website)
	if (host === null) return 'unknown'

	return ownSiteHostVerdict({ name, host, tradeWords })
}
