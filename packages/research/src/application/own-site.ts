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
 * the languages that market answers in (`run-words.ts`).
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
 * ## The words for a kind of company
 *
 * The list's other half names a KIND of company — group, holding, servicios. It
 * is not the English and Spanish it looks like: "Sociedad García" is at home on
 * sociedad.es on that list alone, as are Empresa, Corporación and Asociación
 * something, in the market this is measured on. A list that misses the commonest
 * company word in the language it supposedly covers is not a list with gaps, it
 * is the wrong shape of answer.
 *
 * The run answers for these too, the same way it answers for trades. Its request
 * names the trades outright and never says "group" — but the language that
 * request is written in says which language its companies name themselves in, so
 * the one reading that splits a request into its trades is asked for that
 * language's words for a kind of company beside them (`request-parts.ts`). Both
 * arrive as one vocabulary (`run-words.ts`), because a word for a kind of company
 * answers "does this identify anybody" exactly as a trade does.
 *
 * Three other replacements were priced against the rows eight market searches
 * returned, and none of them stands. A PUBLISHED LIST OF LEGAL FORMS does not hold
 * these words: it carries "Gesellschaft" and not one of Gruppe, Grup, Groep,
 * Grupa, Serveis, Servizi or Serviços, because a legal form is a closed class a
 * country defines and a word for a kind of company is not one — and feeding its
 * words in takes Crédit Agricole and Mutua Madrileña off their own sites. WORDS
 * MANY COMPANIES IN ONE RUN SHARE catch none of them and cost real ones: ranked
 * by how many differently-named companies carry them, a run's shared words are
 * its trades and its places — "ascenseurs" nine, "france" six — while a
 * kind-of-company word peaks at three, level with the surnames, and most of what
 * looks like sharing is ONE company written twice. REFUSING A NAME'S WORD
 * WHENEVER ANOTHER WORD COULD BE THE COMPANY answers every case and takes 26
 * firms in 238 off sites that really are theirs — Schindler at schindler.fr, KONE
 * at kone.fr, Naturgy at naturgy.com.
 *
 * ## Where the word sits, for the run that brings nothing
 *
 * A run about ONE COMPANY ON FILE has no market behind it and so brings no words
 * at all, which is where the shared list is still the only thing standing. WHERE
 * THE WORD SITS answers half of what the list misses there, and needs nothing
 * brought: a firm drops the front of its name to register it and not the end, so
 * the word that may stand alone is the first one that identifies anybody — see
 * `theWordThatMayStandAlone`. Where a language writes the kind-of-company word
 * last it settles it, and Müller Gruppe is Müller's while gruppe.de is nobody's,
 * without "gruppe" being known to anything.
 *
 * Where a language writes that word first it settles nothing, and a run with
 * nothing brought keeps grup.cat for Grup Puig, because "Grup Puig" and
 * "Schindler France" are one shape to anything reading an address. That is what
 * the run's own words close when there is a run to ask.
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
 * **A host that is a social platform.** The one way a page on Facebook could
 * still be established: an agency named after the platform it works on —
 * "Instagram Marketing SL", "Facebook Ads Agency" — spells that host's own label,
 * and the reading above would hand it the platform as its site. A page on a
 * platform belongs to whoever opened the account, which is no reason to say the
 * company owns the domain, so such a host is refused before any of its letters
 * are read (`social-sites.ts`).
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
 * Reading only the FIRST word that identifies anybody costs where a word for a
 * trade goes unrecognised, because that word then stands in front of the name
 * and takes the one place a word may stand alone. Over the same rows it changed
 * one answer, and that one was a lift maker's domain being taken off a company
 * the scan had written its name after; it cleared nothing it had not cleared
 * before.
 *
 * A run with no trades to read pays more, and pays it the wrong way round.
 * "Fontanería García" keeps fontaneria.es, which is the known cost above, and
 * loses garcia.es, which was the right answer — so of the two the one left
 * standing is the worse. Both were cleared before and the withholding is the
 * safe direction, but a word missing from the shared list costs twice over: it
 * fails to refuse the trade's own domain AND it spends the place the company's
 * word would have stood in. Over the same rows one company paid it,
 * "Instalaciones Eléctricas Comuval" at comuval.com. It is the run's trades that
 * buy this back, so the runs that pay are the ones with no market behind them —
 * the same runs the shared list was kept for.
 *
 * It costs the same where a request names a trade in a longer wording than the
 * name uses — a request for "restaurants" does not reach a firm called
 * "Restaurant Sumat", so "restaurant" stands in front of the name and sumat.cat
 * reads `unknown`. The wording is `run-words.ts`'s to widen, and widening it
 * is measured there rather than worked around here.
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
	hostLabel,
	isGenericWord,
	labelSpellsOneOf,
	nameSpellings,
	nameWordsWithoutForms,
	withoutFormDots,
} from './entity-guard'
import { namesNobody, type RunWords, runWroteExactly } from './run-words'
import { isSocialPlatformHost } from './social-sites'
import { hostOf, isBareWebAddress } from './source-key'

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
// Whether this word of a name says WHO the company is, rather than what it does,
// what kind of thing it is, or joining the two halves of a name.
//
// Written once because both readings below turn on it — which front runs a
// domain could carry, and which single word may stand for the company — and a
// name whose front names somebody to one of them and nobody to the other is the
// same rule answering two ways.
const identifiesSomebody = (
	word: string,
	identifiesNobody: (word: string) => boolean,
): boolean => !identifiesNobody(word) && !JOINS_TWO_HALVES_OF_A_NAME.has(word)

const namesTheDomainCouldCarry = (
	words: ReadonlyArray<string>,
	identifiesNobody: (word: string) => boolean,
): ReadonlyArray<string> => {
	const runs: Array<string> = []
	let run = ''
	let hasNamedSomebody = false
	for (const word of words) {
		run += word
		// A front part made of nothing but trade words identifies nobody, so
		// "Grupo Ferré" must not be at home on grupo.es and "Transportes García"
		// not on transportes.com. Once a word of the company's own has arrived,
		// every longer run carries it.
		hasNamedSomebody =
			hasNamedSomebody || identifiesSomebody(word, identifiesNobody)
		if (hasNamedSomebody && run.length >= SHORTEST_NAME_A_DOMAIN_SPELLS) {
			runs.push(run)
		}
	}
	return runs
}

// The one word of a name that may stand for the company on its own: the first
// that identifies anybody. A firm registers the word people call it by, and the
// front it drops on the way there is what it is rather than who — "Transportes
// García" at garcia.es.
//
// Only the first, because past it nothing tells a word for a KIND of company
// from the company. "Müller Gruppe" and "Schindler France" are the same two
// words to this reading — a word it can place and a word it cannot — and the
// shared list places neither "gruppe" nor "france". Letting any word stand
// alone hands gruppe.de to every German firm called something Gruppe; letting
// only the first clears no address it did not clear before, because a name's
// own word comes first whenever the kind-of-company word is written last.
//
// It buys nothing where that word is written FIRST — "Gruppe Müller" offers
// "gruppe" as its first word and this takes it. Nothing HERE can close that:
// read off an address, "Gruppe Müller" and "Schindler France" are one shape, and
// which of the two words names the company is the question rather than something
// to read off it. What closes it is the run saying the word names a kind of
// company, which leaves this reading nothing to take. So the half that stays open
// is exactly the half where no run said anything.
//
// A word too short to stand for anybody is stepped over rather than spending the
// place: "Transportes JM Puig" is Puig's, and two letters of a name are initials
// that could not have been the word a domain dropped.
const theWordThatMayStandAlone = (
	spelled: ReadonlyArray<string>,
	identifiesNobody: (word: string) => boolean,
): string | undefined =>
	spelled.find(
		word =>
			identifiesSomebody(word, identifiesNobody) &&
			word.length >= DISTINCTIVE_NAME_LENGTH,
	)

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
	runWords: RunWords,
): boolean => {
	// A word identifies nobody when it names a kind of company — the shared list —
	// or a trade this run went looking for. The trade comes out of a name's words
	// here rather than in `entity-guard.ts`, because a word that identifies nobody
	// is still a word a page naming the company may write, and the guard that
	// reads pages needs it — this is the one reading where a word standing alone
	// is spent claiming a domain.
	const identifiesNobody = (word: string): boolean =>
		isGenericWord(word) || namesNobody(word, runWords)
	// The word in front of a domain is judged more strictly than a word of a name:
	// the request has to have written it exactly. A label says nowhere where its
	// first word ends, so a reading that allowed an ending would cut into the name
	// behind it — see `runWroteExactly`.
	const identifiesNobodyAsWritten = (word: string): boolean =>
		isGenericWord(word) || runWroteExactly(word, runWords)

	const label = collapse(hostLabel(host))
	const pastTheTrade = withoutLeadingTradeWord(label, identifiesNobodyAsWritten)
	// Every spelling of the name, since a domain writes a Catalan geminate l
	// whichever way its owner chose and both are the same company's. The dots of a
	// legal form come out after the spellings are read, never before, or a name
	// written "Instal.lacions" would lose its second reading to them.
	return nameSpellings(name).some(spelling => {
		const spelled = nameWordsWithoutForms(withoutFormDots(spelling))
		// A brief rather than a name, which no spelling of it can rescue.
		if (spelled.length > MOST_WORDS_A_NAME_RUNS_TO) return false
		const couldCarry = namesTheDomainCouldCarry(spelled, identifiesNobody)
		// Read off this spelling rather than off the whole name, so the word that
		// comes first is the one that comes first as the domain writes it.
		const oneWord = theWordThatMayStandAlone(spelled, identifiesNobody)
		const standingAlone = oneWord === undefined ? [] : [oneWord]
		if (labelSpellsOneOf(label, [...couldCarry, ...standingAlone])) return true
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
	readonly runWords: RunWords
}): OwnSiteVerdict =>
	!isSocialPlatformHost(args.host) &&
	hostSpellsTheCompany(args.name, args.host, args.runWords)
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
 * `runWords` is what the run itself went looking for (`run-words.ts`). Asked
 * for rather than reached from here, and asked for on every call rather than
 * defaulted to none, because a caller that quietly left it out would judge the
 * same address by a different reading from the rest of the run — and would clear
 * the addresses this exists to refuse.
 */
export const ownSiteVerdict = (args: {
	readonly name: string
	readonly website: string
	readonly runWords: RunWords
}): OwnSiteVerdict => {
	const { name, website, runWords } = args
	// A value with words written next to it is not one address, so there is no
	// domain to read — and a reader cannot open it either.
	if (!isBareWebAddress(website)) return 'unknown'
	const host = hostOf(website)
	if (host === null) return 'unknown'

	return ownSiteHostVerdict({ name, host, runWords })
}
